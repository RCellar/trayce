import type { StrokePoint } from "../stroke";
import { generateStrokeOutline, outlineToPath2D } from "../stroke";
import type { Brush, BrushParams } from "./types";

export class EraserBrush implements Brush {
  name = "Eraser";
  cursor = "crosshair";

  beginStroke(ctx: OffscreenCanvasRenderingContext2D, _params: BrushParams): void {
    ctx.save();
    // Paint with white rather than destination-out so erasing is visible
    // on the background layer (destination-out erases to transparent,
    // which looks identical to white on a white background)
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
  }

  drawStroke(
    ctx: OffscreenCanvasRenderingContext2D,
    points: StrokePoint[],
    params: BrushParams,
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
