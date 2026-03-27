import { renderMarkdown } from "./markdown";

export class ResponseTab {
  private container: HTMLElement | null = null;
  private autoScroll = true;

  mount(container: HTMLElement): void {
    this.container = container;

    container.addEventListener("scroll", () => {
      const { scrollHeight, scrollTop, clientHeight } = container;
      this.autoScroll = scrollHeight - scrollTop - clientHeight < 30;
    });
  }

  addResponse(content: string): void {
    if (!this.container) return;

    const block = document.createElement("div");
    block.className = "msg-block";

    const label = document.createElement("div");
    label.className = "msg-label";
    label.textContent = "Claude";

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

  private scrollToBottomIfEnabled(): void {
    if (!this.container || !this.autoScroll) return;
    this.container.scrollTop = this.container.scrollHeight;
  }
}
