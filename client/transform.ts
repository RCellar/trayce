import type { CanvasManager } from "./canvas";
import type { Compositor } from "./compositor";
import type { LayerManager, LayerTransform } from "./layers";

type HandleId = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";
type DragMode =
  | { type: "move"; offsetX: number; offsetY: number }
  | {
      type: "resize";
      handle: HandleId;
      anchorX: number;
      anchorY: number;
      startW: number;
      startH: number;
    };

export interface TransformDeps {
  layerManager: () => LayerManager | null;
  compositor: () => Compositor | null;
  canvasManager: () => CanvasManager | null;
}

export class TransformHandler {
  private drag: DragMode | null = null;
  private readonly HANDLE_RADIUS_SCREEN = 6;

  constructor(private deps: TransformDeps) {}

  /** Called from the main input handler when the active layer has a transform. */
  handleInput(
    t: LayerTransform,
    docX: number,
    docY: number,
    event: "start" | "move" | "end",
  ): void {
    const { compositor, layerManager } = this.resolved();

    if (event === "start") {
      const zoom = this.deps.canvasManager()!.viewport.zoom;

      const handle = this.getHandleAtPoint(t, docX, docY, zoom);
      if (handle) {
        const ax = handle.includes("e") ? t.x : handle.includes("w") ? t.x + t.width : t.x;
        const ay = handle.includes("s") ? t.y : handle.includes("n") ? t.y + t.height : t.y;
        this.drag = {
          type: "resize",
          handle,
          anchorX: ax,
          anchorY: ay,
          startW: t.width,
          startH: t.height,
        };
        return;
      }

      if (this.hitTestTransformBounds(t, docX, docY)) {
        this.drag = { type: "move", offsetX: docX - t.x, offsetY: docY - t.y };
        return;
      }

      this.drag = null;
    }

    if (event === "move" && this.drag) {
      if (this.drag.type === "move") {
        t.x = docX - this.drag.offsetX;
        t.y = docY - this.drag.offsetY;
      } else {
        this.applyResize(t, this.drag, docX, docY);
      }
      compositor?.markDirty();
      if (layerManager) layerManager.bumpRevision(layerManager.activeLayer.id);
      this.updateOverlay();
    }

    if (event === "end" && this.drag) {
      this.drag = null;
    }
  }

  /** Redraws the transform overlay (handles + bounding box). */
  updateOverlay(): void {
    const { compositor, canvasManager, layerManager } = this.resolved();
    if (!compositor || !canvasManager || !layerManager) {
      compositor?.clearOverlay();
      return;
    }
    const layer = layerManager.activeLayer;
    if (!layer.transform) {
      compositor.clearOverlay();
      return;
    }
    const stagePos = canvasManager.stage.position;
    compositor.drawTransformOverlay(
      stagePos.x,
      stagePos.y,
      canvasManager.viewport.zoom,
      layer.transform,
    );
  }

  private resolved() {
    return {
      layerManager: this.deps.layerManager(),
      compositor: this.deps.compositor(),
      canvasManager: this.deps.canvasManager(),
    };
  }

  private getHandleAtPoint(
    t: { x: number; y: number; width: number; height: number },
    docX: number,
    docY: number,
    zoom: number,
  ): HandleId | null {
    const r = this.HANDLE_RADIUS_SCREEN / zoom;
    const handles: Array<{ id: HandleId; hx: number; hy: number }> = [
      { id: "nw", hx: t.x, hy: t.y },
      { id: "n", hx: t.x + t.width / 2, hy: t.y },
      { id: "ne", hx: t.x + t.width, hy: t.y },
      { id: "w", hx: t.x, hy: t.y + t.height / 2 },
      { id: "e", hx: t.x + t.width, hy: t.y + t.height / 2 },
      { id: "sw", hx: t.x, hy: t.y + t.height },
      { id: "s", hx: t.x + t.width / 2, hy: t.y + t.height },
      { id: "se", hx: t.x + t.width, hy: t.y + t.height },
    ];
    for (const h of handles) {
      if (Math.abs(docX - h.hx) <= r && Math.abs(docY - h.hy) <= r) return h.id;
    }
    return null;
  }

  private hitTestTransformBounds(
    t: { x: number; y: number; width: number; height: number },
    docX: number,
    docY: number,
  ): boolean {
    return docX >= t.x && docX <= t.x + t.width && docY >= t.y && docY <= t.y + t.height;
  }

  private applyResize(
    t: LayerTransform,
    drag: Extract<DragMode, { type: "resize" }>,
    docX: number,
    docY: number,
  ): void {
    const MIN_SIZE = 10;
    const { handle, anchorX, anchorY, startW, startH } = drag;
    const aspect = startW / startH;

    let newX = t.x,
      newY = t.y,
      newW = t.width,
      newH = t.height;

    if (handle.includes("e")) {
      newW = Math.max(MIN_SIZE, docX - anchorX);
      newX = anchorX;
    } else if (handle.includes("w")) {
      newW = Math.max(MIN_SIZE, anchorX - docX);
      newX = anchorX - newW;
    }

    if (handle.includes("s")) {
      newH = Math.max(MIN_SIZE, docY - anchorY);
      newY = anchorY;
    } else if (handle.includes("n")) {
      newH = Math.max(MIN_SIZE, anchorY - docY);
      newY = anchorY - newH;
    }

    if (handle.length === 2) {
      if (newW / newH > aspect) {
        newW = newH * aspect;
      } else {
        newH = newW / aspect;
      }
      if (handle.includes("w")) newX = anchorX - newW;
      if (handle.includes("n")) newY = anchorY - newH;
    }

    t.x = Math.round(newX);
    t.y = Math.round(newY);
    t.width = Math.round(newW);
    t.height = Math.round(newH);
  }
}
