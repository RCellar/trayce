import { describe, expect, test } from "bun:test";
import { BridgeToServerSchema, BrowserToServerSchema } from "../../shared/protocol-schema";

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

describe("BridgeToServerSchema — heartbeat", () => {
  test("accepts bare heartbeat", () => {
    const r = BridgeToServerSchema.safeParse({ type: "heartbeat" });
    expect(r.success).toBe(true);
  });
});

describe("BridgeToServerSchema — register", () => {
  test("accepts valid register", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "register",
      sessionId: "s1",
      label: "my-session",
    });
    expect(r.success).toBe(true);
  });

  test("rejects register with empty sessionId", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "register",
      sessionId: "",
      label: "my-session",
    });
    expect(r.success).toBe(false);
  });

  test("rejects register with empty label", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "register",
      sessionId: "s1",
      label: "",
    });
    expect(r.success).toBe(false);
  });

  test("rejects register with non-string label", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "register",
      sessionId: "s1",
      label: 42,
    });
    expect(r.success).toBe(false);
  });
});

describe("BridgeToServerSchema — transcript-entry", () => {
  test("accepts valid transcript-entry", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "transcript-entry",
      entry: {
        type: "message",
        role: "user",
        content: "hello",
        timestamp: 1_700_000_000_000,
      },
    });
    expect(r.success).toBe(true);
  });

  test("rejects transcript-entry with NaN timestamp", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "transcript-entry",
      entry: {
        type: "message",
        role: "user",
        content: "hello",
        timestamp: Number.NaN,
      },
    });
    expect(r.success).toBe(false);
  });

  test("rejects transcript-entry with invalid role", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "transcript-entry",
      entry: {
        type: "message",
        role: "bot",
        content: "hello",
        timestamp: 1_700_000_000_000,
      },
    });
    expect(r.success).toBe(false);
  });
});

describe("BridgeToServerSchema — response", () => {
  test("accepts response with just content", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "response",
      content: "answer",
    });
    expect(r.success).toBe(true);
  });

  test("accepts response with explicit format", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "response",
      content: "# hi",
      format: "markdown",
    });
    expect(r.success).toBe(true);
  });

  test("rejects response with invalid format", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "response",
      content: "hi",
      format: "html",
    });
    expect(r.success).toBe(false);
  });
});

describe("BridgeToServerSchema — canvas-push", () => {
  test("accepts valid canvas-push", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "canvas-push",
      image: "base64data",
    });
    expect(r.success).toBe(true);
  });

  test("rejects canvas-push with missing image", () => {
    const r = BridgeToServerSchema.safeParse({ type: "canvas-push" });
    expect(r.success).toBe(false);
  });
});

describe("BridgeToServerSchema — transcript-status", () => {
  test("accepts each valid status", () => {
    for (const status of ["running", "idle", "error"]) {
      const r = BridgeToServerSchema.safeParse({
        type: "transcript-status",
        status,
      });
      expect(r.success).toBe(true);
    }
  });

  test("rejects invalid status", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "transcript-status",
      status: "waiting",
    });
    expect(r.success).toBe(false);
  });
});

describe("BridgeToServerSchema — usage-update (strict, closes NaN bug)", () => {
  const validUsage = {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 25,
    cacheWriteTokens: 0,
    model: "claude-opus-4-6",
    timestamp: 1_700_000_000_000,
  };

  test("accepts valid usage-update", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "usage-update",
      usage: validUsage,
    });
    expect(r.success).toBe(true);
  });

  test("rejects usage-update with NaN timestamp (closes server-nan-timestamp-usage-update)", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "usage-update",
      usage: { ...validUsage, timestamp: Number.NaN },
    });
    expect(r.success).toBe(false);
  });

  test("rejects usage-update with Infinity timestamp", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "usage-update",
      usage: { ...validUsage, timestamp: Number.POSITIVE_INFINITY },
    });
    expect(r.success).toBe(false);
  });

  test("rejects usage-update with negative token count", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "usage-update",
      usage: { ...validUsage, inputTokens: -1 },
    });
    expect(r.success).toBe(false);
  });

  test("rejects usage-update with non-integer token count", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "usage-update",
      usage: { ...validUsage, inputTokens: 1.5 },
    });
    expect(r.success).toBe(false);
  });

  test("rejects usage-update with missing usage object", () => {
    const r = BridgeToServerSchema.safeParse({ type: "usage-update" });
    expect(r.success).toBe(false);
  });
});

describe("BridgeToServerSchema — permission-request", () => {
  test("accepts valid permission-request", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "permission-request",
      requestId: "req-1",
      toolName: "Bash",
    });
    expect(r.success).toBe(true);
  });

  test("accepts permission-request with toolInput", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "permission-request",
      requestId: "req-1",
      toolName: "Bash",
      toolInput: { command: "ls" },
    });
    expect(r.success).toBe(true);
  });

  test("rejects permission-request with missing requestId", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "permission-request",
      toolName: "Bash",
    });
    expect(r.success).toBe(false);
  });
});
