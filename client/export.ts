import type { LayerManager } from "./layers";

export async function flattenToPng(layerManager: LayerManager): Promise<Blob> {
  const { docWidth, docHeight, layers } = layerManager;
  const canvas = new OffscreenCanvas(docWidth, docHeight);
  const ctx = canvas.getContext("2d")!;

  for (const layer of layers) {
    if (!layer.visible) continue;
    ctx.globalAlpha = layer.opacity / 100;
    ctx.globalCompositeOperation = layerManager.blendToComposite(layer.blendMode);
    if (layer.transform) {
      const t = layer.transform;
      ctx.drawImage(layer.canvas, t.x, t.y, t.width, t.height);
    } else {
      ctx.drawImage(layer.canvas, 0, 0);
    }
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  return canvas.convertToBlob({ type: "image/png" });
}

/**
 * Returns true if the canvas contains only the white background with no user
 * content. Ignores the background layer (index 0) and returns false on the
 * first non-transparent pixel in any user layer.
 *
 * Implementation: one getImageData per layer covering the full canvas, then
 * a linear scan of the alpha channel. Short-circuits on the first hit.
 * Previously this sampled a 20×20 grid, which missed thin strokes entirely
 * on large canvases (a 1920×1080 canvas had a 96×54 pixel grid, wider than
 * most pen strokes).
 */
export function isCanvasBlank(layerManager: LayerManager): boolean {
  const { docWidth, docHeight, layers } = layerManager;
  for (let i = 1; i < layers.length; i++) {
    const layer = layers[i]!;
    if (!layer.visible) continue;
    // Transform (image) layers always have content
    if (layer.transform) return false;
    const data = layer.ctx.getImageData(0, 0, docWidth, docHeight).data;
    // Alpha channel is every 4th byte in RGBA
    for (let j = 3; j < data.length; j += 4) {
      if (data[j]! > 0) return false;
    }
  }
  return true;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function downloadPng(
  layerManager: LayerManager,
  filename = "trayce.png",
): Promise<void> {
  const blob = await flattenToPng(layerManager);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
