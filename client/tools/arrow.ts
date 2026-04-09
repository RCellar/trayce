export interface ArrowToolConfig {
  onCommit: () => void;
}

export class ArrowTool {
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private layerSnapshot: ImageData | null = null;

  constructor(private config: ArrowToolConfig) {}

  begin(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number): void {
    this.isDrawing = true;
    this.startX = x;
    this.startY = y;
    this.layerSnapshot = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  update(
    ctx: OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    lineWidth: number,
  ): void {
    if (!this.isDrawing || !this.layerSnapshot) return;

    ctx.putImageData(this.layerSnapshot, 0, 0);
    this.drawArrow(ctx, this.startX, this.startY, x, y, color, lineWidth);
  }

  commit(
    ctx: OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    lineWidth: number,
  ): void {
    if (!this.isDrawing || !this.layerSnapshot) return;

    ctx.putImageData(this.layerSnapshot, 0, 0);
    this.drawArrow(ctx, this.startX, this.startY, x, y, color, lineWidth);

    this.isDrawing = false;
    this.layerSnapshot = null;
    this.config.onCommit();
  }

  private drawArrow(
    ctx: OffscreenCanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    lineWidth: number,
  ): void {
    const headLen = Math.max(10, lineWidth * 3);
    const angle = Math.atan2(y2 - y1, x2 - x1);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";

    // Line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(angle - Math.PI / 6),
      y2 - headLen * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
      x2 - headLen * Math.cos(angle + Math.PI / 6),
      y2 - headLen * Math.sin(angle + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fill();
  }
}
