export type ToolId = "pen" | "pencil" | "marker" | "watercolor" | "highlighter" | "eraser" | "select" | "lasso" | "shapes" | "arrow" | "text" | "image";
export type ActionId = "clear";

export interface ToolbarConfig {
  onToolChange: (toolId: ToolId) => void;
  onAction: (actionId: ActionId) => void;
}

const TOOLS: Array<{ id: ToolId; icon: string; group?: string }> = [
  { id: "pen", icon: "✒" },
  { id: "pencil", icon: "✏" },
  { id: "marker", icon: "🖊" },
  { id: "watercolor", icon: "💧" },
  { id: "highlighter", icon: "▬" },
  { id: "eraser", icon: "◻", group: "separator" },
  { id: "select", icon: "⬚" },
  { id: "lasso", icon: "◠" },
  { id: "shapes", icon: "▢", group: "separator" },
  { id: "arrow", icon: "→" },
  { id: "text", icon: "T" },
  { id: "image", icon: "🖼" },
];

const ACTIONS: Array<{ id: ActionId; icon: string; title: string }> = [
  { id: "clear", icon: "🗑", title: "Clear Canvas" },
];

export class Toolbar {
  private container: HTMLElement;
  private activeId: ToolId = "pen";
  private buttons = new Map<ToolId, HTMLButtonElement>();

  constructor(container: HTMLElement, private config: ToolbarConfig) {
    this.container = container;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = "";

    for (const tool of TOOLS) {
      if (tool.group === "separator") {
        const sep = document.createElement("div");
        sep.className = "separator";
        this.container.appendChild(sep);
      }

      const btn = document.createElement("button");
      btn.textContent = tool.icon;
      btn.title = tool.id.charAt(0).toUpperCase() + tool.id.slice(1);
      btn.dataset.tool = tool.id;
      if (tool.id === this.activeId) btn.classList.add("active");

      btn.addEventListener("click", () => this.setActive(tool.id));
      this.container.appendChild(btn);
      this.buttons.set(tool.id, btn);
    }

    // Spacer to push actions to bottom
    const spacer = document.createElement("div");
    spacer.style.flex = "1";
    this.container.appendChild(spacer);

    // Action buttons (clear, etc.)
    const sep = document.createElement("div");
    sep.className = "separator";
    this.container.appendChild(sep);

    for (const action of ACTIONS) {
      const btn = document.createElement("button");
      btn.textContent = action.icon;
      btn.title = action.title;
      btn.addEventListener("click", () => this.config.onAction(action.id));
      this.container.appendChild(btn);
    }
  }

  setActive(id: ToolId): void {
    this.buttons.get(this.activeId)?.classList.remove("active");
    this.activeId = id;
    this.buttons.get(id)?.classList.add("active");
    this.config.onToolChange(id);
  }

  getActive(): ToolId {
    return this.activeId;
  }
}
