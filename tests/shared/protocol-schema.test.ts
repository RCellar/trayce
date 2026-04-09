import { describe, expect, test } from "bun:test";
import { BrowserToServerSchema } from "../../shared/protocol-schema";

describe("BrowserToServerSchema — heartbeat", () => {
  test("accepts bare heartbeat", () => {
    const r = BrowserToServerSchema.safeParse({ type: "heartbeat" });
    expect(r.success).toBe(true);
  });

  test("rejects heartbeat with extra required-field expectations — none", () => {
    // Heartbeat has no fields. An extra field is silently stripped by z.object.
    const r = BrowserToServerSchema.safeParse({ type: "heartbeat", junk: 1 });
    expect(r.success).toBe(true);
  });
});

describe("BrowserToServerSchema — submit (permissive)", () => {
  test("accepts a fully-specified submit", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "submit",
      targetSessionId: "s1",
      image: "base64data",
      prompt: "hello",
    });
    expect(r.success).toBe(true);
  });

  test("accepts submit with missing targetSessionId (handler validates)", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "submit",
      image: "base64data",
    });
    expect(r.success).toBe(true);
  });

  test("accepts submit with neither image nor prompt (handler validates)", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "submit",
      targetSessionId: "s1",
    });
    expect(r.success).toBe(true);
  });

  test("rejects submit with wrong-type image", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "submit",
      targetSessionId: "s1",
      image: 42,
    });
    expect(r.success).toBe(false);
  });
});

describe("BrowserToServerSchema — watch-session (strict)", () => {
  test("accepts valid watch-session", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "watch-session",
      sessionId: "s1",
    });
    expect(r.success).toBe(true);
  });

  test("rejects watch-session with missing sessionId", () => {
    const r = BrowserToServerSchema.safeParse({ type: "watch-session" });
    expect(r.success).toBe(false);
  });

  test("rejects watch-session with non-string sessionId", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "watch-session",
      sessionId: 42,
    });
    expect(r.success).toBe(false);
  });

  test("rejects watch-session with empty sessionId", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "watch-session",
      sessionId: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("BrowserToServerSchema — permission-verdict (strict)", () => {
  test("accepts valid allow verdict", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "permission-verdict",
      requestId: "req-1",
      behavior: "allow",
    });
    expect(r.success).toBe(true);
  });

  test("accepts allow_once and deny", () => {
    for (const behavior of ["allow_once", "deny"]) {
      const r = BrowserToServerSchema.safeParse({
        type: "permission-verdict",
        requestId: "req-1",
        behavior,
      });
      expect(r.success).toBe(true);
    }
  });

  test("rejects invalid behavior string", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "permission-verdict",
      requestId: "req-1",
      behavior: "maybe",
    });
    expect(r.success).toBe(false);
  });

  test("rejects missing requestId", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "permission-verdict",
      behavior: "allow",
    });
    expect(r.success).toBe(false);
  });
});

describe("BrowserToServerSchema — shutdown-request (strict)", () => {
  test("accepts restart: true", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "shutdown-request",
      restart: true,
    });
    expect(r.success).toBe(true);
  });

  test("accepts restart: false", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "shutdown-request",
      restart: false,
    });
    expect(r.success).toBe(true);
  });

  test("rejects missing restart field", () => {
    const r = BrowserToServerSchema.safeParse({ type: "shutdown-request" });
    expect(r.success).toBe(false);
  });

  test("rejects non-boolean restart", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "shutdown-request",
      restart: "yes",
    });
    expect(r.success).toBe(false);
  });
});

describe("BrowserToServerSchema — unknown types", () => {
  test("rejects unknown type", () => {
    const r = BrowserToServerSchema.safeParse({ type: "bogus" });
    expect(r.success).toBe(false);
  });

  test("rejects payload with no type field", () => {
    const r = BrowserToServerSchema.safeParse({ foo: 1 });
    expect(r.success).toBe(false);
  });
});
