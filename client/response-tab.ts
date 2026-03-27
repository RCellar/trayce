import { renderMarkdown } from "./markdown";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export class ResponseTab {
  private container: HTMLElement | null = null;
  private autoScroll = true;
  private autoScrollBtn: HTMLButtonElement | null = null;

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

  addResponse(content: string, timestamp?: number): void {
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
    // Safe: renderMarkdown escapes all HTML entities before rendering,
    // preventing XSS. See client/markdown.ts — escapeHtml runs on all input.
    body.innerHTML = renderMarkdown(content);

    block.appendChild(label);
    block.appendChild(body);
    this.container.appendChild(block);

    this.scrollToBottomIfEnabled();
  }

  addCanvasPushNotification(imageBase64: string, layerLabel: string): void {
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

    this.scrollToBottomIfEnabled();
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
