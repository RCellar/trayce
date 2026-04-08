import { Sprite, Texture, Container, Graphics, ImageSource, type Application, type BLEND_MODES } from "pixi.js";
import type { LayerManager, BlendMode, LayerTransform } from "./layers";

const BLEND_MAP: Record<BlendMode, BLEND_MODES> = {
  "normal": "normal",
  "multiply": "multiply",
  "screen": "screen",
  "overlay": "overlay",
  "soft-light": "soft-light",
  "hard-light": "hard-light",
  "darken": "darken",
  "lighten": "lighten",
  "color-dodge": "color-dodge",
  "color-burn": "color-burn",
};

export class Compositor {
  private sprites = new Map<string, Sprite>();
  private spriteRevisions = new Map<string, number>();
  private container: Container;
  private overlay: Graphics;
  private dirty = true;

  constructor(private app: Application, private layerManager: LayerManager) {
    this.container = new Container();
    this.overlay = new Graphics();
    // Overlay is added to app.stage directly so it draws in screen space
    // (after the compositor container which is inside the zoom/pan stage)
  }

  getContainer(): Container {
    return this.container;
  }

  getOverlay(): Graphics {
    return this.overlay;
  }

  markDirty(): void {
    this.dirty = true;
  }

  update(): void {
    if (!this.dirty) return;
    // Renderer is guaranteed present after Application.init() resolves.
    if (!this.app.renderer) return;
    this.dirty = false;

    // Remove sprites for deleted layers
    const activeIds = new Set(this.layerManager.layers.map((l) => l.id));
    for (const [id, sprite] of this.sprites) {
      if (!activeIds.has(id)) {
        this.container.removeChild(sprite);
        sprite.destroy(true);
        this.sprites.delete(id);
        this.spriteRevisions.delete(id);
      }
    }

    // Update or create sprites for each layer
    for (let i = 0; i < this.layerManager.layers.length; i++) {
      const layer = this.layerManager.layers[i];
      let sprite = this.sprites.get(layer.id);

      if (!sprite) {
        sprite = new Sprite();
        this.sprites.set(layer.id, sprite);
        this.container.addChild(sprite);
      }

      // Only recreate texture if layer content changed
      const lastRev = this.spriteRevisions.get(layer.id) ?? -1;
      if (lastRev !== layer.revision) {
        const source = new ImageSource({ resource: layer.canvas });
        const oldTexture = sprite.texture;
        sprite.texture = new Texture({ source });
        if (oldTexture !== Texture.EMPTY) oldTexture.destroy(true);
        this.spriteRevisions.set(layer.id, layer.revision);
      }

      // Apply transform for image layers, reset for regular layers
      if (layer.transform) {
        sprite.position.set(layer.transform.x, layer.transform.y);
        sprite.scale.set(
          layer.transform.width / layer.transform.sourceWidth,
          layer.transform.height / layer.transform.sourceHeight,
        );
      } else {
        sprite.position.set(0, 0);
        sprite.scale.set(1, 1);
      }

      sprite.visible = layer.visible;
      sprite.alpha = layer.opacity / 100;
      sprite.blendMode = BLEND_MAP[layer.blendMode] ?? "normal";

      // Ensure correct z-order
      this.container.setChildIndex(sprite, i);
    }
  }

  /** Draw bounding box and resize handles for the active transform layer.
   *  Called from app.ts after update(), passing screen-space coordinates. */
  drawTransformOverlay(
    stageX: number, stageY: number, zoom: number,
    t: LayerTransform,
  ): void {
    const g = this.overlay;
    g.clear();

    // Convert document coords to screen coords
    const sx = stageX + t.x * zoom;
    const sy = stageY + t.y * zoom;
    const sw = t.width * zoom;
    const sh = t.height * zoom;

    // Bounding box — dashed look via two strokes
    g.rect(sx, sy, sw, sh);
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
    g.rect(sx, sy, sw, sh);
    g.stroke({ width: 1, color: 0x4488ff, alpha: 0.8 });

    // Handles — 8 points
    const hs = 4; // half-size of handle
    const handles = [
      [sx, sy], [sx + sw / 2, sy], [sx + sw, sy],
      [sx, sy + sh / 2], [sx + sw, sy + sh / 2],
      [sx, sy + sh], [sx + sw / 2, sy + sh], [sx + sw, sy + sh],
    ];
    for (const [hx, hy] of handles) {
      g.rect(hx - hs, hy - hs, hs * 2, hs * 2);
      g.fill({ color: 0xffffff });
      g.rect(hx - hs, hy - hs, hs * 2, hs * 2);
      g.stroke({ width: 1, color: 0x4488ff });
    }
  }

  clearOverlay(): void {
    this.overlay.clear();
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) {
      sprite.destroy(true);
    }
    this.sprites.clear();
    this.spriteRevisions.clear();
    this.overlay.destroy();
    this.container.destroy();
  }
}
