export type ShapeType = "rectangle" | "ellipse" | "line";

export interface ShapeToolConfig {
  onCommit: () => void;
}

export class ShapeTool {
  private shapeType: ShapeType = "rectangle";
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private previewCanvas: OffscreenCanvas | null = null;
  private previewCtx: OffscreenCanvasRenderingContext2D | null = null;
  private layerSnapshot: ImageData | null = null;

  constructor(private config: ShapeToolConfig) {}

  setShapeType(type: ShapeType): void {
    this.shapeType = type;
  }

  getShapeType(): ShapeType {
    return this.shapeType;
  }

  cycleShapeType(): void {
    const types: ShapeType[] = ["rectangle", "ellipse", "line"];
    const idx = types.indexOf(this.shapeType);
    this.shapeType = types[(idx + 1) % types.length];
  }

  beginShape(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, color: string, size: number): void {
    this.isDrawing = true;
    this.startX = x;
    this.startY = y;

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    this.layerSnapshot = ctx.getImageData(0, 0, w, h);
    this.previewCanvas = new OffscreenCanvas(w, h);
    this.previewCtx = this.previewCanvas.getContext("2d")!;
    this.previewCtx.strokeStyle = color;
    this.previewCtx.lineWidth = size;
  }

  updateShape(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number): void {
    if (!this.isDrawing || !this.previewCtx || !this.previewCanvas || !this.layerSnapshot) return;

    this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    this.previewCtx.beginPath();

    switch (this.shapeType) {
      case "rectangle": {
        const w = x - this.startX;
        const h = y - this.startY;
        this.previewCtx.strokeRect(this.startX, this.startY, w, h);
        break;
      }
      case "ellipse": {
        const cx = (this.startX + x) / 2;
        const cy = (this.startY + y) / 2;
        const rx = Math.abs(x - this.startX) / 2;
        const ry = Math.abs(y - this.startY) / 2;
        this.previewCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        this.previewCtx.stroke();
        break;
      }
      case "line": {
        this.previewCtx.moveTo(this.startX, this.startY);
        this.previewCtx.lineTo(x, y);
        this.previewCtx.stroke();
        break;
      }
    }

    // Preview on layer
    ctx.putImageData(this.layerSnapshot, 0, 0);
    ctx.drawImage(this.previewCanvas, 0, 0);
  }

  commitShape(ctx: OffscreenCanvasRenderingContext2D): void {
    if (!this.isDrawing || !this.previewCanvas || !this.layerSnapshot) return;

    ctx.putImageData(this.layerSnapshot, 0, 0);
    ctx.drawImage(this.previewCanvas, 0, 0);

    this.isDrawing = false;
    this.previewCanvas = null;
    this.previewCtx = null;
    this.layerSnapshot = null;
    this.config.onCommit();
  }
}
