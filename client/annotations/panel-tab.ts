import type { AnnotationRegistry } from "./registry";
import type { Annotation } from "./types";

type StatusGlyph = { char: string; color: string };

const STATUS_GLYPHS: Record<string, StatusGlyph> = {
  open: { char: "●", color: "#dc2626" },
  addressed: { char: "✓", color: "#059669" },
  "needs-clarification": { char: "⚠", color: "#d97706" },
  rejected: { char: "✗", color: "#6b7280" },
};

function glyphForStatus(status: string): StatusGlyph {
  return STATUS_GLYPHS[status] ?? { char: "●", color: "#6b7280" };
}

function kindLabel(a: Annotation): string {
  if (a.kind === "pin") return `Pin #${a.number}`;
  if (a.kind === "text") return "Text";
  return "Callout";
}

function contentPreview(a: Annotation): string {
  if (a.kind === "pin") return a.note ?? "";
  return a.text ?? "";
}

export class AnnotationsTab {
  private registry: AnnotationRegistry;
  private onRowClick: (id: string) => void;
  private list: HTMLElement | null = null;
  private clearBtn: HTMLButtonElement | null = null;
  private clearHandler: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(registry: AnnotationRegistry, onRowClick: (id: string) => void) {
    this.registry = registry;
    this.onRowClick = onRowClick;
  }

  mount(container: HTMLElement): void {
    // Header area with buttons
    const header = document.createElement("div");
    header.className = "annotations-header";

    this.clearBtn = document.createElement("button");
    this.clearBtn.className = "annotations-clear-btn";
    this.clearBtn.textContent = "Clear resolved";
    this.clearHandler = () => {
      this.registry.clearResolved();
    };
    this.clearBtn.addEventListener("click", this.clearHandler);

    const exportBtn = document.createElement("button");
    exportBtn.className = "annotations-export-btn";
    exportBtn.textContent = "Export JSON";
    exportBtn.addEventListener("click", () => {
      this.exportJSON();
    });

    header.appendChild(this.clearBtn);
    header.appendChild(exportBtn);
    container.appendChild(header);

    // Scrolling list
    this.list = document.createElement("div");
    this.list.className = "annotations-list";
    container.appendChild(this.list);

    // Subscribe to registry changes
    this.unsubscribe = this.registry.subscribe(() => this.render());

    // Initial render
    this.render();
  }

  private render(): void {
    if (!this.list) return;

    // Clear existing rows
    this.list.textContent = "";

    const visible = this.registry.visible();

    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "annotations-empty";
      empty.textContent = "No annotations.";
      this.list.appendChild(empty);
      return;
    }

    for (const annotation of visible) {
      this.list.appendChild(this.buildRow(annotation));
    }
  }

  private buildRow(a: Annotation): HTMLElement {
    const row = document.createElement("div");
    row.className = "annotation-row";
    row.dataset.id = a.id;
    row.addEventListener("click", () => this.onRowClick(a.id));

    // Status glyph
    const glyph = glyphForStatus(a.status);
    const glyphEl = document.createElement("span");
    glyphEl.className = "annotation-glyph";
    glyphEl.textContent = glyph.char;
    glyphEl.style.color = glyph.color;

    // Kind label
    const kindEl = document.createElement("span");
    kindEl.className = "annotation-kind";
    if (a.author === "claude") {
      kindEl.textContent = `✨ ${kindLabel(a)}`;
    } else {
      kindEl.textContent = kindLabel(a);
    }

    // Status text
    const statusEl = document.createElement("span");
    statusEl.className = "annotation-status";
    statusEl.textContent = a.status;

    // Content preview
    const content = contentPreview(a);
    if (content) {
      const contentEl = document.createElement("div");
      contentEl.className = "annotation-content";
      contentEl.textContent = content;
      row.appendChild(glyphEl);
      row.appendChild(kindEl);
      row.appendChild(statusEl);
      row.appendChild(contentEl);
    } else {
      row.appendChild(glyphEl);
      row.appendChild(kindEl);
      row.appendChild(statusEl);
    }

    // Claude replies
    for (const reply of a.replies) {
      const replyEl = document.createElement("div");
      replyEl.className = "annotation-reply";
      replyEl.textContent = `✨ ${reply.text}`;
      row.appendChild(replyEl);
    }

    return row;
  }

  private exportJSON(): void {
    const data = this.registry.all();
    const json = JSON.stringify(data, null, 2);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `annotations-${ts}.json`;

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  // Test hooks
  rowCount(): number {
    return this.registry.visible().length;
  }

  clickClearResolved(): void {
    if (this.clearHandler) this.clearHandler();
  }
}
