import type { LayerManager } from "./layers";

export interface LayersUIConfig {
  onActiveChange: (index: number) => void;
  onVisibilityToggle: (index: number) => void;
  onAddLayer: () => void;
  onDeleteLayer: (index: number) => void;
  onMoveLayer?: (fromIndex: number, toIndex: number) => void;
  onRasterize?: (index: number) => void;
}

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
      if (!layer) continue;
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
      if (layer.transform) {
        const badge = document.createElement("span");
        badge.textContent = " img";
        badge.style.cssText = "font-size:9px;opacity:0.5;font-style:italic;";
        name.appendChild(badge);
      }

      // Blend mode
      const blend = document.createElement("span");
      blend.className = "blend-mode";
      blend.textContent = layer.blendMode === "normal" ? "" : layer.blendMode;

      // Actions
      const actions = document.createElement("span");
      actions.className = "layer-actions";

      // Move up/down buttons (up = higher z-order = higher array index)
      const lastIndex = this.layerManager.layers.length - 1;
      if (this.config.onMoveLayer && i > 0) {
        const downBtn = document.createElement("span");
        downBtn.className = "layer-move";
        downBtn.textContent = "\u25BC"; // down arrow
        downBtn.title = "Move down";
        downBtn.style.cssText = "cursor:pointer;margin-right:2px;opacity:0.5;font-size:9px;";
        downBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.config.onMoveLayer!(i, i - 1);
        });
        actions.appendChild(downBtn);
      }
      if (this.config.onMoveLayer && i < lastIndex) {
        const upBtn = document.createElement("span");
        upBtn.className = "layer-move";
        upBtn.textContent = "\u25B2"; // up arrow
        upBtn.title = "Move up";
        upBtn.style.cssText = "cursor:pointer;margin-right:4px;opacity:0.5;font-size:9px;";
        upBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.config.onMoveLayer!(i, i + 1);
        });
        actions.appendChild(upBtn);
      }

      // Rasterize button for transform layers
      if (layer.transform && this.config.onRasterize) {
        const rastBtn = document.createElement("span");
        rastBtn.className = "layer-rasterize";
        rastBtn.textContent = "\u25A3";
        rastBtn.title = "Rasterize (flatten to pixels)";
        rastBtn.style.cssText = "cursor:pointer;margin-right:4px;opacity:0.6;";
        rastBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.config.onRasterize!(i);
        });
        actions.appendChild(rastBtn);
      }

      // Delete button (only for deletable layers)
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
