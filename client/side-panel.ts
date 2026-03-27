export type PanelTab = "response" | "transcript";

export class SidePanel {
  isOpen = false;
  activeTab: PanelTab | null = null;

  private container: HTMLElement | null = null;
  private tabBar: HTMLElement | null = null;
  private responseContent: HTMLElement | null = null;
  private transcriptContent: HTMLElement | null = null;
  private resizeHandle: HTMLElement | null = null;
  private width = 340;
  private minWidth = 240;
  private onResize: (() => void) | undefined;

  mount(container: HTMLElement, onResize?: () => void): void {
    this.container = container;
    this.onResize = onResize;

    // Resize handle
    this.resizeHandle = document.createElement("div");
    this.resizeHandle.className = "panel-resize-handle";
    container.appendChild(this.resizeHandle);

    // Tab bar
    this.tabBar = document.createElement("div");
    this.tabBar.className = "panel-tabs";

    const responseBtn = document.createElement("button");
    responseBtn.className = "panel-tab";
    responseBtn.dataset.tab = "response";
    responseBtn.textContent = "Response";
    responseBtn.addEventListener("click", () => this.toggle("response"));

    const transcriptBtn = document.createElement("button");
    transcriptBtn.className = "panel-tab";
    transcriptBtn.dataset.tab = "transcript";
    transcriptBtn.textContent = "Transcript";
    transcriptBtn.addEventListener("click", () => this.toggle("transcript"));

    const closeBtn = document.createElement("button");
    closeBtn.className = "panel-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => {
      if (this.activeTab) this.toggle(this.activeTab);
    });

    this.tabBar.appendChild(responseBtn);
    this.tabBar.appendChild(transcriptBtn);
    this.tabBar.appendChild(closeBtn);
    container.appendChild(this.tabBar);

    // Response content area
    this.responseContent = document.createElement("div");
    this.responseContent.className = "panel-content response-content";
    container.appendChild(this.responseContent);

    // Transcript content area
    this.transcriptContent = document.createElement("div");
    this.transcriptContent.className = "panel-content transcript-content";
    container.appendChild(this.transcriptContent);

    this.setupResize();
    this.updateDOM();
  }

  toggle(tab: PanelTab): void {
    if (!this.isOpen) {
      // Panel is closed — open it with the requested tab
      this.isOpen = true;
      this.activeTab = tab;
    } else if (this.activeTab === tab) {
      // Same tab — close the panel
      this.isOpen = false;
      this.activeTab = null;
    } else {
      // Different tab — switch tabs, stay open
      this.activeTab = tab;
    }
    this.updateDOM();
  }

  setActiveTab(tab: PanelTab): void {
    this.activeTab = tab;
    this.updateDOM();
  }

  getResponseContainer(): HTMLElement | null {
    return this.responseContent;
  }

  getTranscriptContainer(): HTMLElement | null {
    return this.transcriptContent;
  }

  private updateDOM(): void {
    if (!this.container) return;

    if (this.isOpen) {
      this.container.classList.add("open");
      this.container.style.width = `${this.width}px`;
    } else {
      this.container.classList.remove("open");
      this.container.style.width = "0";
    }

    // Update tab active states
    if (this.tabBar) {
      const tabs = this.tabBar.querySelectorAll<HTMLButtonElement>(".panel-tab");
      tabs.forEach((btn) => {
        if (btn.dataset.tab === this.activeTab) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    }

    // Show/hide content areas
    if (this.responseContent) {
      this.responseContent.style.display =
        this.isOpen && this.activeTab === "response" ? "" : "none";
    }
    if (this.transcriptContent) {
      this.transcriptContent.style.display =
        this.isOpen && this.activeTab === "transcript" ? "" : "none";
    }
  }

  private setupResize(): void {
    if (!this.resizeHandle) return;

    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      const newWidth = Math.max(
        this.minWidth,
        Math.min(window.innerWidth * 0.5, startWidth + delta)
      );
      this.width = newWidth;
      if (this.container) {
        this.container.style.width = `${newWidth}px`;
      }
      if (this.onResize) this.onResize();
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    this.resizeHandle.addEventListener("mousedown", (e: MouseEvent) => {
      startX = e.clientX;
      startWidth = this.width;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
    });
  }
}
