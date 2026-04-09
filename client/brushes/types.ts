import type { StrokePoint } from "../stroke";

export interface BrushParams {
  size: number; // 1-200
  opacity: number; // 0-100
  flow: number; // 0-100
  smoothing: number; // 0-100
  color: string; // hex color
}

export interface Brush {
  name: string;
  cursor: string;

  beginStroke(ctx: OffscreenCanvasRenderingContext2D, params: BrushParams): void;

  drawStroke(
    ctx: OffscreenCanvasRenderingContext2D,
    points: StrokePoint[],
    params: BrushParams,
  ): void;

  endStroke(ctx: OffscreenCanvasRenderingContext2D, params: BrushParams): void;
}
