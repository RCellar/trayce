import type { Brush, BrushParams } from "./types";
import type { StrokePoint } from "../stroke";
import { generateStrokeOutline, outlineToPath2D } from "../stroke";

export class EraserBrush implements Brush {
  name = "Eraser";
  cursor = "crosshair";

  beginStroke(ctx: OffscreenCanvasRenderingContext2D, _params: BrushParams): void {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "black";
  }

  drawStroke(
    ctx: OffscreenCanvasRenderingContext2D,
    points: StrokePoint[],
    params: BrushParams
  ): void {
    const outline = generateStrokeOutline(points, {
      size: params.size,
      smoothing: params.smoothing / 100,
    });
    const path = outlineToPath2D(outline);
    ctx.fill(path);
  }

  endStroke(ctx: OffscreenCanvasRenderingContext2D, _params: BrushParams): void {
    ctx.restore();
  }
}
