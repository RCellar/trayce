import { describe, expect, test } from "bun:test";
import type {
  Annotation,
  AnnotationReply,
  AnnotationStatus,
  CalloutAnnotation,
  PinAnnotation,
  TextAnnotation,
} from "../../shared/protocol";

describe("Annotation types", () => {
  test("AnnotationStatus includes all five states", () => {
    const statuses: AnnotationStatus[] = [
      "open",
      "addressed",
      "rejected",
      "needs-clarification",
      "deleted",
    ];
    expect(statuses.length).toBe(5);
  });

  test("TextAnnotation has bbox and text", () => {
    const t: TextAnnotation = {
      id: "id-1",
      kind: "text",
      author: "user",
      status: "open",
      createdAt: 1,
      updatedAt: 1,
      replies: [],
      text: "hello",
      bbox: [10, 20, 100, 24],
      style: { fontSize: 14, color: "#dc2626", weight: "normal" },
    };
    expect(t.bbox).toEqual([10, 20, 100, 24]);
  });

  test("PinAnnotation has stable number separate from id", () => {
    const p: PinAnnotation = {
      id: "id-2",
      kind: "pin",
      author: "user",
      status: "open",
      createdAt: 1,
      updatedAt: 1,
      replies: [],
      number: 3,
      at: [100, 200],
    };
    expect(p.number).toBe(3);
    expect(p.id).not.toBe(String(p.number));
  });

  test("CalloutAnnotation has target separate from bbox", () => {
    const c: CalloutAnnotation = {
      id: "id-3",
      kind: "callout",
      author: "claude",
      status: "open",
      createdAt: 1,
      updatedAt: 1,
      replies: [],
      text: "move left",
      bbox: [280, 130, 80, 30],
      target: [300, 150],
      style: { fontSize: 14, color: "#dc2626" },
    };
    expect(c.target).toEqual([300, 150]);
  });

  test("Annotation union narrows on kind", () => {
    const a: Annotation = {
      id: "id-4",
      kind: "pin",
      author: "user",
      status: "open",
      createdAt: 1,
      updatedAt: 1,
      replies: [],
      number: 1,
      at: [0, 0],
    };
    if (a.kind === "pin") {
      expect(a.number).toBe(1);
    }
  });

  test("AnnotationReply shape", () => {
    const r: AnnotationReply = { from: "claude", text: "done", at: 123 };
    expect(r.from).toBe("claude");
  });
});
