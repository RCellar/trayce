import type { AnnotationRegistry } from "../registry";

export interface EditOverlay {
  open(opts: {
    x: number;
    y: number;
    onCommit: (text: string) => void;
    onCancel: () => void;
  }): void;
}

export function startTextPlacement(
  registry: AnnotationRegistry,
  canvasX: number,
  canvasY: number,
  editOverlay: EditOverlay,
): void {
  editOverlay.open({
    x: canvasX,
    y: canvasY,
    onCommit: (text) => {
      if (text.trim().length === 0) return;
      registry.createText({ text, bbox: [canvasX, canvasY, 120, 24] });
    },
    onCancel: () => {},
  });
}
