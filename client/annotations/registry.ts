import type {
  Annotation,
  AnnotationAuthor,
  AnnotationReply,
  AnnotationUpdateEntry,
  CalloutAnnotation,
  PinAnnotation,
  TextAnnotation,
} from "./types";

type Listener = () => void;

/** Collapse adjacent replies that have identical `{from, text}`. Used by
 *  `load()` to heal the 4-copies-of-the-same-reply state that the pre-dedupe
 *  applyUpdate path could accumulate when the server replayed buffered
 *  annotation-updates to a reconnecting browser. Scoped to *adjacent* runs
 *  only — genuinely re-sent identical replies separated by other content
 *  are preserved. */
function dedupeReplies(replies: AnnotationReply[]): AnnotationReply[] {
  const out: AnnotationReply[] = [];
  let lastKey: string | null = null;
  for (const r of replies) {
    const key = `${r.from}\x00${r.text}`;
    if (key === lastKey) continue;
    lastKey = key;
    out.push(r);
  }
  return out;
}

export class AnnotationRegistry {
  private items = new Map<string, Annotation>();
  private maxPinNumber = 0;
  private listeners = new Set<Listener>();
  /**
   * Dedupe key set for incoming `annotation-update` messages. The server
   * buffers these messages per-session and replays the entire buffer to any
   * browser that watches (or re-watches) the session — without a dedupe,
   * each replay re-runs `applyUpdate`, which appends the reply again, and
   * you end up with N identical replies after N (re)connects. Keyed as
   * `${annotationId}:${at}` where `at` is the bridge-stamped timestamp of
   * the originating resolve_annotations call.
   */
  private seenUpdateKeys = new Set<string>();

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

    // Dedupe when the update carries a bridge-stamped `at`. If the server
    // replays a buffered annotation-update to a reconnecting browser, we
    // should recognise it as the same logical update and skip it so the
    // reply isn't appended twice.
    if (u.at !== undefined) {
      const key = `${u.id}:${u.at}`;
      if (this.seenUpdateKeys.has(key)) return;
      this.seenUpdateKeys.add(key);
    }

    const at = u.at ?? Date.now();
    const updated: Annotation = { ...existing, status: u.status, updatedAt: at };
    if (u.reply !== undefined && u.reply.length > 0) {
      updated.replies = [...existing.replies, { from: "claude", text: u.reply, at }];
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
    this.seenUpdateKeys.clear();
    for (const a of annotations) {
      // One-shot cleanup: collapse runs of replies that have identical
      // `{from, text}`. This heals state that was corrupted by the old
      // (pre-dedupe) applyUpdate path — if a user had 4 copies of the same
      // Claude reply attached to a pin from buffer replay, load() keeps the
      // earliest one and drops the rest on first open. Genuine duplicate
      // replies are almost never emitted back-to-back with identical text,
      // so this is a safe heuristic.
      const healed: Annotation = { ...a, replies: dedupeReplies(a.replies) };
      this.items.set(healed.id, healed);
      if (healed.kind === "pin") {
        this.maxPinNumber = Math.max(this.maxPinNumber, healed.number);
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
