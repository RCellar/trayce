import getStroke from "perfect-freehand";

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

export interface StrokeOptions {
  size: number;
  smoothing: number;
  thinning?: number;
  streamline?: number;
  simulatePressure?: boolean;
}

export function generateStrokeOutline(points: StrokePoint[], options: StrokeOptions): number[][] {
  const inputPoints = points.map((p) => [p.x, p.y, p.pressure]);

  return getStroke(inputPoints, {
    size: options.size,
    smoothing: options.smoothing,
    thinning: options.thinning ?? 0.5,
    streamline: options.streamline ?? 0.5,
    simulatePressure: options.simulatePressure ?? points[0]?.pressure === 0.5,
    start: { taper: true },
    end: { taper: true },
  });
}

export function outlineToPath2D(outline: number[][]): Path2D {
  const path = new Path2D();
  const first = outline[0];
  if (!first) return path;

  path.moveTo(first[0]!, first[1]!);
  for (let i = 1; i < outline.length; i++) {
    const pt = outline[i]!;
    path.lineTo(pt[0]!, pt[1]!);
  }
  path.closePath();
  return path;
}
