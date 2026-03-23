import type { Brush, BrushParams } from "./types";
import type { StrokePoint } from "../stroke";
import { generateStrokeOutline, outlineToPath2D } from "../stroke";

export class HighlighterBrush implements Brush {
  name = "Highlighter";
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

    const outline = generateStrokeOutline(points, {
      size: params.size * 3,
      smoothing: params.smoothing / 100,
      thinning: 0,
      simulatePressure: false,
    });

    this.strokeCtx.clearRect(0, 0, this.strokeBuffer.width, this.strokeBuffer.height);
    const path = outlineToPath2D(outline);
    this.strokeCtx.fill(path);

    // Composite with multiply blend for "over text" look
    ctx.putImageData(this.layerSnapshot, 0, 0);
    ctx.globalAlpha = 0.4;
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(this.strokeBuffer, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  endStroke(_ctx: OffscreenCanvasRenderingContext2D, _params: BrushParams): void {
    this.strokeBuffer = null;
    this.strokeCtx = null;
    this.layerSnapshot = null;
  }
}
