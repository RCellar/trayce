export interface FloatingPanelConfig {
  defaultX: number;
  defaultY: number;
}

type TabId = "brush" | "layers";

export class FloatingPanel {
  private el: HTMLElement | null = null;
  private tabContents = new Map<TabId, HTMLElement>();
  private activeTab: TabId = "brush";
  private isVisible = true;
  private x = 0;
  private y = 0;
  private parentEl: HTMLElement | null = null;

  constructor(private config: FloatingPanelConfig) {
    this.loadState();
  }

  mount(parent: HTMLElement): void {
    this.parentEl = parent;

    this.el = document.createElement("div");
    this.el.className = "floating-panel";

    const tabBar = document.createElement("div");
    tabBar.className = "fp-tabbar";

    const brushTab = this.createTab("brush", "Brush");
    const layersTab = this.createTab("layers", "Layers");

    const closeBtn = document.createElement("button");
    closeBtn.className = "fp-close";
    closeBtn.textContent = "\u00D7";
    closeBtn.addEventListener("click", () => this.hide());

    tabBar.appendChild(brushTab);
    tabBar.appendChild(layersTab);
    tabBar.appendChild(closeBtn);
    this.el.appendChild(tabBar);

    const brushContent = document.createElement("div");
    brushContent.className = "fp-content";
    this.tabContents.set("brush", brushContent);
    this.el.appendChild(brushContent);

    const layersContent = document.createElement("div");
    layersContent.className = "fp-content";
    layersContent.style.display = "none";
    this.tabContents.set("layers", layersContent);
    this.el.appendChild(layersContent);

    this.applyPosition();
    parent.appendChild(this.el);
    this.setupDrag(tabBar);

    if (!this.isVisible) {
      this.el.style.display = "none";
    }

    this.updateTabs();
  }

  getBrushContainer(): HTMLElement | null {
    return this.tabContents.get("brush") ?? null;
  }

  getLayersContainer(): HTMLElement | null {
    return this.tabContents.get("layers") ?? null;
  }

  show(): void {
    this.isVisible = true;
    if (this.el) this.el.style.display = "";
    this.saveState();
  }

  hide(): void {
    this.isVisible = false;
    if (this.el) this.el.style.display = "none";
    this.saveState();
  }

  toggle(): void {
    if (this.isVisible) this.hide();
    else this.show();
  }

  get visible(): boolean {
    return this.isVisible;
  }

  private createTab(id: TabId, label: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "fp-tab";
    btn.dataset.tab = id;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      this.activeTab = id;
      this.updateTabs();
      this.saveState();
    });
    return btn;
  }

  private updateTabs(): void {
    if (!this.el) return;
    const tabs = this.el.querySelectorAll<HTMLButtonElement>(".fp-tab");
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === this.activeTab));

    for (const [id, content] of this.tabContents) {
      content.style.display = id === this.activeTab ? "" : "none";
    }
  }

  private applyPosition(): void {
    if (!this.el || !this.parentEl) return;
    const rect = this.parentEl.getBoundingClientRect();

    if (this.x === 0 && this.y === 0) {
      this.x = rect.width - this.config.defaultX - 280;
      this.y = this.config.defaultY;
    }

    this.x = Math.max(0, Math.min(this.x, rect.width - 280));
    this.y = Math.max(0, Math.min(this.y, rect.height - 100));

    this.el.style.left = this.x + "px";
    this.el.style.top = this.y + "px";
  }

  private setupDrag(handle: HTMLElement): void {
    let startX = 0;
    let startY = 0;
    let startPosX = 0;
    let startPosY = 0;

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      this.x = startPosX + dx;
      this.y = startPosY + dy;

      if (this.parentEl) {
        const rect = this.parentEl.getBoundingClientRect();
        this.x = Math.max(0, Math.min(this.x, rect.width - 280));
        this.y = Math.max(0, Math.min(this.y, rect.height - 100));
      }

      if (this.el) {
        this.el.style.left = this.x + "px";
        this.el.style.top = this.y + "px";
      }
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      this.saveState();
    };

    handle.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      startPosX = this.x;
      startPosY = this.y;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  private saveState(): void {
    localStorage.setItem("trayce-floating-panel", JSON.stringify({
      x: this.x,
      y: this.y,
      tab: this.activeTab,
      visible: this.isVisible,
    }));
  }

  private loadState(): void {
    try {
      const raw = localStorage.getItem("trayce-floating-panel");
      if (!raw) return;
      const state = JSON.parse(raw);
      if (typeof state.x === "number") this.x = state.x;
      if (typeof state.y === "number") this.y = state.y;
      if (state.tab === "brush" || state.tab === "layers") this.activeTab = state.tab;
      if (typeof state.visible === "boolean") this.isVisible = state.visible;
    } catch {}
  }
}
