import { describe, expect, test } from "bun:test";
import { SubmitSchema, BridgeToServerSchema } from "../../shared/protocol-schema";
import type { AnnotationUpdateMessage, AnnotationsPushMessage } from "../../shared/protocol";

describe("SubmitSchema annotations extension", () => {
  test("accepts submit with no annotations field (backwards compat)", () => {
    const r = SubmitSchema.safeParse({
      type: "submit",
      targetSessionId: "sess",
      prompt: "hi",
    });
    expect(r.success).toBe(true);
  });

  test("accepts submit with empty annotations array", () => {
    const r = SubmitSchema.safeParse({
      type: "submit",
      targetSessionId: "sess",
      prompt: "hi",
      annotations: [],
    });
    expect(r.success).toBe(true);
  });

  test("accepts submit with valid annotations", () => {
    const r = SubmitSchema.safeParse({
      type: "submit",
      targetSessionId: "sess",
      prompt: "hi",
      annotations: [
        {
          id: "a1",
          kind: "pin",
          author: "user",
          status: "open",
          createdAt: 1,
          updatedAt: 1,
          replies: [],
          number: 1,
          at: [10, 20],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  test("rejects submit with malformed annotation", () => {
    const r = SubmitSchema.safeParse({
      type: "submit",
      targetSessionId: "sess",
      prompt: "hi",
      annotations: [{ id: "bad", kind: "invalid" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("annotation-update message", () => {
  test("accepts valid update", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "annotation-update",
      updates: [{ id: "a1", status: "addressed", reply: "done" }],
    });
    expect(r.success).toBe(true);
  });

  test("accepts without reply", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "annotation-update",
      updates: [{ id: "a1", status: "rejected" }],
    });
    expect(r.success).toBe(true);
  });

  test("rejects status=deleted (Claude may not delete)", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "annotation-update",
      updates: [{ id: "a1", status: "deleted" }],
    });
    expect(r.success).toBe(false);
  });

  test("rejects empty updates array", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "annotation-update",
      updates: [],
    });
    expect(r.success).toBe(false);
  });

  test("type shape", () => {
    const m: AnnotationUpdateMessage = {
      type: "annotation-update",
      updates: [{ id: "a1", status: "addressed" }],
    };
    expect(m.updates.length).toBe(1);
  });
});

describe("annotations-push message", () => {
  test("accepts one fully-formed annotation", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "annotations-push",
      annotations: [
        {
          id: "a1",
          kind: "text",
          author: "claude",
          status: "open",
          createdAt: 1,
          updatedAt: 1,
          replies: [],
          text: "look here",
          bbox: [0, 0, 50, 20],
          style: { fontSize: 14, color: "#dc2626", weight: "normal" },
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  test("rejects empty annotations array", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "annotations-push",
      annotations: [],
    });
    expect(r.success).toBe(false);
  });

  test("type shape", () => {
    const m: AnnotationsPushMessage = {
      type: "annotations-push",
      annotations: [],
    };
    expect(m.annotations).toEqual([]);
  });
});
