import { Sprite, Texture, Container, ImageSource, type Application } from "pixi.js";
import type { LayerManager, BlendMode } from "./layers";

const BLEND_MAP: Record<BlendMode, string> = {
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
  private container: Container;
  private dirty = true;

  constructor(private app: Application, private layerManager: LayerManager) {
    this.container = new Container();
  }

  getContainer(): Container {
    return this.container;
  }

  markDirty(): void {
    this.dirty = true;
  }

  update(): void {
    if (!this.dirty) return;
    this.dirty = false;

    // Remove sprites for deleted layers
    const activeIds = new Set(this.layerManager.layers.map((l) => l.id));
    for (const [id, sprite] of this.sprites) {
      if (!activeIds.has(id)) {
        this.container.removeChild(sprite);
        sprite.destroy(true);
        this.sprites.delete(id);
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

      // Use createImageBitmap (copies, does NOT clear the canvas)
      createImageBitmap(layer.canvas).then((bitmap) => {
        if (sprite) {
          const source = new ImageSource({ resource: bitmap });
          const oldTexture = sprite.texture;
          sprite.texture = new Texture({ source });
          if (oldTexture) oldTexture.destroy(true);
        }
      });

      sprite.visible = layer.visible;
      sprite.alpha = layer.opacity / 100;
      sprite.blendMode = BLEND_MAP[layer.blendMode] ?? "normal";

      // Ensure correct z-order
      this.container.setChildIndex(sprite, i);
    }
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) {
      sprite.destroy(true);
    }
    this.sprites.clear();
    this.container.destroy();
  }
}
