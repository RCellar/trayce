import type { LayerManager } from "./layers";

export async function flattenToPng(layerManager: LayerManager): Promise<Blob> {
  const { docWidth, docHeight, layers } = layerManager;
  const canvas = new OffscreenCanvas(docWidth, docHeight);
  const ctx = canvas.getContext("2d")!;

  for (const layer of layers) {
    if (!layer.visible) continue;
    ctx.globalAlpha = layer.opacity / 100;
    ctx.globalCompositeOperation = layerManager.blendToComposite(layer.blendMode);
    ctx.drawImage(layer.canvas, 0, 0);
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  return canvas.convertToBlob({ type: "image/png" });
}

/**
 * Returns true if the canvas contains only the white background with no user content.
 * Checks a grid of sample points for non-white pixels.
 */
export function isCanvasBlank(layerManager: LayerManager): boolean {
  const { docWidth, docHeight, layers } = layerManager;
  // If only the background layer exists, check if it's all white
  // If user-created layers exist with visible content, not blank
  for (let i = 1; i < layers.length; i++) {
    if (!layers[i].visible) continue;
    const ctx = layers[i].ctx;
    // Sample a grid of points for non-transparent pixels
    const stepX = Math.max(1, Math.floor(docWidth / 20));
    const stepY = Math.max(1, Math.floor(docHeight / 20));
    for (let x = 0; x < docWidth; x += stepX) {
      for (let y = 0; y < docHeight; y += stepY) {
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        if (pixel[3] > 0) return false; // non-transparent pixel found
      }
    }
  }
  return true;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function downloadPng(layerManager: LayerManager, filename = "trayce.png"): Promise<void> {
  const blob = await flattenToPng(layerManager);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
