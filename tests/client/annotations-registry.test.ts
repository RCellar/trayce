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
    expect(updated?.replies[0]!.from).toBe("claude");
    expect(updated?.replies[0]!.text).toBe("done");
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
    const numbers = all.filter((a) => a.kind === "pin").map((a) => (a as { number: number }).number);
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
});
