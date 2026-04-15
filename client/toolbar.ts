export type ToolId =
  | "pen"
  | "pencil"
  | "marker"
  | "watercolor"
  | "highlighter"
  | "eraser"
  | "select"
  | "lasso"
  | "shapes"
  | "arrow"
  | "text"
  | "image";
export type ActionId = "clear";
export type PanelId = "floating" | "response" | "transcript" | "usage" | "annotations";

export interface ToolbarConfig {
  onToolChange: (toolId: ToolId) => void;
  onAction: (actionId: ActionId) => void;
  onPanelToggle?: (panelId: PanelId) => void;
}

// SVG icon factory — 18x18 viewBox, stroke-based, inherits currentColor
function svg(paths: string, fill = false): string {
  const style = fill
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg viewBox="0 0 18 18" width="18" height="18" ${style}>${paths}</svg>`;
}

const ICONS = {
  // Pen — nib shape
  pen: svg('<path d="M12.5 2.5l3 3-9 9H3.5v-3l9-9z"/><path d="M10.5 4.5l3 3"/>'),
  // Pencil — angled pencil
  pencil: svg('<path d="M13.2 2.3l2.5 2.5L6.5 14H4v-2.5L13.2 2.3z"/><path d="M4 14l1.5-4"/>'),
  // Marker — thick chisel-tip marker
  marker: svg(
    '<path d="M5 13l-1.5 3.5L7 15l7-7-3-3-6 6z"/><path d="M11 5l3 3"/><path d="M13 3l2 2"/>',
  ),
  // Watercolor — droplet
  watercolor: svg('<path d="M9 2.5C9 2.5 4 8 4 11.5a5 5 0 0010 0C14 8 9 2.5 9 2.5z"/>'),
  // Highlighter — wide angled stroke
  highlighter: svg(
    '<path d="M4 10l4-7h2l4 7"/><path d="M3.5 10h11" stroke-width="3" opacity="0.5"/><path d="M5 13h8"/>',
  ),
  // Eraser — rectangular eraser
  eraser: svg(
    '<path d="M6 15l-3.5-3.5a2 2 0 010-2.8L9.2 2l6.3 6.3a2 2 0 010 2.8L13 13.5"/><path d="M4.5 15h11"/>',
  ),
  // Image — picture frame with mountain
  image: svg(
    '<rect x="2.5" y="3.5" width="13" height="11" rx="1.5"/><path d="M2.5 12l3.5-3.5 2.5 2.5 3-3.5 4 4.5"/><circle cx="6" cy="7" r="1.2"/>',
  ),
  // Clear — trash can
  clear: svg(
    '<path d="M4.5 5.5v9a1.5 1.5 0 001.5 1.5h6a1.5 1.5 0 001.5-1.5v-9"/><path d="M3 5.5h12"/><path d="M7 5.5V3.5a1 1 0 011-1h2a1 1 0 011 1v2"/>',
  ),
  // Panel: brush/layers — sliders
  sliders: svg(
    '<circle cx="5" cy="5.5" r="1.5"/><path d="M6.5 5.5H16"/><path d="M2 5.5h1.5"/><circle cx="11" cy="9.5" r="1.5"/><path d="M2 9.5h8"/><path d="M12.5 9.5H16"/><circle cx="7" cy="13.5" r="1.5"/><path d="M8.5 13.5H16"/><path d="M2 13.5h3.5"/>',
  ),
  // Panel: response — speech bubble
  chat: svg(
    '<path d="M3 3h12a1 1 0 011 1v7a1 1 0 01-1 1H8l-3 3v-3H3a1 1 0 01-1-1V4a1 1 0 011-1z"/>',
  ),
  // Panel: transcript — document lines
  transcript: svg(
    '<rect x="3" y="2" width="12" height="14" rx="1.5"/><path d="M6 5.5h6"/><path d="M6 8.5h6"/><path d="M6 11.5h4"/>',
  ),
  // Panel: usage — bar chart
  chart: svg(
    '<path d="M3 15V7"/><path d="M7 15V4"/><path d="M11 15V9"/><path d="M15 15V6"/>',
    false,
  ),
  // Panel: annotations — map pin
  pin: svg(
    '<path d="M9 2a5 5 0 00-5 5c0 3.5 5 9 5 9s5-5.5 5-9a5 5 0 00-5-5z"/><circle cx="9" cy="7" r="1.8"/>',
  ),
};

const TOOLS: Array<{ id: ToolId; icon: string; group?: string }> = [
  { id: "pen", icon: ICONS.pen },
  { id: "pencil", icon: ICONS.pencil },
  { id: "marker", icon: ICONS.marker },
  { id: "watercolor", icon: ICONS.watercolor },
  { id: "highlighter", icon: ICONS.highlighter },
  // Eraser disabled per user feedback (pin #2) — feature kept in-tree for possible
  // future reinstatement. Toolbar button hidden, keyboard shortcut (E) inert,
  // brush class still exported but no longer wired into the active brush map.
  // { id: "eraser", icon: ICONS.eraser, group: "separator" },
  // Unimplemented tools hidden until ready:
  // { id: "select", icon: "" },
  // { id: "lasso", icon: "" },
  // { id: "shapes", icon: "", group: "separator" },
  // { id: "arrow", icon: "" },
  // { id: "text", icon: "" },
  { id: "image", icon: ICONS.image, group: "separator" },
];

const ACTIONS: Array<{ id: ActionId; icon: string; title: string }> = [
  { id: "clear", icon: ICONS.clear, title: "Clear Canvas" },
];

const PANEL_BUTTONS: Array<{ id: PanelId; icon: string; title: string }> = [
  // Brush & Layers toggle moved to the top bar per pin #9. The onPanelToggle
  // "floating" branch is still live so external callers (e.g. keyboard shortcut)
  // continue to work — the button here was the only left-toolbar surface.
  // { id: "floating", icon: ICONS.sliders, title: "Brush & Layers" },
  // Response tab hidden — redundant with transcript which shows all responses
  // { id: "response", icon: ICONS.chat, title: "Response Panel" },
  { id: "transcript", icon: ICONS.transcript, title: "Transcript Panel" },
  { id: "annotations", icon: ICONS.pin, title: "Annotations Panel" },
  { id: "usage", icon: ICONS.chart, title: "Usage Panel" },
];

export class Toolbar {
  private container: HTMLElement;
  private activeId: ToolId = "pen";
  private buttons = new Map<ToolId, HTMLButtonElement>();
  private panelButtons = new Map<PanelId, HTMLButtonElement>();

  constructor(
    container: HTMLElement,
    private config: ToolbarConfig,
  ) {
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
      btn.innerHTML = tool.icon; // Safe: hardcoded SVG constants, not user input
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
      btn.innerHTML = action.icon; // Safe: hardcoded SVG constants
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
      btn.innerHTML = panel.icon; // Safe: hardcoded SVG constants
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
