import type {
  Annotation,
  AnnotationAuthor,
  AnnotationUpdateEntry,
  CalloutAnnotation,
  PinAnnotation,
  TextAnnotation,
} from "./types";

type Listener = () => void;

export class AnnotationRegistry {
  private items = new Map<string, Annotation>();
  private maxPinNumber = 0;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  createPin(input: { at: [number, number]; note?: string }): PinAnnotation {
    const now = Date.now();
    const number = ++this.maxPinNumber;
    const a: PinAnnotation = {
      id: crypto.randomUUID(),
      kind: "pin",
      author: "user",
      status: "open",
      createdAt: now,
      updatedAt: now,
      replies: [],
      number,
      at: input.at,
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    this.items.set(a.id, a);
    this.notify();
    return a;
  }

  createText(input: {
    text: string;
    bbox: [number, number, number, number];
    style?: { fontSize?: number; color?: string; weight?: "normal" | "bold" };
  }): TextAnnotation {
    const now = Date.now();
    const a: TextAnnotation = {
      id: crypto.randomUUID(),
      kind: "text",
      author: "user",
      status: "open",
      createdAt: now,
      updatedAt: now,
      replies: [],
      text: input.text,
      bbox: input.bbox,
      style: {
        fontSize: input.style?.fontSize ?? 14,
        color: input.style?.color ?? "#dc2626",
        weight: input.style?.weight ?? "normal",
      },
    };
    this.items.set(a.id, a);
    this.notify();
    return a;
  }

  createCallout(input: {
    text: string;
    bbox: [number, number, number, number];
    target: [number, number];
    style?: { fontSize?: number; color?: string };
  }): CalloutAnnotation {
    const now = Date.now();
    const a: CalloutAnnotation = {
      id: crypto.randomUUID(),
      kind: "callout",
      author: "user",
      status: "open",
      createdAt: now,
      updatedAt: now,
      replies: [],
      text: input.text,
      bbox: input.bbox,
      target: input.target,
      style: {
        fontSize: input.style?.fontSize ?? 14,
        color: input.style?.color ?? "#dc2626",
      },
    };
    this.items.set(a.id, a);
    this.notify();
    return a;
  }

  applyUpdate(u: AnnotationUpdateEntry): void {
    const existing = this.items.get(u.id);
    if (!existing) return;
    const now = Date.now();
    const updated: Annotation = { ...existing, status: u.status, updatedAt: now };
    if (u.reply !== undefined && u.reply.length > 0) {
      updated.replies = [...existing.replies, { from: "claude", text: u.reply, at: now }];
    }
    this.items.set(u.id, updated);
    this.notify();
  }

  /**
   * Update the user-authored content of an annotation in place. For pins the
   * patch targets `note`; for text and callouts it targets `text`. No-op if
   * the ID is unknown, if the content would end up empty, or if the kind
   * doesn't match the patch. Claude-authored annotations can also be edited —
   * the UI surface decides whether to expose that.
   */
  updateContent(id: string, patch: { text?: string; note?: string }): void {
    const existing = this.items.get(id);
    if (!existing) return;
    const now = Date.now();
    let next: Annotation | null = null;
    if (existing.kind === "pin" && patch.note !== undefined) {
      next = { ...existing, note: patch.note, updatedAt: now };
    } else if (existing.kind === "text" && patch.text !== undefined) {
      const trimmed = patch.text;
      if (trimmed.length === 0) return;
      next = { ...existing, text: trimmed, updatedAt: now };
    } else if (existing.kind === "callout" && patch.text !== undefined) {
      const trimmed = patch.text;
      if (trimmed.length === 0) return;
      next = { ...existing, text: trimmed, updatedAt: now };
    }
    if (next) {
      this.items.set(id, next);
      this.notify();
    }
  }

  /**
   * Append a reply to an existing annotation without touching the original
   * text/note. Unlike `updateContent`, this is non-destructive: the original
   * user intent is preserved and the reply becomes part of the conversation
   * trail on the annotation. Replies with empty/whitespace-only text are a
   * no-op so the UI can call this unconditionally on blur/submit.
   */
  addReply(id: string, text: string, from: AnnotationAuthor = "user"): void {
    const existing = this.items.get(id);
    if (!existing) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const now = Date.now();
    const next: Annotation = {
      ...existing,
      replies: [...existing.replies, { from, text: trimmed, at: now }],
      updatedAt: now,
    };
    this.items.set(id, next);
    this.notify();
  }

  ingestPushed(annotations: Annotation[]): void {
    for (const a of annotations) {
      let toInsert = a;
      if (a.kind === "pin") {
        if (this.pinNumberInUse(a.number)) {
          toInsert = { ...a, number: ++this.maxPinNumber };
        } else {
          this.maxPinNumber = Math.max(this.maxPinNumber, a.number);
        }
      }
      this.items.set(toInsert.id, toInsert);
    }
    this.notify();
  }

  private pinNumberInUse(n: number): boolean {
    for (const a of this.items.values()) {
      if (a.kind === "pin" && a.number === n && a.status !== "deleted") return true;
    }
    return false;
  }

  softDelete(id: string): void {
    const existing = this.items.get(id);
    if (!existing) return;
    this.items.set(id, { ...existing, status: "deleted", updatedAt: Date.now() });
    this.notify();
  }

  clearResolved(): void {
    for (const [id, a] of this.items) {
      if (a.status === "addressed" || a.status === "rejected" || a.status === "deleted") {
        this.items.delete(id);
      }
    }
    this.notify();
  }

  get(id: string): Annotation | undefined {
    return this.items.get(id);
  }

  all(): Annotation[] {
    return [...this.items.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  visible(): Annotation[] {
    return this.all().filter((a) => a.status !== "deleted");
  }

  forSubmission(): Annotation[] {
    return this.all().filter((a) => a.status !== "deleted");
  }

  load(annotations: Annotation[]): void {
    this.items.clear();
    this.maxPinNumber = 0;
    for (const a of annotations) {
      this.items.set(a.id, a);
      if (a.kind === "pin") {
        this.maxPinNumber = Math.max(this.maxPinNumber, a.number);
      }
    }
    this.notify();
  }

  clear(): void {
    this.items.clear();
    this.maxPinNumber = 0;
    this.notify();
  }
}
