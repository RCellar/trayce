import type { AnnotationRegistry } from "../registry";

export function placePin(
  registry: AnnotationRegistry,
  canvasX: number,
  canvasY: number,
): void {
  registry.createPin({ at: [canvasX, canvasY] });
}
