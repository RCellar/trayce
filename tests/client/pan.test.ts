import { describe, expect, test } from "bun:test";
import { PanHandler } from "../../client/pan";

/** Fake PointerEvent shape — PanHandler only touches a handful of fields. */
type FakePointerEvent = {
  pointerId: number;
  button: number;
  clientX: number;
  clientY: number;
  target?: EventTarget | null;
  preventDefault: () => void;
  stopImmediatePropagation: () => void;
};

type FakeKeyboardEvent = {
  code: string;
  repeat?: boolean;
  target?: EventTarget | null;
  preventDefault: () => void;
};

/** Capture-phase aware event-listener stub. Separate buckets per capture flag
 *  so the dispatch loop can find the right handler for a given phase. */
function makeElement(initialCursor = "") {
  const style: Record<string, string> = { cursor: initialCursor };
  const listeners = new Map<string, Array<(e: unknown) => void>>();

  const captureKey = (name: string, capture: boolean) =>
    `${name}:${capture ? "capture" : "bubble"}`;

  const el = {
    addEventListener(name: string, fn: (e: unknown) => void, opts?: { capture?: boolean }) {
      const key = captureKey(name, opts?.capture === true);
      const arr = listeners.get(key) ?? [];
      arr.push(fn);
      listeners.set(key, arr);
    },
    removeEventListener(name: string, fn: (e: unknown) => void, opts?: { capture?: boolean }) {
      const key = captureKey(name, opts?.capture === true);
      const arr = listeners.get(key) ?? [];
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    setPointerCapture: (_id: number) => {},
    releasePointerCapture: (_id: number) => {},
    style,
    dispatch(name: string, evt: unknown, capture: boolean) {
      const arr = listeners.get(captureKey(name, capture)) ?? [];
      for (const fn of [...arr]) fn(evt);
    },
  };
  return { el: el as unknown as HTMLElement, dispatch: el.dispatch };
}

/** Minimal Window stub for keydown/keyup/blur. */
function makeWindow() {
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  const win = {
    addEventListener(name: string, fn: (e: unknown) => void) {
      const arr = listeners.get(name) ?? [];
      arr.push(fn);
      listeners.set(name, arr);
    },
    removeEventListener(name: string, fn: (e: unknown) => void) {
      const arr = listeners.get(name) ?? [];
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatch(name: string, evt: unknown) {
      const arr = listeners.get(name) ?? [];
      for (const fn of [...arr]) fn(evt);
    },
  };
  return win as unknown as Window & { dispatch: (n: string, e: unknown) => void };
}

function ptr(button: number, x: number, y: number, pointerId = 1): FakePointerEvent {
  return {
    pointerId,
    button,
    clientX: x,
    clientY: y,
    preventDefault: () => {},
    stopImmediatePropagation: () => {},
  };
}

function key(code: string, opts: Partial<FakeKeyboardEvent> = {}): FakeKeyboardEvent {
  return {
    code,
    repeat: opts.repeat ?? false,
    target: opts.target ?? null,
    preventDefault: () => {},
  };
}

describe("PanHandler", () => {
  test("middle mouse button drag emits pan deltas", () => {
    const { el, dispatch } = makeElement();
    const win = makeWindow();
    const deltas: Array<[number, number]> = [];
    new PanHandler(el, (dx, dy) => deltas.push([dx, dy]), { window: win });

    dispatch("pointerdown", ptr(1, 100, 200), true);
    dispatch("pointermove", ptr(1, 110, 205), true);
    dispatch("pointermove", ptr(1, 115, 210), true);
    dispatch("pointerup", ptr(1, 115, 210), true);

    expect(deltas).toEqual([
      [10, 5],
      [5, 5],
    ]);
  });

  test("space + primary button drag emits pan deltas", () => {
    const { el, dispatch } = makeElement();
    const win = makeWindow() as Window & { dispatch: (n: string, e: unknown) => void };
    const deltas: Array<[number, number]> = [];
    new PanHandler(el, (dx, dy) => deltas.push([dx, dy]), { window: win });

    win.dispatch("keydown", key("Space"));
    dispatch("pointerdown", ptr(0, 50, 50), true);
    dispatch("pointermove", ptr(0, 60, 70), true);
    dispatch("pointerup", ptr(0, 60, 70), true);

    expect(deltas).toEqual([[10, 20]]);
  });

  test("primary button without space does NOT trigger pan", () => {
    const { el, dispatch } = makeElement();
    const win = makeWindow();
    const deltas: Array<[number, number]> = [];
    new PanHandler(el, (dx, dy) => deltas.push([dx, dy]), { window: win });

    dispatch("pointerdown", ptr(0, 0, 0), true);
    dispatch("pointermove", ptr(0, 10, 10), true);
    dispatch("pointerup", ptr(0, 10, 10), true);

    expect(deltas).toEqual([]);
  });

  test("cursor flips grab ↔ grabbing ↔ default", () => {
    const { el, dispatch } = makeElement("crosshair");
    const win = makeWindow() as Window & { dispatch: (n: string, e: unknown) => void };
    new PanHandler(el, () => undefined, { window: win });

    expect(el.style.cursor).toBe("crosshair");

    // Space held → grab
    win.dispatch("keydown", key("Space"));
    expect(el.style.cursor).toBe("grab");

    // Drag → grabbing
    dispatch("pointerdown", ptr(0, 0, 0), true);
    expect(el.style.cursor).toBe("grabbing");

    // Release drag (space still held) → back to grab
    dispatch("pointerup", ptr(0, 5, 5), true);
    expect(el.style.cursor).toBe("grab");

    // Release space → restore base cursor
    win.dispatch("keyup", key("Space"));
    expect(el.style.cursor).toBe("crosshair");
  });

  test("pointercancel ends the pan cleanly (no lingering state)", () => {
    const { el, dispatch } = makeElement();
    const win = makeWindow();
    const deltas: Array<[number, number]> = [];
    new PanHandler(el, (dx, dy) => deltas.push([dx, dy]), { window: win });

    dispatch("pointerdown", ptr(1, 0, 0), true);
    dispatch("pointermove", ptr(1, 10, 10), true);
    dispatch("pointercancel", ptr(1, 10, 10), true);
    // After cancel, a second move on the same pointerId should NOT re-trigger.
    dispatch("pointermove", ptr(1, 20, 20), true);

    expect(deltas).toEqual([[10, 10]]);
  });

  test("window blur cancels in-flight pan and clears cursor", () => {
    const { el, dispatch } = makeElement("crosshair");
    const win = makeWindow() as Window & { dispatch: (n: string, e: unknown) => void };
    new PanHandler(el, () => undefined, { window: win });

    win.dispatch("keydown", key("Space"));
    dispatch("pointerdown", ptr(0, 0, 0), true);
    expect(el.style.cursor).toBe("grabbing");

    win.dispatch("blur", {});
    expect(el.style.cursor).toBe("crosshair");

    // Subsequent move is ignored because pan state was cancelled.
    const deltas: Array<[number, number]> = [];
    dispatch("pointermove", ptr(0, 50, 50), true);
    expect(deltas).toEqual([]);
  });

  test("space keydown on text-input target is ignored (don't steal typing)", () => {
    // Stub HTMLInputElement so the pan handler's instanceof check resolves.
    class FakeHTMLInputElement {}
    (globalThis as { HTMLInputElement?: unknown }).HTMLInputElement = FakeHTMLInputElement;

    const { el } = makeElement();
    const win = makeWindow() as Window & { dispatch: (n: string, e: unknown) => void };
    new PanHandler(el, () => undefined, { window: win });

    const fakeInput = new FakeHTMLInputElement();
    win.dispatch("keydown", key("Space", { target: fakeInput as EventTarget }));
    expect(el.style.cursor).toBe("");

    delete (globalThis as { HTMLInputElement?: unknown }).HTMLInputElement;
  });

  test("zero-delta moves are skipped (don't wake the compositor)", () => {
    const { el, dispatch } = makeElement();
    const win = makeWindow();
    const deltas: Array<[number, number]> = [];
    new PanHandler(el, (dx, dy) => deltas.push([dx, dy]), { window: win });

    dispatch("pointerdown", ptr(1, 100, 100), true);
    dispatch("pointermove", ptr(1, 100, 100), true); // no movement
    dispatch("pointermove", ptr(1, 101, 100), true);
    dispatch("pointerup", ptr(1, 101, 100), true);

    expect(deltas).toEqual([[1, 0]]);
  });

  test("destroy unbinds all listeners", () => {
    const { el, dispatch } = makeElement();
    const win = makeWindow();
    const deltas: Array<[number, number]> = [];
    const handler = new PanHandler(el, (dx, dy) => deltas.push([dx, dy]), { window: win });

    handler.destroy();
    dispatch("pointerdown", ptr(1, 0, 0), true);
    dispatch("pointermove", ptr(1, 10, 10), true);

    expect(deltas).toEqual([]);
  });
});
