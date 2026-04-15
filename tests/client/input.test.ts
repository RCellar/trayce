import { describe, expect, test } from "bun:test";
import { InputHandler, type InputState } from "../../client/input";

/** Minimal PointerEvent stub — Bun's test env has no DOM, so we fake just
 *  what InputHandler reads. `getCoalescedEvents` is optional so the handler
 *  falls back to the event itself when unset. */
type FakePointerEvent = {
  pointerType: string;
  clientX: number;
  clientY: number;
  pressure: number;
  getCoalescedEvents?: () => FakePointerEvent[];
};

/** Fake HTMLElement with a controllable addEventListener/removeEventListener
 *  pair + a bounding rect. We capture the registered listeners so the test
 *  can dispatch synthetic pointer events synchronously. */
function makeElement(rect: { left: number; top: number } = { left: 0, top: 0 }) {
  const listeners = new Map<string, (e: FakePointerEvent) => void>();
  const style: Record<string, string> = {};
  const el = {
    addEventListener(name: string, fn: (e: FakePointerEvent) => void) {
      listeners.set(name, fn);
    },
    removeEventListener(name: string) {
      listeners.delete(name);
    },
    getBoundingClientRect() {
      return { left: rect.left, top: rect.top, right: 0, bottom: 0, width: 0, height: 0 };
    },
    style,
  } as unknown as HTMLElement;
  return { el, listeners };
}

/** Controllable rAF: tests explicitly call runFrame() to flush. */
function makeRaf() {
  const queue: FrameRequestCallback[] = [];
  const requestFrame = (cb: FrameRequestCallback): number => {
    queue.push(cb);
    return queue.length; // id === index+1
  };
  const cancelFrame = (id: number): void => {
    if (id > 0 && id <= queue.length) queue[id - 1] = (() => undefined) as FrameRequestCallback;
  };
  const runFrame = () => {
    const pending = queue.splice(0, queue.length);
    for (const cb of pending) cb(performance.now());
  };
  return { requestFrame, cancelFrame, runFrame, pendingCount: () => queue.length };
}

function makePointer(x: number, y: number, opts: Partial<FakePointerEvent> = {}): FakePointerEvent {
  return {
    pointerType: "mouse",
    clientX: x,
    clientY: y,
    pressure: opts.pressure ?? 0.5,
    ...(opts.getCoalescedEvents ? { getCoalescedEvents: opts.getCoalescedEvents } : {}),
  };
}

describe("InputHandler — pointer batching", () => {
  test("multiple moves in one frame collapse to a single callback", () => {
    const { el, listeners } = makeElement();
    const { requestFrame, cancelFrame, runFrame } = makeRaf();
    const calls: Array<{ points: number; event: string }> = [];
    const cb = (s: InputState, event: "start" | "move" | "end") => {
      calls.push({ points: s.points.length, event });
    };

    new InputHandler(el, cb, { requestFrame, cancelFrame });

    const down = listeners.get("pointerdown")!;
    const move = listeners.get("pointermove")!;
    down(makePointer(0, 0) as unknown as PointerEvent);
    move(makePointer(1, 1) as unknown as PointerEvent);
    move(makePointer(2, 2) as unknown as PointerEvent);
    move(makePointer(3, 3) as unknown as PointerEvent);

    // Before flushing, no "move" callback has fired — only "start".
    expect(calls.map((c) => c.event)).toEqual(["start"]);

    runFrame();

    // Exactly one "move" after rAF, with all four points accumulated
    // (start point + three moves).
    expect(calls.map((c) => c.event)).toEqual(["start", "move"]);
    expect(calls[1]!.points).toBe(4);
  });

  test("coalesced events are all appended to state.points", () => {
    const { el, listeners } = makeElement();
    const { requestFrame, cancelFrame, runFrame } = makeRaf();
    let lastPoints = 0;
    const cb = (s: InputState, event: "start" | "move" | "end") => {
      if (event === "move") lastPoints = s.points.length;
    };

    new InputHandler(el, cb, { requestFrame, cancelFrame });

    const down = listeners.get("pointerdown")!;
    const move = listeners.get("pointermove")!;
    down(makePointer(0, 0) as unknown as PointerEvent);

    const coalesced: FakePointerEvent[] = [makePointer(1, 1), makePointer(2, 2), makePointer(3, 3)];
    move(
      makePointer(4, 4, {
        getCoalescedEvents: () => coalesced,
      }) as unknown as PointerEvent,
    );

    runFrame();

    // 1 start + 3 coalesced = 4
    expect(lastPoints).toBe(4);
  });

  test("pointerup drains pending points before firing end", () => {
    const { el, listeners } = makeElement();
    const { requestFrame, cancelFrame, pendingCount } = makeRaf();
    const calls: Array<{ points: number; event: string }> = [];
    const cb = (s: InputState, event: "start" | "move" | "end") => {
      calls.push({ points: s.points.length, event });
    };

    new InputHandler(el, cb, { requestFrame, cancelFrame });

    const down = listeners.get("pointerdown")!;
    const move = listeners.get("pointermove")!;
    const up = listeners.get("pointerup")!;
    down(makePointer(0, 0) as unknown as PointerEvent);
    move(makePointer(1, 1) as unknown as PointerEvent);
    move(makePointer(2, 2) as unknown as PointerEvent);

    // A rAF is queued, but pointerup fires before the frame runs.
    expect(pendingCount()).toBe(1);
    up(makePointer(2, 2) as unknown as PointerEvent);

    // pointerup must synchronously emit one final "move" with both moves
    // baked in, then "end". No late-frame callback after.
    expect(calls.map((c) => c.event)).toEqual(["start", "move", "end"]);
    expect(calls[1]!.points).toBe(3); // start + 2 moves
  });

  test("getBoundingClientRect is called once per stroke, not per move", () => {
    const { el, listeners } = makeElement();
    const { requestFrame, cancelFrame, runFrame } = makeRaf();
    let rectReads = 0;
    const origRect = el.getBoundingClientRect.bind(el);
    el.getBoundingClientRect = () => {
      rectReads++;
      return origRect();
    };

    new InputHandler(el, () => undefined, { requestFrame, cancelFrame });

    const down = listeners.get("pointerdown")!;
    const move = listeners.get("pointermove")!;
    const up = listeners.get("pointerup")!;
    down(makePointer(0, 0) as unknown as PointerEvent);
    for (let i = 0; i < 10; i++) move(makePointer(i, i) as unknown as PointerEvent);
    runFrame();
    up(makePointer(10, 10) as unknown as PointerEvent);

    // One getBoundingClientRect per stroke, regardless of move count.
    expect(rectReads).toBe(1);
  });

  test("rect cache applies the rect offset to all points in the stroke", () => {
    // Use a non-zero rect so we can confirm offsets are applied.
    const { el, listeners } = makeElement({ left: 100, top: 200 });
    const { requestFrame, cancelFrame, runFrame } = makeRaf();
    const captured: Array<{ x: number; y: number }> = [];
    const cb = (s: InputState, event: "start" | "move" | "end") => {
      if (event === "move") {
        for (const p of s.points) captured.push({ x: p.x, y: p.y });
      }
    };

    new InputHandler(el, cb, { requestFrame, cancelFrame });

    const down = listeners.get("pointerdown")!;
    const move = listeners.get("pointermove")!;
    down(makePointer(100, 200) as unknown as PointerEvent); // doc (0,0)
    move(makePointer(150, 250) as unknown as PointerEvent); // doc (50,50)
    runFrame();

    // The final "move" emission contains both the start point (0,0) and the
    // move point (50,50) in document coords.
    expect(captured).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 50 },
    ]);
  });

  test("ignores touch events", () => {
    const { el, listeners } = makeElement();
    const { requestFrame, cancelFrame } = makeRaf();
    const calls: string[] = [];
    const cb = (_s: InputState, event: "start" | "move" | "end") => calls.push(event);

    new InputHandler(el, cb, { requestFrame, cancelFrame });
    const down = listeners.get("pointerdown")!;
    down({ ...makePointer(0, 0), pointerType: "touch" } as unknown as PointerEvent);

    expect(calls).toEqual([]);
  });
});
