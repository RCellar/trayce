import type { StrokePoint } from "./stroke";

export interface InputState {
  isDrawing: boolean;
  points: StrokePoint[];
  pointerType: string;
}

export type InputCallback = (state: InputState, event: "start" | "move" | "end") => void;

/** rAF indirection so tests can stub out scheduling. */
type RafLike = (cb: FrameRequestCallback) => number;
type CafLike = (id: number) => void;

export interface InputHandlerOptions {
  /** Override requestAnimationFrame (tests). */
  requestFrame?: RafLike;
  /** Override cancelAnimationFrame (tests). */
  cancelFrame?: CafLike;
}

export class InputHandler {
  private state: InputState = {
    isDrawing: false,
    points: [],
    pointerType: "mouse",
  };
  private callback: InputCallback;
  private element: HTMLElement;

  /** Cached at pointerdown, reused for every move in the stroke to avoid
   *  forced layout on each pointer event. */
  private cachedRect: { left: number; top: number } = { left: 0, top: 0 };

  /** rAF id for the pending move-flush, or null when no flush is queued. */
  private pendingFrame: number | null = null;
  /** True when points have been appended since the last flushed "move". */
  private pointsDirty = false;

  private readonly requestFrame: RafLike;
  private readonly cancelFrame: CafLike;

  constructor(element: HTMLElement, callback: InputCallback, opts: InputHandlerOptions = {}) {
    this.element = element;
    this.callback = callback;
    this.requestFrame =
      opts.requestFrame ?? ((cb) => (globalThis as any).requestAnimationFrame(cb));
    this.cancelFrame = opts.cancelFrame ?? ((id) => (globalThis as any).cancelAnimationFrame(id));

    element.addEventListener("pointerdown", this.onPointerDown);
    element.addEventListener("pointermove", this.onPointerMove);
    element.addEventListener("pointerup", this.onPointerUp);
    element.addEventListener("pointerleave", this.onPointerUp);
    element.style.touchAction = "none";
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "touch") return;

    // Capture the element rect once per stroke. Per-pointermove reads were
    // the single biggest source of forced layout in the draw loop.
    const rect = this.element.getBoundingClientRect();
    this.cachedRect = { left: rect.left, top: rect.top };

    this.state.isDrawing = true;
    this.state.pointerType = e.pointerType;
    this.state.points = [this.eventToPoint(e)];
    this.pointsDirty = false;
    this.callback(this.state, "start");
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.state.isDrawing) return;
    if (e.pointerType === "touch") return;

    // Pull all coalesced samples so we keep full input fidelity even though
    // we only repaint once per animation frame.
    const coalesced = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    if (coalesced.length > 0) {
      for (const ce of coalesced) this.state.points.push(this.eventToPoint(ce));
    } else {
      this.state.points.push(this.eventToPoint(e));
    }

    this.pointsDirty = true;
    this.scheduleFlush();
  };

  private onPointerUp = (_e: PointerEvent): void => {
    if (!this.state.isDrawing) return;
    this.state.isDrawing = false;

    // Drain any pending rAF: cancel it and synchronously emit one final
    // "move" so the last coalesced points are painted before "end" runs
    // checkpoint/history work.
    if (this.pendingFrame !== null) {
      this.cancelFrame(this.pendingFrame);
      this.pendingFrame = null;
    }
    if (this.pointsDirty) {
      this.pointsDirty = false;
      this.callback(this.state, "move");
    }

    this.callback(this.state, "end");
    this.state.points = [];
  };

  private scheduleFlush(): void {
    if (this.pendingFrame !== null) return;
    this.pendingFrame = this.requestFrame(() => {
      this.pendingFrame = null;
      // isDrawing flipped during a race with pointerup; ignore.
      if (!this.state.isDrawing) return;
      if (!this.pointsDirty) return;
      this.pointsDirty = false;
      this.callback(this.state, "move");
    });
  }

  private eventToPoint(e: PointerEvent): StrokePoint {
    return {
      x: e.clientX - this.cachedRect.left,
      y: e.clientY - this.cachedRect.top,
      pressure: e.pressure || 0.5,
    };
  }

  destroy(): void {
    if (this.pendingFrame !== null) {
      this.cancelFrame(this.pendingFrame);
      this.pendingFrame = null;
    }
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("pointermove", this.onPointerMove);
    this.element.removeEventListener("pointerup", this.onPointerUp);
    this.element.removeEventListener("pointerleave", this.onPointerUp);
  }
}
