import { beforeEach, describe, expect, it } from "bun:test";
import { createHookIngress, HookPayloadSchema } from "../../server/hook-ingress";

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_TOKEN = "test-token-abc";

function makeRequest(body: unknown, opts: { auth?: string | null; method?: string } = {}): Request {
  const { auth = `Bearer ${VALID_TOKEN}`, method = "POST" } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  return new Request("http://localhost/hook", {
    method,
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

interface MockDeps {
  validateToken: (token: string | null) => boolean;
  sendToBridge: ReturnType<typeof makeSpy<[string, string], boolean>>;
  broadcastToWatchers: ReturnType<typeof makeSpy<[string, string], void>>;
  storeTranscriptPath: ReturnType<typeof makeSpy<[string, string], void>>;
}

function makeSpy<TArgs extends unknown[], TReturn>(returnValue: TReturn) {
  const calls: TArgs[] = [];
  const fn = (...args: TArgs): TReturn => {
    calls.push(args);
    return returnValue;
  };
  fn.calls = calls;
  return fn;
}

function makeDeps(tokenValid = true): MockDeps {
  return {
    validateToken: (token: string | null) => tokenValid && token === VALID_TOKEN,
    sendToBridge: makeSpy<[string, string], boolean>(true),
    broadcastToWatchers: makeSpy<[string, string], void>(undefined),
    storeTranscriptPath: makeSpy<[string, string], void>(undefined),
  };
}

// ── HookPayloadSchema ─────────────────────────────────────────────────────────

describe("HookPayloadSchema", () => {
  it("validates a SessionStart payload", () => {
    const result = HookPayloadSchema.safeParse({
      session_id: "sess-1",
      hook_event_name: "SessionStart",
      transcript_path: "/tmp/claude/transcript.jsonl",
      cwd: "/home/user/project",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session_id).toBe("sess-1");
      expect(result.data.hook_event_name).toBe("SessionStart");
      expect(result.data.transcript_path).toBe("/tmp/claude/transcript.jsonl");
    }
  });

  it("validates a PostToolUse payload", () => {
    const result = HookPayloadSchema.safeParse({
      session_id: "sess-2",
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/foo/bar.ts" },
      tool_output: "contents...",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tool_name).toBe("Read");
    }
  });

  it("rejects a payload missing session_id", () => {
    const result = HookPayloadSchema.safeParse({
      hook_event_name: "SessionStart",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload with empty session_id", () => {
    const result = HookPayloadSchema.safeParse({
      session_id: "",
      hook_event_name: "SessionStart",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing hook_event_name", () => {
    const result = HookPayloadSchema.safeParse({
      session_id: "sess-1",
    });
    expect(result.success).toBe(false);
  });

  it("passes through unknown extra fields", () => {
    const result = HookPayloadSchema.safeParse({
      session_id: "sess-1",
      hook_event_name: "Stop",
      custom_field: "custom_value",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)["custom_field"]).toBe("custom_value");
    }
  });
});

// ── createHookIngress ─────────────────────────────────────────────────────────

describe("createHookIngress", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  // ── Auth ───────────────────────────────────────────────────────────────────

  describe("authentication", () => {
    it("returns 401 when Authorization header is absent", async () => {
      const handler = createHookIngress(deps);
      const req = makeRequest({ session_id: "s1", hook_event_name: "Stop" }, { auth: null });
      const res = await handler(req);
      expect(res.status).toBe(401);
    });

    it("returns 401 when Bearer token is wrong", async () => {
      const handler = createHookIngress(deps);
      const req = makeRequest(
        { session_id: "s1", hook_event_name: "Stop" },
        { auth: "Bearer wrong-token" },
      );
      const res = await handler(req);
      expect(res.status).toBe(401);
    });

    it("returns 401 when Authorization header is not Bearer scheme", async () => {
      const handler = createHookIngress(deps);
      const req = makeRequest(
        { session_id: "s1", hook_event_name: "Stop" },
        { auth: "Basic dXNlcjpwYXNz" },
      );
      const res = await handler(req);
      expect(res.status).toBe(401);
    });
  });

  // ── Request body validation ────────────────────────────────────────────────

  describe("request body validation", () => {
    it("returns 400 for malformed JSON", async () => {
      const handler = createHookIngress(deps);
      const req = new Request("http://localhost/hook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VALID_TOKEN}`,
        },
        body: "not json {{{",
      });
      const res = await handler(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when session_id is missing", async () => {
      const handler = createHookIngress(deps);
      const req = makeRequest({ hook_event_name: "Stop" });
      const res = await handler(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when hook_event_name is missing", async () => {
      const handler = createHookIngress(deps);
      const req = makeRequest({ session_id: "s1" });
      const res = await handler(req);
      expect(res.status).toBe(400);
    });
  });

  // ── SessionStart routing ──────────────────────────────────────────────────

  describe("SessionStart", () => {
    it("stores transcript_path and sends session-context to bridge", async () => {
      const handler = createHookIngress(deps);
      const req = makeRequest({
        session_id: "sess-abc",
        hook_event_name: "SessionStart",
        transcript_path: "/tmp/claude/sess-abc.jsonl",
      });
      const res = await handler(req);
      expect(res.status).toBe(200);

      expect(deps.storeTranscriptPath.calls).toHaveLength(1);
      expect(deps.storeTranscriptPath.calls[0]).toEqual(["sess-abc", "/tmp/claude/sess-abc.jsonl"]);

      expect(deps.sendToBridge.calls).toHaveLength(1);
      const [bridgeSessionId, bridgePayload] = deps.sendToBridge.calls[0]!;
      expect(bridgeSessionId).toBe("sess-abc");
      const msg = JSON.parse(bridgePayload);
      expect(msg.type).toBe("session-context");
      expect(msg.sessionId).toBe("sess-abc");
      expect(msg.transcriptPath).toBe("/tmp/claude/sess-abc.jsonl");
    });

    it("does not call storeTranscriptPath or sendToBridge when transcript_path is absent", async () => {
      const handler = createHookIngress(deps);
      const req = makeRequest({
        session_id: "sess-abc",
        hook_event_name: "SessionStart",
      });
      const res = await handler(req);
      expect(res.status).toBe(200);
      expect(deps.storeTranscriptPath.calls).toHaveLength(0);
      expect(deps.sendToBridge.calls).toHaveLength(0);
    });
  });

  // ── PostToolUse routing ────────────────────────────────────────────────────

  describe("PostToolUse", () => {
    it("broadcasts a transcript-entry with type tool-call to watchers", async () => {
      const handler = createHookIngress(deps);
      const req = makeRequest({
        session_id: "sess-xyz",
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_input: { file_path: "/foo/bar.ts" },
      });
      const res = await handler(req);
      expect(res.status).toBe(200);

      expect(deps.broadcastToWatchers.calls).toHaveLength(1);
      const [watcherSessionId, watcherPayload] = deps.broadcastToWatchers.calls[0]!;
      expect(watcherSessionId).toBe("sess-xyz");
      const msg = JSON.parse(watcherPayload);
      expect(msg.type).toBe("transcript-entry");
      expect(msg.sessionId).toBe("sess-xyz");
      expect(msg.entry.type).toBe("tool-call");
      expect(msg.entry.role).toBe("assistant");
      expect(msg.entry.content).toBe("Read");
      expect(msg.entry.toolName).toBe("Read");
      expect(typeof msg.entry.toolInput).toBe("string");
      expect(typeof msg.entry.timestamp).toBe("number");
    });

    it("truncates toolInput to 200 chars", async () => {
      const handler = createHookIngress(deps);
      const longValue = "x".repeat(300);
      const req = makeRequest({
        session_id: "sess-xyz",
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: { content: longValue },
      });
      await handler(req);

      const [, watcherPayload] = deps.broadcastToWatchers.calls[0]!;
      const msg = JSON.parse(watcherPayload);
      expect(msg.entry.toolInput.length).toBeLessThanOrEqual(200);
    });
  });

  // ── PostToolUseFailure routing ─────────────────────────────────────────────

  describe("PostToolUseFailure", () => {
    it("broadcasts a transcript-entry with type tool-result", async () => {
      const handler = createHookIngress(deps);
      const req = makeRequest({
        session_id: "sess-fail",
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_input: { command: "rm -rf /" },
        tool_output: "Permission denied",
      });
      const res = await handler(req);
      expect(res.status).toBe(200);

      expect(deps.broadcastToWatchers.calls).toHaveLength(1);
      const [, watcherPayload] = deps.broadcastToWatchers.calls[0]!;
      const msg = JSON.parse(watcherPayload);
      expect(msg.entry.type).toBe("tool-result");
      expect(msg.entry.role).toBe("assistant");
    });
  });

  // ── Stop routing ───────────────────────────────────────────────────────────

  describe("Stop", () => {
    it("broadcasts a session-ended transcript-entry to watchers", async () => {
      const handler = createHookIngress(deps);
      const req = makeRequest({
        session_id: "sess-end",
        hook_event_name: "Stop",
      });
      const res = await handler(req);
      expect(res.status).toBe(200);

      expect(deps.broadcastToWatchers.calls).toHaveLength(1);
      const [watcherSessionId, watcherPayload] = deps.broadcastToWatchers.calls[0]!;
      expect(watcherSessionId).toBe("sess-end");
      const msg = JSON.parse(watcherPayload);
      expect(msg.type).toBe("transcript-entry");
      expect(msg.entry.type).toBe("response");
      expect(msg.entry.content).toBe("[session ended]");
    });
  });

  // ── Unknown events ─────────────────────────────────────────────────────────

  describe("unknown hook events", () => {
    it("returns 200 OK for an unrecognized hook_event_name", async () => {
      const handler = createHookIngress(deps);
      const req = makeRequest({
        session_id: "sess-1",
        hook_event_name: "SomeFutureHook",
        cwd: "/home/user",
      });
      const res = await handler(req);
      expect(res.status).toBe(200);
      expect(deps.broadcastToWatchers.calls).toHaveLength(0);
      expect(deps.sendToBridge.calls).toHaveLength(0);
      expect(deps.storeTranscriptPath.calls).toHaveLength(0);
    });
  });
});
