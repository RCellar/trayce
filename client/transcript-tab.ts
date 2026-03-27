import { renderMarkdown } from "./markdown";

export interface TranscriptEntry {
  type: "message" | "response" | "tool-call" | "tool-result";
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: string;
  toolUseId?: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export class TranscriptTab {
  private container: HTMLElement | null = null;
  private autoScroll = true;
  private autoScrollBtn: HTMLButtonElement | null = null;
  private toolCallElements = new Map<string, HTMLElement>();

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

  addEntry(entry: TranscriptEntry): void {
    if (!this.container) return;

    if (entry.type === "message" || entry.type === "response") {
      this.addMessage(entry.role, entry.content, entry.timestamp);
    } else if (entry.type === "tool-call") {
      this.addToolCall(entry);
    } else if (entry.type === "tool-result") {
      this.addToolResult(entry);
    }

    this.scrollToBottomIfEnabled();
  }

  showUnavailable(): void {
    if (!this.container) return;
    this.container.textContent = "";
    const msg = document.createElement("div");
    msg.className = "no-transcript";
    this.container.appendChild(msg);
  }

  clear(): void {
    if (!this.container) return;
    this.container.textContent = "";
    this.toolCallElements.clear();
  }

  private addMessage(role: "user" | "assistant", content: string, timestamp?: number): void {
    if (!this.container) return;

    const entry = document.createElement("div");
    entry.className = "entry";

    const label = document.createElement("div");
    label.className = `entry-label ${role}`;
    label.textContent = role === "user" ? "You" : "Claude";

    if (timestamp) {
      const time = document.createElement("span");
      time.className = "entry-time";
      time.textContent = formatTime(timestamp);
      label.appendChild(time);
    }

    const body = document.createElement("div");
    body.className = "entry-body";

    if (role === "assistant") {
      // Safe: renderMarkdown escapes all HTML entities before rendering,
      // preventing XSS. See client/markdown.ts — escapeHtml runs on all input.
      body.innerHTML = renderMarkdown(content);
    } else {
      body.textContent = content;
    }

    entry.appendChild(label);
    entry.appendChild(body);
    this.container.appendChild(entry);
  }

  private addToolCall(entry: TranscriptEntry): void {
    if (!this.container) return;

    const toolName = entry.toolName ?? "unknown";
    const toolInput = entry.toolInput ?? "";

    const entryEl = document.createElement("div");
    entryEl.className = "entry";

    const summary = document.createElement("div");
    summary.className = "tool-call";

    const nameSpan = document.createElement("span");
    nameSpan.className = "tool-name";
    nameSpan.textContent = toolName;

    if (entry.timestamp) {
      const time = document.createElement("span");
      time.className = "entry-time";
      time.textContent = formatTime(entry.timestamp);
      summary.appendChild(time);
    }

    const summarySpan = document.createElement("span");
    summarySpan.className = "tool-summary";
    summarySpan.textContent = this.summarizeToolInput(toolName, toolInput);

    summary.appendChild(nameSpan);
    summary.appendChild(summarySpan);

    const detail = document.createElement("div");
    detail.className = "tool-detail";
    detail.textContent = toolInput;

    summary.addEventListener("click", () => {
      detail.classList.toggle("expanded");
    });

    entryEl.appendChild(summary);
    entryEl.appendChild(detail);
    this.container.appendChild(entryEl);

    if (entry.toolUseId) {
      this.toolCallElements.set(entry.toolUseId, detail);
    }
  }

  private addToolResult(entry: TranscriptEntry): void {
    if (!this.container) return;

    const content = entry.content;
    const toolUseId = entry.toolUseId;

    if (toolUseId && this.toolCallElements.has(toolUseId)) {
      const detail = this.toolCallElements.get(toolUseId)!;
      const resultEl = document.createElement("div");
      resultEl.className = "tool-result";
      resultEl.style.borderTop = "1px solid var(--border, #ccc)";

      const truncated = content.length > 2000;
      const displayContent = truncated ? content.slice(0, 2000) : content;

      resultEl.textContent = displayContent;

      if (truncated) {
        const showAllBtn = document.createElement("button");
        showAllBtn.textContent = "Show all";
        showAllBtn.className = "tool-result-show-all";
        showAllBtn.addEventListener("click", () => {
          resultEl.textContent = content;
        });
        resultEl.appendChild(showAllBtn);
      }

      detail.appendChild(resultEl);
    } else {
      // Orphan result: render standalone as expanded tool-detail
      const entryEl = document.createElement("div");
      entryEl.className = "entry";

      const detail = document.createElement("div");
      detail.className = "tool-detail expanded";
      detail.textContent = content;

      entryEl.appendChild(detail);
      this.container.appendChild(entryEl);
    }
  }

  private summarizeToolInput(toolName: string, input: string): string {
    try {
      const parsed = JSON.parse(input);
      switch (toolName) {
        case "Read":
          return String(parsed.file_path ?? input.slice(0, 60));
        case "Bash":
          return String(parsed.command ?? input.slice(0, 60)).slice(0, 80);
        case "Grep":
          return `/${parsed.pattern ?? ""}/`;
        case "Glob":
          return String(parsed.pattern ?? input.slice(0, 60));
        case "Edit":
        case "Write":
          return String(parsed.file_path ?? input.slice(0, 60));
        default:
          return input.slice(0, 60);
      }
    } catch {
      return input.slice(0, 60);
    }
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
