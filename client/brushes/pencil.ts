import type { Brush, BrushParams } from "./types";
import type { StrokePoint } from "../stroke";
import { generateStrokeOutline, outlineToPath2D } from "../stroke";

export class PencilBrush implements Brush {
  name = "Pencil";
  cursor = "crosshair";
  private strokeBuffer: OffscreenCanvas | null = null;
  private strokeCtx: OffscreenCanvasRenderingContext2D | null = null;
  private layerSnapshot: ImageData | null = null;

  beginStroke(ctx: OffscreenCanvasRenderingContext2D, params: BrushParams): void {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    this.layerSnapshot = ctx.getImageData(0, 0, w, h);
    this.strokeBuffer = new OffscreenCanvas(w, h);
    this.strokeCtx = this.strokeBuffer.getContext("2d")!;
    this.strokeCtx.fillStyle = params.color;
  }

  drawStroke(
    ctx: OffscreenCanvasRenderingContext2D,
    points: StrokePoint[],
    params: BrushParams
  ): void {
    if (!this.strokeCtx || !this.strokeBuffer || !this.layerSnapshot) return;

    // Add jitter to simulate graphite texture
    const jitteredPoints = points.map((p) => ({
      x: p.x + (Math.random() - 0.5) * params.size * 0.15,
      y: p.y + (Math.random() - 0.5) * params.size * 0.15,
      pressure: p.pressure,
    }));

    const outline = generateStrokeOutline(jitteredPoints, {
      size: params.size * 0.8,
      smoothing: params.smoothing / 100,
      thinning: 0.4,
    });

    this.strokeCtx.clearRect(0, 0, this.strokeBuffer.width, this.strokeBuffer.height);
    const path = outlineToPath2D(outline);
    this.strokeCtx.fill(path);

    ctx.putImageData(this.layerSnapshot, 0, 0);
    ctx.globalAlpha = (params.opacity / 100) * 0.6;
    ctx.drawImage(this.strokeBuffer, 0, 0);
    ctx.globalAlpha = 1;
  }

  endStroke(_ctx: OffscreenCanvasRenderingContext2D, _params: BrushParams): void {
    this.strokeBuffer = null;
    this.strokeCtx = null;
    this.layerSnapshot = null;
  }
}
