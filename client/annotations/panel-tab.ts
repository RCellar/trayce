import type { AnnotationRegistry } from "./registry";
import type { Annotation } from "./types";

type StatusGlyph = { char: string; color: string };

// Non-"open" glyph colors are status-meaning and stay fixed. The "open" color
// is resolved at render time from the theme accent so it matches whatever
// palette the user picked in the theme popover.
const STATUS_GLYPHS_FIXED: Record<string, StatusGlyph> = {
  addressed: { char: "✓", color: "#059669" },
  "needs-clarification": { char: "⚠", color: "#d97706" },
  rejected: { char: "✗", color: "#6b7280" },
};

function readOpenGlyphColor(): string {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return "#dc2626";
  }
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return raw || "#dc2626";
  } catch {
    return "#dc2626";
  }
}

function glyphForStatus(status: string): StatusGlyph {
  if (status === "open") return { char: "●", color: readOpenGlyphColor() };
  return STATUS_GLYPHS_FIXED[status] ?? { char: "●", color: "#6b7280" };
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
  private themeListener: (() => void) | null = null;

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

    // Re-render on theme change so the "open" status glyph picks up the new
    // accent color.
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      this.themeListener = () => this.render();
      document.addEventListener("trayce:theme-changed", this.themeListener);
    }

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

    // Clicking the row (outside the delete button and the editable content)
    // signals "focus this annotation" — wired to the caller's onRowClick.
    row.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".annotation-delete-btn")) return;
      if (target?.closest(".annotation-editing")) return;
      this.onRowClick(a.id);
    });

    // Status glyph
    const glyph = glyphForStatus(a.status);
    const glyphEl = document.createElement("span");
    glyphEl.className = "annotation-glyph";
    glyphEl.textContent = glyph.char;
    glyphEl.style.color = glyph.color;

    // Kind label
    const kindEl = document.createElement("span");
    kindEl.className = "annotation-kind";
    kindEl.textContent = a.author === "claude" ? `✨ ${kindLabel(a)}` : kindLabel(a);

    // Status text
    const statusEl = document.createElement("span");
    statusEl.className = "annotation-status";
    statusEl.textContent = a.status;

    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "annotation-delete-btn";
    deleteBtn.type = "button";
    deleteBtn.title = "Delete annotation";
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.registry.softDelete(a.id);
    });

    row.appendChild(glyphEl);
    row.appendChild(kindEl);
    row.appendChild(statusEl);
    row.appendChild(deleteBtn);

    // Content preview — double-click to edit
    const content = contentPreview(a);
    const contentEl = document.createElement("div");
    contentEl.className = "annotation-content";
    if (content) {
      contentEl.textContent = content;
    } else {
      contentEl.textContent = a.kind === "pin" ? "(no note)" : "";
      contentEl.style.opacity = "0.5";
    }
    contentEl.title = "Double-click to edit";
    contentEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.startInlineEdit(contentEl, a);
    });
    row.appendChild(contentEl);

    // Claude replies
    for (const reply of a.replies) {
      const replyEl = document.createElement("div");
      replyEl.className = "annotation-reply";
      replyEl.textContent = `✨ ${reply.text}`;
      row.appendChild(replyEl);
    }

    return row;
  }

  private startInlineEdit(target: HTMLElement, a: Annotation): void {
    const current = a.kind === "pin" ? (a.note ?? "") : a.text;
    const input = document.createElement("textarea");
    input.className = "annotation-editing";
    input.value = current;
    input.rows = 2;
    input.style.cssText =
      "width:100%;resize:vertical;background:rgba(0,0,0,0.15);" +
      "border:1px solid var(--accent,#dc2626);color:inherit;" +
      "font:inherit;padding:2px 4px;outline:none;";
    let committed = false;

    const commit = () => {
      if (committed) return;
      committed = true;
      const value = input.value.trim();
      // Pins accept an empty note; text/callouts must stay non-empty
      if (a.kind === "pin") {
        this.registry.updateContent(a.id, { note: value });
      } else if (value.length > 0) {
        this.registry.updateContent(a.id, { text: value });
      }
      // render() will be triggered by registry subscribe; if nothing changed,
      // restore the original content preview.
      if (!value && a.kind !== "pin") {
        target.replaceWith(target);
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        committed = true;
        this.render();
      }
    });
    input.addEventListener("blur", commit);

    target.replaceWith(input);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
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
    if (
      this.themeListener &&
      typeof document !== "undefined" &&
      typeof document.removeEventListener === "function"
    ) {
      document.removeEventListener("trayce:theme-changed", this.themeListener);
      this.themeListener = null;
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
