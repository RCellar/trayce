export interface LassoToolConfig {
  onCommit: () => void;
}

export class LassoTool {
  private isDrawing = false;
  private points: Array<{ x: number; y: number }> = [];
  private layerSnapshot: ImageData | null = null;

  constructor(private config: LassoToolConfig) {}

  begin(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number): void {
    this.isDrawing = true;
    this.points = [{ x, y }];
    this.layerSnapshot = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  update(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number): void {
    if (!this.isDrawing || !this.layerSnapshot) return;
    this.points.push({ x, y });

    // Draw lasso preview
    ctx.putImageData(this.layerSnapshot, 0, 0);
    ctx.strokeStyle = "#4a9eff";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  end(ctx: OffscreenCanvasRenderingContext2D): void {
    if (!this.isDrawing || !this.layerSnapshot || this.points.length < 3) {
      if (this.layerSnapshot) ctx.putImageData(this.layerSnapshot, 0, 0);
      this.reset();
      return;
    }

    this.isDrawing = false;

    // Create a clip path from the lasso points and extract the region
    const tempCanvas = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
    const tempCtx = tempCanvas.getContext("2d")!;

    // Draw the original image through the lasso clip
    tempCtx.beginPath();
    tempCtx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      tempCtx.lineTo(this.points[i].x, this.points[i].y);
    }
    tempCtx.closePath();
    tempCtx.clip();
    tempCtx.putImageData(this.layerSnapshot, 0, 0);

    // Clear the lasso region on the original layer
    ctx.putImageData(this.layerSnapshot, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    ctx.closePath();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill();
    ctx.restore();

    this.reset();
    this.config.onCommit();
  }

  private reset(): void {
    this.isDrawing = false;
    this.points = [];
    this.layerSnapshot = null;
  }
}
