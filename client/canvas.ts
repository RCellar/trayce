import { Application, Container } from "pixi.js";

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export class CanvasManager {
  app: Application;
  stage: Container;
  viewport: Viewport = { zoom: 1, panX: 0, panY: 0 };
  docWidth: number;
  docHeight: number;

  private constructor(app: Application, docWidth: number, docHeight: number) {
    this.app = app;
    this.docWidth = docWidth;
    this.docHeight = docHeight;
    this.stage = new Container();
    this.app.stage.addChild(this.stage);
    this.applyViewport();
  }

  static async create(
    container: HTMLElement,
    docWidth: number,
    docHeight: number
  ): Promise<CanvasManager> {
    const app = new Application();
    await app.init({
      resizeTo: container,
      backgroundColor: 0x222222,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      eventMode: "none",       // Disable PixiJS event system — we handle input ourselves
      eventFeatures: {
        move: false,
        globalMove: false,
        click: false,
        wheel: false,
      },
    });
    container.appendChild(app.canvas);

    // Ensure the canvas element doesn't block pointer events from reaching our handler
    (app.canvas as HTMLCanvasElement).style.touchAction = "none";

    return new CanvasManager(app, docWidth, docHeight);
  }

  setZoom(zoom: number): void {
    this.viewport.zoom = Math.max(0.1, Math.min(10, zoom));
    this.applyViewport();
  }

  zoomBy(delta: number): void {
    this.setZoom(this.viewport.zoom * (1 + delta));
  }

  pan(dx: number, dy: number): void {
    this.viewport.panX += dx;
    this.viewport.panY += dy;
    this.applyViewport();
  }

  resetView(): void {
    this.viewport = { zoom: 1, panX: 0, panY: 0 };
    this.applyViewport();
  }

  /** Force the Pixi renderer to re-measure its container. Used when surrounding
   *  layout changes (e.g. side panel toggled) don't trip the ResizeObserver fast
   *  enough, and re-centers the document for the new screen dimensions. */
  resize(): void {
    this.app.queueResize();
    this.applyViewport();
  }

  private applyViewport(): void {
    this.stage.scale.set(this.viewport.zoom);
    this.stage.position.set(
      this.viewport.panX + (this.app.screen.width - this.docWidth * this.viewport.zoom) / 2,
      this.viewport.panY + (this.app.screen.height - this.docHeight * this.viewport.zoom) / 2
    );
  }

  screenToDoc(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.stage.position.x) / this.viewport.zoom,
      y: (screenY - this.stage.position.y) / this.viewport.zoom,
    };
  }

  getCanvasInfo(): string {
    return `${this.docWidth} × ${this.docHeight} · ${Math.round(this.viewport.zoom * 100)}%`;
  }

  destroy(): void {
    this.app.destroy(true);
  }
}
