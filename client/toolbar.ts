export type ToolId = "pen" | "pencil" | "marker" | "watercolor" | "highlighter" | "eraser" | "select" | "lasso" | "shapes" | "arrow" | "text" | "image";
export type ActionId = "clear";
export type PanelId = "response" | "transcript";

export interface ToolbarConfig {
  onToolChange: (toolId: ToolId) => void;
  onAction: (actionId: ActionId) => void;
  onPanelToggle?: (panelId: PanelId) => void;
}

const TOOLS: Array<{ id: ToolId; icon: string; group?: string }> = [
  { id: "pen", icon: "✒" },
  { id: "pencil", icon: "✏" },
  { id: "marker", icon: "🖊" },
  { id: "watercolor", icon: "💧" },
  { id: "highlighter", icon: "▬" },
  { id: "eraser", icon: "◻", group: "separator" },
  // Unimplemented tools hidden until ready:
  // { id: "select", icon: "⬚" },
  // { id: "lasso", icon: "◠" },
  // { id: "shapes", icon: "▢", group: "separator" },
  // { id: "arrow", icon: "→" },
  // { id: "text", icon: "T" },
  // { id: "image", icon: "🖼" },
];

const ACTIONS: Array<{ id: ActionId; icon: string; title: string }> = [
  { id: "clear", icon: "🗑", title: "Clear Canvas" },
];

const PANEL_BUTTONS: Array<{ id: PanelId; icon: string; title: string }> = [
  { id: "response", icon: "\uD83D\uDCAC", title: "Response Panel" },
  { id: "transcript", icon: "\uD83D\uDCDC", title: "Transcript Panel" },
];

export class Toolbar {
  private container: HTMLElement;
  private activeId: ToolId = "pen";
  private buttons = new Map<ToolId, HTMLButtonElement>();
  private panelButtons = new Map<PanelId, HTMLButtonElement>();

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

    // Panel toggle buttons
    const panelSep = document.createElement("div");
    panelSep.className = "separator";
    this.container.appendChild(panelSep);

    for (const panel of PANEL_BUTTONS) {
      const btn = document.createElement("button");
      btn.textContent = panel.icon;
      btn.title = panel.title;
      btn.className = "panel-toggle";
      btn.dataset.panel = panel.id;
      btn.addEventListener("click", () => this.config.onPanelToggle?.(panel.id));
      this.container.appendChild(btn);
      this.panelButtons.set(panel.id, btn);
    }
  }

  setPanelActive(id: PanelId | null): void {
    for (const [pid, btn] of this.panelButtons) {
      btn.classList.toggle("active", pid === id);
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
