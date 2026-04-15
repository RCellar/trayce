import type { AnnotationRegistry } from "../registry";

export interface EditOverlay {
  /**
   * Open a transient text-entry overlay. `screenX` / `screenY` position the
   * overlay in viewport pixels (where the user clicked), while the caller is
   * responsible for any canvas-space coordinates needed to create the
   * annotation itself.
   */
  open(opts: {
    screenX: number;
    screenY: number;
    onCommit: (text: string) => void;
    onCancel: () => void;
  }): void;
}

export function startTextPlacement(
  registry: AnnotationRegistry,
  canvasX: number,
  canvasY: number,
  screenX: number,
  screenY: number,
  editOverlay: EditOverlay,
): void {
  editOverlay.open({
    screenX,
    screenY,
    onCommit: (text) => {
      if (text.trim().length === 0) return;
      registry.createText({ text, bbox: [canvasX, canvasY, 120, 24] });
    },
    onCancel: () => {},
  });
}
