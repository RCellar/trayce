import type { AnnotationRegistry } from "../registry";
import type { EditOverlay } from "./text-tool";

export class CalloutPlacement {
  private target: [number, number] | null = null;

  onClick(
    registry: AnnotationRegistry,
    canvasX: number,
    canvasY: number,
    screenX: number,
    screenY: number,
    editOverlay: EditOverlay,
  ): void {
    if (!this.target) {
      this.target = [canvasX, canvasY];
      return;
    }
    const target = this.target;
    this.target = null;
    editOverlay.open({
      screenX,
      screenY,
      onCommit: (text) => {
        if (text.trim().length === 0) return;
        registry.createCallout({
          text,
          bbox: [canvasX, canvasY, 120, 24],
          target,
        });
      },
      onCancel: () => {},
    });
  }

  reset(): void {
    this.target = null;
  }
}
