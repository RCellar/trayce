import { describe, expect, test } from "bun:test";
import { SubmitSchema } from "../../shared/protocol-schema";

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
