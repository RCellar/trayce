import type { LayerManager, BlendMode } from "./layers";

export interface LayersUIConfig {
  onActiveChange: (index: number) => void;
  onVisibilityToggle: (index: number) => void;
  onAddLayer: () => void;
  onDeleteLayer: (index: number) => void;
}

const BLEND_OPTIONS: BlendMode[] = [
  "normal", "multiply", "screen", "overlay",
  "soft-light", "hard-light", "darken", "lighten",
  "color-dodge", "color-burn",
];

export class LayersUI {
  private container: HTMLElement;

  constructor(
    container: HTMLElement,
    private layerManager: LayerManager,
    private config: LayersUIConfig
  ) {
    this.container = container;
    this.render();
  }

  render(): void {
    this.container.innerHTML = "";

    // Header
    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
    const label = document.createElement("div");
    label.className = "panel-label";
    label.textContent = "Layers";
    const addBtn = document.createElement("button");
    addBtn.textContent = "+";
    addBtn.style.cssText = "background:none;border:none;color:var(--accent);font-size:16px;cursor:pointer;";
    addBtn.addEventListener("click", () => this.config.onAddLayer());
    header.appendChild(label);
    header.appendChild(addBtn);
    this.container.appendChild(header);

    // Layer list (bottom to top)
    for (let i = this.layerManager.layers.length - 1; i >= 0; i--) {
      const layer = this.layerManager.layers[i];
      const item = document.createElement("div");
      item.className = `layer-item${i === this.layerManager.activeLayerIndex ? " active" : ""}`;

      // Visibility toggle
      const vis = document.createElement("span");
      vis.className = "visibility";
      vis.textContent = layer.visible ? "\u25C9" : "\u25CE";
      vis.title = layer.visible ? "Hide layer" : "Show layer";
      vis.style.opacity = layer.visible ? "1" : "0.4";
      vis.addEventListener("click", (e) => {
        e.stopPropagation();
        this.config.onVisibilityToggle(i);
      });

      // Name
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = layer.name;
      if (!layer.visible) name.style.opacity = "0.4";

      // Blend mode
      const blend = document.createElement("span");
      blend.className = "blend-mode";
      blend.textContent = layer.blendMode === "normal" ? "" : layer.blendMode;

      // Delete button (only for deletable layers)
      const actions = document.createElement("span");
      actions.className = "layer-actions";
      if (layer.deletable) {
        const delBtn = document.createElement("span");
        delBtn.className = "layer-delete";
        delBtn.textContent = "\u00D7";
        delBtn.title = "Delete layer";
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.config.onDeleteLayer(i);
        });
        actions.appendChild(delBtn);
      }

      item.appendChild(vis);
      item.appendChild(name);
      item.appendChild(blend);
      item.appendChild(actions);

      item.addEventListener("click", () => this.config.onActiveChange(i));

      this.container.appendChild(item);
    }
  }
}
