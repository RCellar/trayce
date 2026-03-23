import type { StrokePoint } from "./stroke";

export interface InputState {
  isDrawing: boolean;
  points: StrokePoint[];
  pointerType: string;
}

export type InputCallback = (state: InputState, event: "start" | "move" | "end") => void;

export class InputHandler {
  private state: InputState = {
    isDrawing: false,
    points: [],
    pointerType: "mouse",
  };
  private callback: InputCallback;
  private element: HTMLElement;

  constructor(element: HTMLElement, callback: InputCallback) {
    this.element = element;
    this.callback = callback;

    element.addEventListener("pointerdown", this.onPointerDown);
    element.addEventListener("pointermove", this.onPointerMove);
    element.addEventListener("pointerup", this.onPointerUp);
    element.addEventListener("pointerleave", this.onPointerUp);
    element.style.touchAction = "none";
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "touch") return;

    this.state.isDrawing = true;
    this.state.pointerType = e.pointerType;
    this.state.points = [this.eventToPoint(e)];
    this.callback(this.state, "start");
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.state.isDrawing) return;
    if (e.pointerType === "touch") return;

    this.state.points.push(this.eventToPoint(e));
    this.callback(this.state, "move");
  };

  private onPointerUp = (_e: PointerEvent): void => {
    if (!this.state.isDrawing) return;
    this.state.isDrawing = false;
    this.callback(this.state, "end");
    this.state.points = [];
  };

  private eventToPoint(e: PointerEvent): StrokePoint {
    const rect = this.element.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure || 0.5,
    };
  }

  destroy(): void {
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("pointermove", this.onPointerMove);
    this.element.removeEventListener("pointerup", this.onPointerUp);
    this.element.removeEventListener("pointerleave", this.onPointerUp);
  }
}
