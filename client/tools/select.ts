export interface SelectToolConfig {
  onCommit: () => void;
}

export class SelectTool {
  private isSelecting = false;
  private startX = 0;
  private startY = 0;
  private selection: ImageData | null = null;
  private selectionX = 0;
  private selectionY = 0;
  private selectionW = 0;
  private selectionH = 0;
  private layerSnapshot: ImageData | null = null;

  constructor(private config: SelectToolConfig) {}

  beginSelect(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number): void {
    this.commitIfActive(ctx);
    this.isSelecting = true;
    this.startX = x;
    this.startY = y;
    this.layerSnapshot = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  updateSelect(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number): void {
    if (!this.isSelecting || !this.layerSnapshot) return;

    // Draw selection rectangle preview
    ctx.putImageData(this.layerSnapshot, 0, 0);
    ctx.strokeStyle = "#4a9eff";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      Math.min(this.startX, x),
      Math.min(this.startY, y),
      Math.abs(x - this.startX),
      Math.abs(y - this.startY),
    );
    ctx.setLineDash([]);
  }

  endSelect(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number): void {
    if (!this.isSelecting || !this.layerSnapshot) return;
    this.isSelecting = false;

    this.selectionX = Math.min(this.startX, x);
    this.selectionY = Math.min(this.startY, y);
    this.selectionW = Math.abs(x - this.startX);
    this.selectionH = Math.abs(y - this.startY);

    if (this.selectionW < 2 || this.selectionH < 2) {
      ctx.putImageData(this.layerSnapshot, 0, 0);
      this.layerSnapshot = null;
      return;
    }

    // Cut the selected region
    this.selection = ctx.getImageData(
      this.selectionX,
      this.selectionY,
      this.selectionW,
      this.selectionH,
    );

    // Clear the region on the layer
    ctx.putImageData(this.layerSnapshot, 0, 0);
    ctx.clearRect(this.selectionX, this.selectionY, this.selectionW, this.selectionH);
    this.layerSnapshot = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Render floating selection
    ctx.putImageData(this.selection, this.selectionX, this.selectionY);
  }

  moveSelection(ctx: OffscreenCanvasRenderingContext2D, dx: number, dy: number): void {
    if (!this.selection || !this.layerSnapshot) return;
    this.selectionX += dx;
    this.selectionY += dy;

    ctx.putImageData(this.layerSnapshot, 0, 0);
    ctx.putImageData(this.selection, this.selectionX, this.selectionY);
  }

  commitIfActive(ctx: OffscreenCanvasRenderingContext2D): void {
    if (!this.selection || !this.layerSnapshot) return;

    ctx.putImageData(this.layerSnapshot, 0, 0);
    ctx.putImageData(this.selection, this.selectionX, this.selectionY);

    this.selection = null;
    this.layerSnapshot = null;
    this.config.onCommit();
  }

  hasSelection(): boolean {
    return this.selection !== null;
  }

  cancel(ctx: OffscreenCanvasRenderingContext2D): void {
    if (this.layerSnapshot) {
      ctx.putImageData(this.layerSnapshot, 0, 0);
      if (this.selection) {
        ctx.putImageData(this.selection, this.startX, this.startY);
      }
    }
    this.selection = null;
    this.layerSnapshot = null;
    this.isSelecting = false;
  }
}
