export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn";

export interface LayerTransform {
  x: number; // document-space X (top-left of bounding box)
  y: number; // document-space Y
  width: number; // display width in document pixels
  height: number; // display height in document pixels
  sourceWidth: number; // original image width
  sourceHeight: number; // original image height
}

export interface Layer {
  id: string;
  name: string;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  deletable: boolean;
  /** When set, layer is a positioned/scaled object rather than full-canvas pixels. */
  transform?: LayerTransform;
  revision: number;
}

const MAX_LAYERS = 20;

export class LayerManager {
  layers: Layer[] = [];
  activeLayerIndex = 0;

  constructor(
    public docWidth: number,
    public docHeight: number,
    background: "white" | "transparent",
  ) {
    const bg = this.createLayer("Background", false);
    if (background === "white") {
      bg.ctx.fillStyle = "#f0f0f0";
      bg.ctx.fillRect(0, 0, docWidth, docHeight);
    }
    this.layers.push(bg);
  }

  get activeLayer(): Layer {
    return this.layers[this.activeLayerIndex]!;
  }

  addLayer(name: string, opts?: { canvasWidth?: number; canvasHeight?: number }): Layer {
    if (this.layers.length >= MAX_LAYERS) {
      throw new Error(`Maximum ${MAX_LAYERS} layers`);
    }
    const layer = this.createLayer(name, true, opts?.canvasWidth, opts?.canvasHeight);
    this.layers.push(layer);
    this.activeLayerIndex = this.layers.length - 1;
    return layer;
  }

  deleteLayer(index: number): void {
    const layer = this.layers[index];
    if (!layer?.deletable) {
      throw new Error("Cannot delete this layer");
    }
    this.layers.splice(index, 1);
    if (this.activeLayerIndex >= this.layers.length) {
      this.activeLayerIndex = this.layers.length - 1;
    }
  }

  duplicateLayer(index: number): Layer {
    if (this.layers.length >= MAX_LAYERS) {
      throw new Error(`Maximum ${MAX_LAYERS} layers`);
    }
    const source = this.layers[index];
    if (!source) throw new Error(`Layer index ${index} out of bounds`);
    const copy = this.createLayer(
      `${source.name} copy`,
      true,
      source.canvas.width,
      source.canvas.height,
    );
    copy.ctx.drawImage(source.canvas, 0, 0);
    copy.opacity = source.opacity;
    copy.blendMode = source.blendMode;
    copy.visible = source.visible;
    copy.locked = source.locked;
    if (source.transform) {
      copy.transform = { ...source.transform };
    }
    this.layers.splice(index + 1, 0, copy);
    this.activeLayerIndex = index + 1;
    return copy;
  }

  moveLayer(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const [layer] = this.layers.splice(fromIndex, 1);
    if (!layer) return;
    this.layers.splice(toIndex, 0, layer);
    if (this.activeLayerIndex === fromIndex) {
      this.activeLayerIndex = toIndex;
    }
  }

  mergeDown(index: number): void {
    if (index <= 0 || index >= this.layers.length) return;
    const upper = this.layers[index];
    const lower = this.layers[index - 1];
    if (!upper || !lower) return;
    lower.ctx.globalAlpha = upper.opacity / 100;
    lower.ctx.globalCompositeOperation = this.blendToComposite(upper.blendMode);
    lower.ctx.drawImage(upper.canvas, 0, 0);
    lower.ctx.globalAlpha = 1;
    lower.ctx.globalCompositeOperation = "source-over";
    this.layers.splice(index, 1);
    if (this.activeLayerIndex >= index) {
      this.activeLayerIndex = Math.max(0, this.activeLayerIndex - 1);
    }
  }

  rasterizeLayer(index: number): void {
    const layer = this.layers[index];
    if (!layer?.transform) return;

    const t = layer.transform;
    const canvas = new OffscreenCanvas(this.docWidth, this.docHeight);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(layer.canvas, t.x, t.y, t.width, t.height);

    layer.canvas = canvas;
    layer.ctx = ctx;
    delete layer.transform;
    // Force compositor cache invalidation: without this, the sprite's cached
    // texture keeps pointing at the old (pre-rasterize) OffscreenCanvas and
    // the rasterize result stays invisible until something else dirties the
    // layer.
    layer.revision++;
  }

  bumpRevision(layerId: string): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (layer) layer.revision++;
  }

  private createLayer(name: string, deletable: boolean, w?: number, h?: number): Layer {
    const canvas = new OffscreenCanvas(w ?? this.docWidth, h ?? this.docHeight);
    const ctx = canvas.getContext("2d")!;
    return {
      id: crypto.randomUUID(),
      name,
      canvas,
      ctx,
      visible: true,
      opacity: 100,
      blendMode: "normal",
      locked: false,
      deletable,
      revision: 0,
    };
  }

  blendToComposite(mode: BlendMode): GlobalCompositeOperation {
    const map: Record<BlendMode, GlobalCompositeOperation> = {
      normal: "source-over",
      multiply: "multiply",
      screen: "screen",
      overlay: "overlay",
      "soft-light": "soft-light",
      "hard-light": "hard-light",
      darken: "darken",
      lighten: "lighten",
      "color-dodge": "color-dodge",
      "color-burn": "color-burn",
    };
    return map[mode];
  }
}
