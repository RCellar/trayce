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
