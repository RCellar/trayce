import type { CanvasManager } from "./canvas";

export interface TouchConfig {
  onUndo: () => void;
}

export class TouchHandler {
  private activeTouches = new Map<number, { x: number; y: number }>();
  private initialPinchDist = 0;
  private initialZoom = 1;
  private lastPanX = 0;
  private lastPanY = 0;

  constructor(
    private element: HTMLElement,
    private canvasManager: CanvasManager,
    private config: TouchConfig
  ) {
    element.addEventListener("touchstart", this.onTouchStart, { passive: false });
    element.addEventListener("touchmove", this.onTouchMove, { passive: false });
    element.addEventListener("touchend", this.onTouchEnd, { passive: false });
  }

  private onTouchStart = (e: TouchEvent): void => {
    for (const touch of e.changedTouches) {
      this.activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }

    if (this.activeTouches.size === 2) {
      e.preventDefault();
      const points = Array.from(this.activeTouches.values());
      this.initialPinchDist = this.distance(points[0], points[1]);
      this.initialZoom = this.canvasManager.viewport.zoom;
      this.lastPanX = (points[0].x + points[1].x) / 2;
      this.lastPanY = (points[0].y + points[1].y) / 2;
    }

    // Three-finger tap → undo
    if (this.activeTouches.size === 3) {
      e.preventDefault();
      this.config.onUndo();
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    for (const touch of e.changedTouches) {
      this.activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }

    if (this.activeTouches.size === 2) {
      e.preventDefault();
      const points = Array.from(this.activeTouches.values());

      // Pinch zoom
      const dist = this.distance(points[0], points[1]);
      if (this.initialPinchDist > 0) {
        const scale = dist / this.initialPinchDist;
        this.canvasManager.setZoom(this.initialZoom * scale);
      }

      // Two-finger pan
      const cx = (points[0].x + points[1].x) / 2;
      const cy = (points[0].y + points[1].y) / 2;
      this.canvasManager.pan(cx - this.lastPanX, cy - this.lastPanY);
      this.lastPanX = cx;
      this.lastPanY = cy;
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    for (const touch of e.changedTouches) {
      this.activeTouches.delete(touch.identifier);
    }

    if (this.activeTouches.size < 2) {
      this.initialPinchDist = 0;
    }
  };

  private distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  destroy(): void {
    this.element.removeEventListener("touchstart", this.onTouchStart);
    this.element.removeEventListener("touchmove", this.onTouchMove);
    this.element.removeEventListener("touchend", this.onTouchEnd);
  }
}
