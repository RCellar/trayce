import { renderMarkdown } from "./markdown";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export class ResponseTab {
  private container: HTMLElement | null = null;
  private autoScroll = true;
  private autoScrollBtn: HTMLButtonElement | null = null;
  private entries: Array<
    | { type: "response"; content: string; timestamp?: number | undefined }
    | { type: "canvas-push"; image: string; label: string }
  > = [];
  private mode: "recent" | "complete" = "recent";
  private sessionStartedAt: number | null = null;
  private toggleEl: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.container = container;

    container.addEventListener("scroll", () => {
      const { scrollHeight, scrollTop, clientHeight } = container;
      const atBottom = scrollHeight - scrollTop - clientHeight < 30;
      if (this.autoScroll && !atBottom) {
        this.autoScroll = false;
        this.updateAutoScrollBtn();
      } else if (!this.autoScroll && atBottom) {
        this.autoScroll = true;
        this.updateAutoScrollBtn();
      }
    });

    this.autoScrollBtn = document.createElement("button");
    this.autoScrollBtn.className = "autoscroll-btn active";
    this.autoScrollBtn.textContent = "Auto-scroll";
    this.autoScrollBtn.addEventListener("click", () => {
      this.autoScroll = !this.autoScroll;
      this.updateAutoScrollBtn();
      if (this.autoScroll) {
        this.container!.scrollTop = this.container!.scrollHeight;
      }
    });
    container.appendChild(this.autoScrollBtn);
  }

  private updateAutoScrollBtn(): void {
    if (!this.autoScrollBtn) return;
    this.autoScrollBtn.classList.toggle("active", this.autoScroll);
  }

  setSessionStartedAt(ts: number | null): void {
    this.sessionStartedAt = ts;
    if (this.container && !this.toggleEl && ts !== null) {
      this.toggleEl = this.createToggle();
      this.autoScrollBtn?.insertAdjacentElement("afterend", this.toggleEl);
    }
    if (this.mode === "recent") {
      this.rerender();
    }
  }

  private setMode(mode: "recent" | "complete"): void {
    this.mode = mode;
    this.updateToggleUI();
    this.rerender();
  }

  private createToggle(): HTMLElement {
    const toggle = document.createElement("div");
    toggle.className = "tab-toggle";

    const recentBtn = document.createElement("button");
    recentBtn.textContent = "Recent";
    recentBtn.classList.toggle("active", this.mode === "recent");
    recentBtn.addEventListener("click", () => this.setMode("recent"));

    const completeBtn = document.createElement("button");
    completeBtn.textContent = "Complete";
    completeBtn.classList.toggle("active", this.mode === "complete");
    completeBtn.addEventListener("click", () => this.setMode("complete"));

    toggle.appendChild(recentBtn);
    toggle.appendChild(completeBtn);
    return toggle;
  }

  private updateToggleUI(): void {
    if (!this.toggleEl) return;
    const buttons = this.toggleEl.querySelectorAll("button");
    buttons[0]?.classList.toggle("active", this.mode === "recent");
    buttons[1]?.classList.toggle("active", this.mode === "complete");
  }

  private rerender(): void {
    if (!this.container) return;
    this.container.textContent = "";

    if (this.autoScrollBtn) {
      this.container.appendChild(this.autoScrollBtn);
    }
    if (this.toggleEl) {
      this.container.appendChild(this.toggleEl);
    }

    for (const entry of this.entries) {
      if (entry.type === "response") {
        if (this.mode === "recent" && this.sessionStartedAt !== null) {
          if (entry.timestamp && entry.timestamp < this.sessionStartedAt) continue;
        }
        this.renderResponse(entry.content, entry.timestamp);
      } else {
        this.renderCanvasPush(entry.image, entry.label);
      }
    }
  }

  addResponse(content: string, timestamp?: number): void {
    if (!this.container) return;
    this.entries.push({ type: "response", content, timestamp });
    if (this.mode === "recent" && this.sessionStartedAt !== null) {
      if (timestamp && timestamp < this.sessionStartedAt) return;
    }
    this.renderResponse(content, timestamp);
    this.scrollToBottomIfEnabled();
  }

  private renderResponse(content: string, timestamp?: number): void {
    if (!this.container) return;

    const block = document.createElement("div");
    block.className = "msg-block";

    const label = document.createElement("div");
    label.className = "msg-label";
    label.textContent = "Claude";

    if (timestamp) {
      const time = document.createElement("span");
      time.className = "entry-time";
      time.textContent = formatTime(timestamp);
      label.appendChild(time);
    }

    const body = document.createElement("div");
    body.className = "msg-body";
    body.innerHTML = renderMarkdown(content);

    block.appendChild(label);
    block.appendChild(body);
    this.container.appendChild(block);
  }

  addCanvasPushNotification(imageBase64: string, layerLabel: string): void {
    if (!this.container) return;
    this.entries.push({ type: "canvas-push", image: imageBase64, label: layerLabel });
    this.renderCanvasPush(imageBase64, layerLabel);
    this.scrollToBottomIfEnabled();
  }

  private renderCanvasPush(imageBase64: string, layerLabel: string): void {
    if (!this.container) return;

    const notification = document.createElement("div");
    notification.className = "canvas-push-notification";

    const img = document.createElement("img");
    img.src = `data:image/png;base64,${imageBase64}`;

    const span = document.createElement("span");
    span.textContent = `Canvas pushed: ${layerLabel}`;

    notification.appendChild(img);
    notification.appendChild(span);
    this.container.appendChild(notification);
  }

  showUnavailable(): void {
    if (!this.container) return;

    this.container.textContent = "";

    const msg = document.createElement("div");
    msg.className = "no-transcript";
    msg.textContent = "No transcript available for this session.";
    this.container.appendChild(msg);
  }

  clear(): void {
    if (!this.container) return;
    this.container.textContent = "";
    this.entries = [];
    this.mode = "recent";
    this.toggleEl = null;
  }

  private scrollRAF: number | null = null;

  private scrollToBottomIfEnabled(): void {
    if (!this.container || !this.autoScroll) return;
    if (this.scrollRAF) cancelAnimationFrame(this.scrollRAF);
    this.scrollRAF = requestAnimationFrame(() => {
      if (this.container) this.container.scrollTop = this.container.scrollHeight;
      this.scrollRAF = null;
    });
  }
}
