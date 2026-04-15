import { describe, expect, test } from "bun:test";
import { AnnotationRegistry } from "../../client/annotations/registry";

describe("AnnotationRegistry", () => {
  test("creates a pin with auto-assigned number starting at 1", () => {
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [10, 20] });
    expect(p.kind).toBe("pin");
    expect(p.number).toBe(1);
    expect(p.status).toBe("open");
    expect(p.author).toBe("user");
    expect(p.id).toMatch(/[-0-9a-f]{36}/);
  });

  test("pin numbers leave gaps on delete", () => {
    const r = new AnnotationRegistry();
    const p1 = r.createPin({ at: [0, 0] });
    const p2 = r.createPin({ at: [1, 1] });
    const p3 = r.createPin({ at: [2, 2] });
    r.softDelete(p2.id);
    const p4 = r.createPin({ at: [3, 3] });
    expect(p1.number).toBe(1);
    expect(p3.number).toBe(3);
    expect(p4.number).toBe(4);
    const visible = r.visible();
    expect(visible.map((a) => (a.kind === "pin" ? a.number : null))).toEqual([1, 3, 4]);
  });

  test("createText places an editable text annotation", () => {
    const r = new AnnotationRegistry();
    const t = r.createText({ text: "hi", bbox: [0, 0, 50, 20] });
    expect(t.text).toBe("hi");
  });

  test("createCallout places a callout with target", () => {
    const r = new AnnotationRegistry();
    const c = r.createCallout({ text: "move", bbox: [0, 0, 50, 20], target: [100, 100] });
    expect(c.target).toEqual([100, 100]);
  });

  test("applyUpdate changes status and appends reply", () => {
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [0, 0] });
    r.applyUpdate({ id: p.id, status: "addressed", reply: "done" });
    const updated = r.get(p.id);
    expect(updated?.status).toBe("addressed");
    expect(updated?.replies.length).toBe(1);
    const firstReply = updated?.replies[0];
    expect(firstReply?.from).toBe("claude");
    expect(firstReply?.text).toBe("done");
  });

  test("applyUpdate without reply does not append empty reply", () => {
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [0, 0] });
    r.applyUpdate({ id: p.id, status: "rejected" });
    expect(r.get(p.id)?.replies.length).toBe(0);
  });

  test("softDelete hides from visible() but keeps in all()", () => {
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [0, 0] });
    r.softDelete(p.id);
    expect(r.visible().length).toBe(0);
    expect(r.all().length).toBe(1);
    expect(r.get(p.id)?.status).toBe("deleted");
  });

  test("clearResolved removes addressed + rejected + deleted", () => {
    const r = new AnnotationRegistry();
    const p1 = r.createPin({ at: [0, 0] });
    const p2 = r.createPin({ at: [0, 0] });
    const p3 = r.createPin({ at: [0, 0] });
    const p4 = r.createPin({ at: [0, 0] });
    r.applyUpdate({ id: p1.id, status: "addressed" });
    r.applyUpdate({ id: p2.id, status: "rejected" });
    r.softDelete(p3.id);
    r.clearResolved();
    expect(r.all().length).toBe(1);
    expect(r.all()[0]!.id).toBe(p4.id);
  });

  test("ingestPushed accepts Claude-authored annotations and renumbers colliding pins", () => {
    const r = new AnnotationRegistry();
    r.createPin({ at: [0, 0] }); // user pin #1
    r.ingestPushed([
      {
        id: "pushed-1",
        kind: "pin",
        author: "claude",
        status: "open",
        createdAt: 1,
        updatedAt: 1,
        replies: [],
        number: 1, // collides
        at: [10, 10],
      },
    ]);
    const all = r.visible();
    expect(all.length).toBe(2);
    const numbers = all
      .filter((a) => a.kind === "pin")
      .map((a) => (a as { number: number }).number);
    expect(new Set(numbers).size).toBe(2);
  });

  test("forSubmission returns non-deleted annotations", () => {
    const r = new AnnotationRegistry();
    const p1 = r.createPin({ at: [0, 0] });
    const p2 = r.createPin({ at: [0, 0] });
    r.softDelete(p2.id);
    const out = r.forSubmission();
    expect(out.length).toBe(1);
    expect(out[0]!.id).toBe(p1.id);
  });

  test("updateContent edits pin note in place", () => {
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [0, 0] });
    r.updateContent(p.id, { note: "new note" });
    const updated = r.get(p.id);
    expect(updated?.kind === "pin" && updated.note).toBe("new note");
  });

  test("updateContent edits text content in place", () => {
    const r = new AnnotationRegistry();
    const t = r.createText({ text: "before", bbox: [0, 0, 10, 10] });
    r.updateContent(t.id, { text: "after" });
    const updated = r.get(t.id);
    expect(updated?.kind === "text" && updated.text).toBe("after");
  });

  test("updateContent rejects empty text for non-pin kinds", () => {
    const r = new AnnotationRegistry();
    const t = r.createText({ text: "keep", bbox: [0, 0, 10, 10] });
    r.updateContent(t.id, { text: "" });
    const updated = r.get(t.id);
    expect(updated?.kind === "text" && updated.text).toBe("keep");
  });

  test("updateContent accepts empty note on pin (clearing the note)", () => {
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [0, 0], note: "original" });
    r.updateContent(p.id, { note: "" });
    const updated = r.get(p.id);
    expect(updated?.kind === "pin" && updated.note).toBe("");
  });

  test("updateContent is a no-op for unknown id", () => {
    const r = new AnnotationRegistry();
    r.createPin({ at: [0, 0] });
    r.updateContent("nope", { note: "x" });
    expect(r.all().length).toBe(1);
  });

  test("addReply appends without touching the original note", () => {
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [0, 0], note: "original" });
    r.addReply(p.id, "clarification");
    const updated = r.get(p.id);
    expect(updated?.kind).toBe("pin");
    if (updated?.kind === "pin") expect(updated.note).toBe("original");
    expect(updated?.replies.length).toBe(1);
    expect(updated?.replies[0]?.text).toBe("clarification");
    expect(updated?.replies[0]?.from).toBe("user");
  });

  test("addReply defaults author to user; claude author is explicit", () => {
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [0, 0] });
    r.addReply(p.id, "a");
    r.addReply(p.id, "b", "claude");
    const updated = r.get(p.id);
    expect(updated?.replies.map((x) => x.from)).toEqual(["user", "claude"]);
  });

  test("addReply trims and skips empty strings", () => {
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [0, 0] });
    r.addReply(p.id, "   ");
    r.addReply(p.id, "");
    r.addReply(p.id, "  real  ");
    const updated = r.get(p.id);
    expect(updated?.replies.length).toBe(1);
    expect(updated?.replies[0]?.text).toBe("real");
  });

  test("addReply bumps updatedAt and notifies listeners", () => {
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [0, 0] });
    const originalUpdated = p.updatedAt;
    let calls = 0;
    r.subscribe(() => calls++);
    // Ensure Date.now() advances so updatedAt is strictly later than the
    // creation timestamp — otherwise the same ms tick makes the two equal.
    const start = Date.now();
    while (Date.now() === start) {
      /* busy-wait one tick */
    }
    r.addReply(p.id, "hi");
    const updated = r.get(p.id);
    expect(updated?.updatedAt).toBeGreaterThan(originalUpdated);
    expect(calls).toBe(1);
  });

  test("addReply is a no-op for unknown id", () => {
    const r = new AnnotationRegistry();
    r.addReply("nope", "hi");
    expect(r.all().length).toBe(0);
  });

  // --- applyUpdate dedupe (server buffer replay scenario) ---

  test("applyUpdate dedupes by (annotationId, at) on repeated delivery", () => {
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [0, 0] });
    r.applyUpdate({ id: p.id, status: "addressed", reply: "done", at: 12345 });
    r.applyUpdate({ id: p.id, status: "addressed", reply: "done", at: 12345 });
    r.applyUpdate({ id: p.id, status: "addressed", reply: "done", at: 12345 });
    const updated = r.get(p.id);
    expect(updated?.replies.length).toBe(1);
    expect(updated?.replies[0]?.text).toBe("done");
    expect(updated?.status).toBe("addressed");
  });

  test("applyUpdate without `at` falls back to the pre-dedupe behaviour", () => {
    // Old bridge builds may not stamp `at`; don't break legacy clients.
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [0, 0] });
    r.applyUpdate({ id: p.id, status: "addressed", reply: "x" });
    r.applyUpdate({ id: p.id, status: "addressed", reply: "x" });
    const updated = r.get(p.id);
    expect(updated?.replies.length).toBe(2);
  });

  test("applyUpdate accepts different `at` values as distinct updates", () => {
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [0, 0] });
    r.applyUpdate({ id: p.id, status: "addressed", reply: "a", at: 1 });
    r.applyUpdate({ id: p.id, status: "needs-clarification", reply: "b", at: 2 });
    const updated = r.get(p.id);
    expect(updated?.replies.map((x) => x.text)).toEqual(["a", "b"]);
    expect(updated?.status).toBe("needs-clarification");
  });

  test("applyUpdate uses the provided `at` as the reply timestamp", () => {
    const r = new AnnotationRegistry();
    const p = r.createPin({ at: [0, 0] });
    r.applyUpdate({ id: p.id, status: "addressed", reply: "done", at: 99999 });
    const updated = r.get(p.id);
    expect(updated?.replies[0]?.at).toBe(99999);
    expect(updated?.updatedAt).toBe(99999);
  });

  // --- load() heals legacy duplicate-replies state ---

  test("load collapses adjacent identical replies (healing legacy dupes)", () => {
    const r = new AnnotationRegistry();
    const now = Date.now();
    const pinWithDupes = {
      id: "abc",
      kind: "pin" as const,
      author: "user" as const,
      status: "needs-clarification" as const,
      createdAt: now,
      updatedAt: now,
      number: 1,
      at: [0, 0] as [number, number],
      note: "original",
      replies: [
        { from: "claude" as const, text: "same text", at: now },
        { from: "claude" as const, text: "same text", at: now + 1 },
        { from: "claude" as const, text: "same text", at: now + 2 },
        { from: "claude" as const, text: "different", at: now + 3 },
        { from: "claude" as const, text: "different", at: now + 4 },
      ],
    };
    r.load([pinWithDupes]);
    const loaded = r.get("abc");
    expect(loaded?.replies.map((x) => x.text)).toEqual(["same text", "different"]);
  });

  test("load preserves non-adjacent repeats (real conversation patterns)", () => {
    const r = new AnnotationRegistry();
    const now = Date.now();
    const pinWithConversation = {
      id: "abc",
      kind: "pin" as const,
      author: "user" as const,
      status: "needs-clarification" as const,
      createdAt: now,
      updatedAt: now,
      number: 1,
      at: [0, 0] as [number, number],
      note: "q",
      replies: [
        { from: "claude" as const, text: "yes", at: now + 1 },
        { from: "user" as const, text: "more?", at: now + 2 },
        { from: "claude" as const, text: "yes", at: now + 3 },
      ],
    };
    r.load([pinWithConversation]);
    const loaded = r.get("abc");
    // Adjacent-only dedupe: identical "yes" entries are kept because a
    // different reply sits between them.
    expect(loaded?.replies.length).toBe(3);
  });
});
