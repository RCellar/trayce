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

    // Clicking the row (outside action controls and editable content) signals
    // "focus this annotation" — wired to the caller's onRowClick.
    row.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".annotation-delete-btn")) return;
      if (target?.closest(".annotation-editing")) return;
      if (target?.closest(".annotation-action-btn")) return;
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

    // Content preview — double-click still opens inline edit for anyone who
    // learned that gesture, and the explicit Edit button below makes the
    // affordance discoverable.
    const content = contentPreview(a);
    const contentEl = document.createElement("div");
    contentEl.className = "annotation-content";
    if (content) {
      contentEl.textContent = content;
    } else {
      contentEl.textContent = a.kind === "pin" ? "(no note)" : "";
      contentEl.style.opacity = "0.5";
    }
    contentEl.title = "Double-click to edit, or use the Edit button below";
    contentEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.startInlineEdit(contentEl, a);
    });
    row.appendChild(contentEl);

    // Replies — rendered with author-scoped styling. Claude replies retain
    // the ✨ glyph; user replies (clarifications) render plain so the trail
    // reads like a conversation instead of every reply looking like Claude.
    for (const reply of a.replies) {
      const replyEl = document.createElement("div");
      replyEl.className = `annotation-reply from-${reply.from}`;
      replyEl.textContent = reply.from === "claude" ? `✨ ${reply.text}` : reply.text;
      row.appendChild(replyEl);
    }

    // Action bar — Edit (inline-edit the original content) + Reply (append a
    // new reply to .replies[] without overwriting anything). Replying is the
    // non-destructive clarification flow; Edit is for correcting typos in the
    // original note.
    const actions = document.createElement("div");
    actions.className = "annotation-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "annotation-action-btn";
    editBtn.textContent = "Edit";
    editBtn.title = "Edit the original content of this annotation";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.startInlineEdit(contentEl, a);
    });

    const replyBtn = document.createElement("button");
    replyBtn.type = "button";
    replyBtn.className = "annotation-action-btn";
    replyBtn.textContent = "Reply";
    replyBtn.title = "Add a clarification reply — preserves the original";
    replyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.startReply(row, a);
    });

    actions.appendChild(editBtn);
    actions.appendChild(replyBtn);
    row.appendChild(actions);

    return row;
  }

  /** Open an inline textarea for appending a new reply to the annotation.
   *  Commits to registry.addReply on Enter or blur (blur captures the case
   *  where the user clicks away — matches the inline-edit ergonomics). */
  private startReply(row: HTMLElement, a: Annotation): void {
    // Avoid stacking multiple reply inputs on the same row.
    const existing = row.querySelector(".annotation-replying");
    if (existing) {
      (existing as HTMLTextAreaElement).focus();
      return;
    }
    const input = document.createElement("textarea");
    input.className = "annotation-editing annotation-replying";
    input.placeholder = "Type a reply — Enter to send, Esc to cancel";
    input.rows = 2;
    let committed = false;

    const commit = () => {
      if (committed) return;
      committed = true;
      const value = input.value.trim();
      if (value.length === 0) {
        // Nothing to send — just re-render to drop the input cleanly.
        this.render();
        return;
      }
      this.registry.addReply(a.id, value, "user");
      // registry.notify() will trigger re-render via our subscribe.
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

    row.appendChild(input);
    requestAnimationFrame(() => input.focus());
  }

  private startInlineEdit(target: HTMLElement, a: Annotation): void {
    const current = a.kind === "pin" ? (a.note ?? "") : a.text;
    const input = document.createElement("textarea");
    input.className = "annotation-editing";
    input.value = current;
    input.rows = 3;
    // Styling lives in style.css under `.annotation-editing` — intentionally
    // no inline overrides so text-scale / control-scale CSS vars apply.
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
