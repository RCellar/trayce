import type { LayerManager } from "./layers";
import type { Annotation, AnnotationStatus } from "./annotations/types";

const STATUS_HEX: Record<AnnotationStatus, string> = {
  open: "#dc2626",
  addressed: "#059669",
  "needs-clarification": "#d97706",
  rejected: "#6b7280",
  deleted: "#000000", // unreachable — filtered before draw
};

export function drawAnnotationsOnto(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  annotations: Annotation[],
): void {
  for (const a of annotations) {
    if (a.status === "deleted") continue;
    const color = STATUS_HEX[a.status];
    if (a.kind === "pin") {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(a.at[0], a.at[1], 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(a.number), a.at[0], a.at[1]);
    } else if (a.kind === "text") {
      ctx.fillStyle = color;
      ctx.font = `${a.style.weight} ${a.style.fontSize}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(a.text, a.bbox[0], a.bbox[1]);
    } else {
      // callout
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      // leader line from label-box center to target
      const cx = a.bbox[0] + a.bbox[2] / 2;
      const cy = a.bbox[1] + a.bbox[3] / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(a.target[0], a.target[1]);
      ctx.stroke();
      // target dot
      ctx.beginPath();
      ctx.arc(a.target[0], a.target[1], 3, 0, Math.PI * 2);
      ctx.fill();
      // label box (stroked, translucent fill)
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillRect(a.bbox[0], a.bbox[1], a.bbox[2], a.bbox[3]);
      ctx.restore();
      ctx.strokeRect(a.bbox[0], a.bbox[1], a.bbox[2], a.bbox[3]);
      // label text
      ctx.fillStyle = color;
      ctx.font = `${a.style.fontSize}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(a.text, a.bbox[0] + 4, a.bbox[1] + 4);
    }

    // Claude-authored additional marking
    if (a.author === "claude") {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      if (a.kind === "pin") {
        ctx.beginPath();
        ctx.arc(a.at[0], a.at[1], 14, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(a.bbox[0] - 2, a.bbox[1] - 2, a.bbox[2] + 4, a.bbox[3] + 4);
      }
      ctx.restore();
      ctx.fillStyle = color;
      ctx.font = "10px sans-serif";
      const sx = a.kind === "pin" ? a.at[0] - 14 : a.bbox[0] - 14;
      const sy = a.kind === "pin" ? a.at[1] - 14 : a.bbox[1] - 14;
      ctx.fillText("✨", sx, sy);
    }
  }
}

export async function flattenToPng(
  layerManager: LayerManager,
  annotations: Annotation[] = [],
): Promise<Blob> {
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

  drawAnnotationsOnto(ctx, annotations);

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
  annotations: Annotation[] = [],
  filename = "trayce.png",
): Promise<void> {
  const blob = await flattenToPng(layerManager, annotations);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
