import { beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { type Config, getConfig } from "../../server/config";
import { SessionRegistry } from "../../server/sessions";
import { SubmissionStore } from "../../server/submissions";
import { WebSocketHub, type WsData } from "../../server/websocket";

// -- Mock WebSocket --

interface MockWs {
  data: WsData;
  sent: string[];
  closed: boolean;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

function makeMockWs(overrides: Partial<WsData> = {}): MockWs {
  return {
    data: {
      kind: "browser",
      id: crypto.randomUUID(),
      sessionId: undefined,
      lastHeartbeat: 1_000_000,
      ...overrides,
    },
    sent: [],
    closed: false,
    send(data: string) {
      this.sent.push(data);
    },
    close() {
      this.closed = true;
    },
  } as MockWs;
}

function browserWs(id?: string): MockWs {
  return makeMockWs({ kind: "browser", id: id ?? crypto.randomUUID() });
}

function bridgeWs(id?: string): MockWs {
  return makeMockWs({ kind: "bridge", id: id ?? crypto.randomUUID() });
}

function lastSent(ws: MockWs): Record<string, unknown> {
  return JSON.parse(ws.sent[ws.sent.length - 1]!) as Record<string, unknown>;
}

function allSentOfType(ws: MockWs, type: string): Record<string, unknown>[] {
  return ws.sent
    .map((s) => JSON.parse(s) as Record<string, unknown>)
    .filter((m) => m.type === type);
}

// -- Test fixtures --

const TEST_DIR = "/tmp/trayce-test-ws";
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const BASE_CONFIG = getConfig({});

interface Fixture {
  hub: WebSocketHub;
  registry: SessionRegistry;
  store: SubmissionStore;
  now: { value: number };
}

function makeFixture(configOverrides: Partial<Config> = {}): Fixture {
  const registry = new SessionRegistry();
  const store = new SubmissionStore(TEST_DIR, 20 * 1024 * 1024);
  const nowRef = { value: 1_000_000 };
  const config = { ...BASE_CONFIG, ...configOverrides };
  const hub = new WebSocketHub(
    registry,
    store,
    config,
    () => {},
    () => nowRef.value,
  );
  return { hub, registry, store, now: nowRef };
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// -- parseMessage --

describe("parseMessage", () => {
  it("parses valid JSON object with type", () => {
    expect(WebSocketHub.parseMessage('{"type":"heartbeat"}')).toEqual({ type: "heartbeat" });
  });

  it("preserves extra fields", () => {
    const msg = WebSocketHub.parseMessage('{"type":"register","sessionId":"s1","label":"app"}');
    expect(msg?.sessionId).toBe("s1");
  });

  it("accepts Buffer input", () => {
    expect(WebSocketHub.parseMessage(Buffer.from('{"type":"heartbeat"}'))).toEqual({
      type: "heartbeat",
    });
  });

  it("returns null for invalid JSON", () => {
    expect(WebSocketHub.parseMessage("not json")).toBeNull();
  });

  it("returns null for JSON array", () => {
    expect(WebSocketHub.parseMessage("[]")).toBeNull();
  });

  it("returns null for JSON null", () => {
    expect(WebSocketHub.parseMessage("null")).toBeNull();
  });

  it("returns null for JSON string", () => {
    expect(WebSocketHub.parseMessage('"hello"')).toBeNull();
  });

  it("returns null for missing type", () => {
    expect(WebSocketHub.parseMessage('{"foo":"bar"}')).toBeNull();
  });

  it("returns null for non-string type", () => {
    expect(WebSocketHub.parseMessage('{"type":42}')).toBeNull();
  });

  it("returns null for empty type", () => {
    expect(WebSocketHub.parseMessage('{"type":""}')).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(WebSocketHub.parseMessage("")).toBeNull();
  });
});

// -- addBrowser / removeBrowser --

describe("addBrowser", () => {
  it("sends current session list on connect", () => {
    const { hub, registry } = makeFixture();
    registry.add("s1", "app");
    const ws = browserWs();
    hub.addBrowser(ws as any);
    expect(lastSent(ws)).toEqual({
      type: "sessions",
      sessions: [{ id: "s1", label: "app", status: "active" }],
    });
  });

  it("sends empty sessions when no bridges registered", () => {
    const { hub } = makeFixture();
    const ws = browserWs();
    hub.addBrowser(ws as any);
    expect(lastSent(ws)).toEqual({ type: "sessions", sessions: [] });
  });

  it("increments browserCount", () => {
    const { hub } = makeFixture();
    hub.addBrowser(browserWs() as any);
    expect(hub.browserCount).toBe(1);
  });
});

describe("removeBrowser", () => {
  it("removed browser does not receive broadcasts", () => {
    const { hub } = makeFixture();
    const ws = browserWs();
    hub.addBrowser(ws as any);
    hub.removeBrowser(ws as any);
    const countBefore = ws.sent.length;
    hub.broadcastSessions();
    expect(ws.sent.length).toBe(countBefore);
  });
});

// -- addBridge / removeBridge --

describe("addBridge", () => {
  it("does not register session until register message", () => {
    const { hub, registry } = makeFixture();
    hub.addBridge(bridgeWs() as any);
    expect(registry.list()).toEqual([]);
  });
});

describe("removeBridge", () => {
  it("removes session and broadcasts on registered bridge disconnect", async () => {
    const { hub, registry } = makeFixture();
    const browser = browserWs();
    const bridge = bridgeWs();
    hub.addBrowser(browser as any);
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );
    expect(registry.has("s1")).toBe(true);

    browser.sent.length = 0;
    hub.removeBridge(bridge as any);
    expect(registry.has("s1")).toBe(false);
    expect(lastSent(browser)).toEqual({ type: "sessions", sessions: [] });
  });

  it("is no-op for unregistered bridge", () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    expect(() => hub.removeBridge(bridge as any)).not.toThrow();
  });
});

// -- Heartbeat --

describe("heartbeat", () => {
  it("echoes heartbeat and updates lastHeartbeat", async () => {
    const { hub, now } = makeFixture();
    const ws = browserWs();
    ws.data.lastHeartbeat = 0;
    hub.addBrowser(ws as any);
    ws.sent.length = 0;
    now.value = 2_000_000;

    await hub.handleMessage(ws as any, JSON.stringify({ type: "heartbeat" }));
    expect(lastSent(ws).type).toBe("heartbeat");
    expect(ws.data.lastHeartbeat).toBe(2_000_000);
  });

  it("works for bridges too", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "heartbeat" }));
    expect(lastSent(bridge).type).toBe("heartbeat");
  });
});

// -- Register --

describe("register", () => {
  it("adds session to registry and broadcasts", async () => {
    const { hub, registry } = makeFixture();
    const browser = browserWs();
    const bridge = bridgeWs();
    hub.addBrowser(browser as any);
    hub.addBridge(bridge as any);
    browser.sent.length = 0;

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "my-app" }),
    );
    expect(registry.has("s1")).toBe(true);
    expect(lastSent(browser).type).toBe("sessions");
  });

  it("ignores register with missing sessionId", async () => {
    const { hub, registry } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", label: "app" }));
    expect(registry.list()).toEqual([]);
  });

  it("ignores register with missing label", async () => {
    const { hub, registry } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1" }));
    expect(registry.list()).toEqual([]);
  });

  it("ignores register from browser", async () => {
    const { hub, registry } = makeFixture();
    const ws = browserWs();
    hub.addBrowser(ws as any);
    await hub.handleMessage(
      ws as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );
    expect(registry.list()).toEqual([]);
  });

  it("re-register replaces old session", async () => {
    const { hub, registry } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "first" }),
    );
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s2", label: "second" }),
    );
    expect(registry.has("s1")).toBe(false);
    expect(registry.has("s2")).toBe(true);
  });

  it("re-registration by different bridge evicts old bridge", async () => {
    const { hub } = makeFixture();
    const bridge1 = bridgeWs();
    const bridge2 = bridgeWs();
    hub.addBridge(bridge1 as any);
    hub.addBridge(bridge2 as any);
    await hub.handleMessage(
      bridge1 as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );
    await hub.handleMessage(
      bridge2 as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app-new" }),
    );
    expect(bridge1.closed).toBe(true);
    expect(bridge2.data.sessionId).toBe("s1");
  });

  it("evicted bridge removeBridge does not remove new session", async () => {
    const { hub, registry } = makeFixture();
    const bridge1 = bridgeWs();
    const bridge2 = bridgeWs();
    hub.addBridge(bridge1 as any);
    hub.addBridge(bridge2 as any);
    await hub.handleMessage(
      bridge1 as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );
    await hub.handleMessage(
      bridge2 as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );
    // Simulate Bun's close handler for evicted bridge1
    hub.removeBridge(bridge1 as any);
    expect(registry.has("s1")).toBe(true); // bridge2 still owns it
  });
});

// -- Submit --

describe("submit — happy path", () => {
  it("saves, routes to bridge, and acks browser", async () => {
    const { hub } = makeFixture();
    const browser = browserWs();
    const bridge = bridgeWs();
    hub.addBrowser(browser as any);
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );
    browser.sent.length = 0;

    await hub.handleMessage(
      browser as any,
      JSON.stringify({
        type: "submit",
        targetSessionId: "s1",
        image: TINY_PNG_B64,
        prompt: "draw this",
      }),
    );

    // Bridge received submission
    const sub = JSON.parse(bridge.sent[bridge.sent.length - 1]!) as any;
    expect(sub.type).toBe("submission");
    expect(sub.prompt).toBe("draw this");
    expect(typeof sub.pngPath).toBe("string");

    // Browser received ack
    const ack = lastSent(browser);
    expect(ack.type).toBe("ack");
    expect(ack.submissionId).toBe(sub.id);
  });

  it("acks even when target bridge has disconnected", async () => {
    const { hub } = makeFixture();
    const browser = browserWs();
    const bridge = bridgeWs();
    hub.addBrowser(browser as any);
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );
    hub.removeBridge(bridge as any);
    browser.sent.length = 0;

    await hub.handleMessage(
      browser as any,
      JSON.stringify({
        type: "submit",
        targetSessionId: "s1",
        image: TINY_PNG_B64,
        prompt: "",
      }),
    );

    const ack = lastSent(browser);
    expect(ack.type).toBe("ack");
  });

  it("defaults prompt to empty string when absent", async () => {
    const { hub } = makeFixture();
    const browser = browserWs();
    const bridge = bridgeWs();
    hub.addBrowser(browser as any);
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    await hub.handleMessage(
      browser as any,
      JSON.stringify({
        type: "submit",
        targetSessionId: "s1",
        image: TINY_PNG_B64,
      }),
    );

    const sub = JSON.parse(bridge.sent[bridge.sent.length - 1]!) as any;
    expect(sub.prompt).toBe("");
  });
});

describe("submit — validation", () => {
  it("rejects missing targetSessionId", async () => {
    const { hub } = makeFixture();
    const ws = browserWs();
    hub.addBrowser(ws as any);
    ws.sent.length = 0;
    await hub.handleMessage(ws as any, JSON.stringify({ type: "submit", image: TINY_PNG_B64 }));
    expect(lastSent(ws).code).toBe("INVALID_TARGET");
  });

  it("rejects empty submission (no image and no prompt)", async () => {
    const { hub } = makeFixture();
    const ws = browserWs();
    hub.addBrowser(ws as any);
    ws.sent.length = 0;
    await hub.handleMessage(ws as any, JSON.stringify({ type: "submit", targetSessionId: "s1" }));
    expect(lastSent(ws).code).toBe("EMPTY_SUBMISSION");
  });

  it("accepts text-only submission without image", async () => {
    const { hub, registry } = makeFixture();
    registry.add("s1", "test");
    const browser = browserWs();
    hub.addBrowser(browser as any);
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "test" }),
    );
    browser.sent.length = 0;
    bridge.sent.length = 0;

    await hub.handleMessage(
      browser as any,
      JSON.stringify({
        type: "submit",
        targetSessionId: "s1",
        prompt: "Hello from text-only",
      }),
    );

    expect(lastSent(browser).type).toBe("ack");
    const bridgeMsg = lastSent(bridge);
    expect(bridgeMsg.type).toBe("submission");
    expect(bridgeMsg.prompt).toBe("Hello from text-only");
    expect(bridgeMsg.pngPath).toBeUndefined();
  });

  it("rejects oversized submission", async () => {
    const { hub: _, registry } = makeFixture();
    const tinyStore = new SubmissionStore(TEST_DIR, 10);
    const hub = new WebSocketHub(registry, tinyStore, BASE_CONFIG, () => {});
    const ws = browserWs();
    hub.addBrowser(ws as any);
    ws.sent.length = 0;
    await hub.handleMessage(
      ws as any,
      JSON.stringify({
        type: "submit",
        targetSessionId: "s1",
        image: TINY_PNG_B64,
        prompt: "",
      }),
    );
    expect(lastSent(ws).code).toBe("SUBMISSION_FAILED");
  });

  it("ignores submit from bridge", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    const before = bridge.sent.length;
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "submit",
        targetSessionId: "s1",
        image: TINY_PNG_B64,
      }),
    );
    expect(bridge.sent.length).toBe(before);
  });
});

// -- Rate limiting --

describe("rate limiting", () => {
  it("allows up to rateLimitPerMinute", () => {
    const { hub } = makeFixture({ rateLimitPerMinute: 3 });
    const ws = browserWs();
    hub.addBrowser(ws as any);
    expect(hub.checkRateLimit(ws.data.id)).toBe(true);
    expect(hub.checkRateLimit(ws.data.id)).toBe(true);
    expect(hub.checkRateLimit(ws.data.id)).toBe(true);
  });

  it("blocks submission exceeding limit", () => {
    const { hub } = makeFixture({ rateLimitPerMinute: 2 });
    const ws = browserWs();
    hub.addBrowser(ws as any);
    hub.checkRateLimit(ws.data.id);
    hub.checkRateLimit(ws.data.id);
    expect(hub.checkRateLimit(ws.data.id)).toBe(false);
  });

  it("resets after window expires", () => {
    const { hub, now } = makeFixture({ rateLimitPerMinute: 1 });
    const ws = browserWs();
    hub.addBrowser(ws as any);
    hub.checkRateLimit(ws.data.id);
    expect(hub.checkRateLimit(ws.data.id)).toBe(false);
    now.value += 61_000;
    expect(hub.checkRateLimit(ws.data.id)).toBe(true);
  });

  it("independent per client", () => {
    const { hub } = makeFixture({ rateLimitPerMinute: 1 });
    const a = browserWs();
    const b = browserWs();
    hub.addBrowser(a as any);
    hub.addBrowser(b as any);
    hub.checkRateLimit(a.data.id);
    expect(hub.checkRateLimit(a.data.id)).toBe(false);
    expect(hub.checkRateLimit(b.data.id)).toBe(true);
  });
});

// -- Heartbeat timeout --

describe("checkHeartbeats", () => {
  it("closes stale browser", () => {
    const { hub, now } = makeFixture();
    const ws = browserWs();
    hub.addBrowser(ws as any);
    now.value += BASE_CONFIG.heartbeatTimeoutMs + 1;
    hub.checkHeartbeats();
    expect(ws.closed).toBe(true);
  });

  it("does not close fresh browser", () => {
    const { hub, now } = makeFixture();
    const ws = browserWs();
    ws.data.lastHeartbeat = now.value;
    hub.addBrowser(ws as any);
    now.value += BASE_CONFIG.heartbeatTimeoutMs - 1;
    hub.checkHeartbeats();
    expect(ws.closed).toBe(false);
  });

  it("closes stale registered bridge", async () => {
    const { hub, now } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );
    now.value += BASE_CONFIG.heartbeatTimeoutMs + 1;
    hub.checkHeartbeats();
    expect(bridge.closed).toBe(true);
  });

  it("closes stale pending (unregistered) bridge", () => {
    const { hub, now } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    now.value += BASE_CONFIG.heartbeatTimeoutMs + 1;
    hub.checkHeartbeats();
    expect(bridge.closed).toBe(true);
  });

  it("is no-op with no connections", () => {
    const { hub, now } = makeFixture();
    now.value += 999_999;
    expect(() => hub.checkHeartbeats()).not.toThrow();
  });
});

// -- broadcastSessions --

describe("broadcastSessions", () => {
  it("sends to all connected browsers", () => {
    const { hub } = makeFixture();
    const b1 = browserWs();
    const b2 = browserWs();
    hub.addBrowser(b1 as any);
    hub.addBrowser(b2 as any);
    b1.sent.length = 0;
    b2.sent.length = 0;
    hub.broadcastSessions();
    expect(lastSent(b1).type).toBe("sessions");
    expect(lastSent(b2).type).toBe("sessions");
  });

  it("is no-op with no browsers", () => {
    const { hub } = makeFixture();
    expect(() => hub.broadcastSessions()).not.toThrow();
  });

  it("does not throw when ws.send throws", () => {
    const { hub } = makeFixture();
    const ws = browserWs();
    ws.send = () => {
      throw new Error("broken");
    };
    hub.addBrowser(ws as any);
    expect(() => hub.broadcastSessions()).not.toThrow();
  });
});

// -- Malformed input --

describe("malformed input", () => {
  it("silently drops invalid JSON", async () => {
    const { hub } = makeFixture();
    const ws = browserWs();
    hub.addBrowser(ws as any);
    ws.sent.length = 0;
    await hub.handleMessage(ws as any, "bad json");
    expect(ws.sent.length).toBe(0);
  });

  it("silently drops unknown message type", async () => {
    const { hub } = makeFixture();
    const ws = browserWs();
    hub.addBrowser(ws as any);
    ws.sent.length = 0;
    await hub.handleMessage(ws as any, JSON.stringify({ type: "unknown" }));
    expect(ws.sent.length).toBe(0);
  });
});

// -- Transcript buffering --

describe("transcript buffering", () => {
  it("buffers transcript-entry messages from bridge", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "transcript-entry",
        entry: { type: "message", role: "user", content: "Hello" },
      }),
    );
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "transcript-entry",
        entry: { type: "response", role: "assistant", content: "Hi there" },
      }),
    );

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );

    const transcriptMsgs = allSentOfType(browser, "transcript-entry");
    expect(transcriptMsgs).toHaveLength(2);
    expect((transcriptMsgs[0]!.entry as any).content).toBe("Hello");
    expect((transcriptMsgs[1]!.entry as any).content).toBe("Hi there");
  });

  it("buffers response messages from bridge", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "response",
        content: "Here is my answer",
        format: "markdown",
      }),
    );

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );

    const responseMsgs = allSentOfType(browser, "response");
    expect(responseMsgs).toHaveLength(1);
    expect(responseMsgs[0]!.content).toBe("Here is my answer");
  });

  it("replays buffer on watch-session, then routes live entries normally", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "transcript-entry",
        entry: { type: "message", role: "user", content: "buffered" },
      }),
    );

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );

    const beforeLive = allSentOfType(browser, "transcript-entry");
    expect(beforeLive).toHaveLength(1);

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "transcript-entry",
        entry: { type: "response", role: "assistant", content: "live" },
      }),
    );

    const afterLive = allSentOfType(browser, "transcript-entry");
    expect(afterLive).toHaveLength(2);
    expect((afterLive[1]!.entry as any).content).toBe("live");
  });

  it("caps buffer at transcriptBufferSize, dropping oldest entries", async () => {
    const { hub } = makeFixture({ transcriptBufferSize: 3 });
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    for (let i = 1; i <= 5; i++) {
      await hub.handleMessage(
        bridge as any,
        JSON.stringify({
          type: "transcript-entry",
          entry: { type: "message", role: "user", content: `msg-${i}` },
        }),
      );
    }

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );

    const msgs = allSentOfType(browser, "transcript-entry");
    expect(msgs).toHaveLength(3);
    expect((msgs[0]!.entry as any).content).toBe("msg-3");
    expect((msgs[1]!.entry as any).content).toBe("msg-4");
    expect((msgs[2]!.entry as any).content).toBe("msg-5");
  });

  it("cleans up buffer when bridge disconnects and session is removed", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "transcript-entry",
        entry: { type: "message", role: "user", content: "old" },
      }),
    );

    hub.removeBridge(bridge as any);

    const bridge2 = bridgeWs();
    hub.addBridge(bridge2 as any);
    await hub.handleMessage(
      bridge2 as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );

    const msgs = allSentOfType(browser, "transcript-entry");
    expect(msgs).toHaveLength(0);
  });

  it("buffers canvas-push messages", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "canvas-push",
        image: "abc123",
        label: "test-image",
      }),
    );

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );

    const pushMsgs = allSentOfType(browser, "canvas-push");
    expect(pushMsgs).toHaveLength(1);
  });

  it("replays correct buffer when browser switches sessions", async () => {
    const { hub } = makeFixture();
    const bridge1 = bridgeWs();
    const bridge2 = bridgeWs();
    hub.addBridge(bridge1 as any);
    hub.addBridge(bridge2 as any);
    await hub.handleMessage(
      bridge1 as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "session-1" }),
    );
    await hub.handleMessage(
      bridge2 as any,
      JSON.stringify({ type: "register", sessionId: "s2", label: "session-2" }),
    );

    await hub.handleMessage(
      bridge1 as any,
      JSON.stringify({
        type: "transcript-entry",
        entry: { type: "message", role: "user", content: "from-s1" },
      }),
    );
    await hub.handleMessage(
      bridge2 as any,
      JSON.stringify({
        type: "transcript-entry",
        entry: { type: "message", role: "user", content: "from-s2" },
      }),
    );

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;

    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );
    let msgs = allSentOfType(browser, "transcript-entry");
    expect(msgs).toHaveLength(1);
    expect((msgs[0]!.entry as any).content).toBe("from-s1");

    browser.sent.length = 0;
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s2" }),
    );
    msgs = allSentOfType(browser, "transcript-entry");
    expect(msgs).toHaveLength(1);
    expect((msgs[0]!.entry as any).content).toBe("from-s2");
  });
});

// -- Bridge rate limiting --

describe("bridge rate limiting", () => {
  it("rate-limits canvas-push messages but not transcript entries", async () => {
    const { hub } = makeFixture({ rateLimitPerMinute: 3 });
    const browser = browserWs();
    const bridge = bridgeWs();
    hub.addBrowser(browser as any);
    hub.addBridge(bridge as any);

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "register",
        sessionId: "s1",
        label: "test",
      }),
    );

    await hub.handleMessage(
      browser as any,
      JSON.stringify({
        type: "watch-session",
        sessionId: "s1",
      }),
    );

    // Send 4 transcript entries — all should arrive (not rate-limited)
    for (let i = 0; i < 4; i++) {
      await hub.handleMessage(
        bridge as any,
        JSON.stringify({
          type: "transcript-entry",
          entry: { content: `msg ${i}` },
        }),
      );
    }
    const delivered = allSentOfType(browser, "transcript-entry");
    expect(delivered.length).toBe(4);

    // Send 3 canvas-push messages — should all arrive
    for (let i = 0; i < 3; i++) {
      await hub.handleMessage(
        bridge as any,
        JSON.stringify({
          type: "canvas-push",
          image: "abc",
          label: `push ${i}`,
        }),
      );
    }
    const pushes = allSentOfType(browser, "canvas-push");
    expect(pushes.length).toBe(3);

    // 4th canvas-push should be dropped
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "canvas-push",
        image: "abc",
        label: "blocked",
      }),
    );
    const afterLimit = allSentOfType(browser, "canvas-push");
    expect(afterLimit.length).toBe(3);
  });
});

// -- Usage routing --

describe("usage routing", () => {
  it("accumulates usage-update and sends snapshot on watch-session", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "usage-update",
        usage: {
          inputTokens: 10,
          outputTokens: 50,
          cacheReadTokens: 200,
          cacheWriteTokens: 30,
          model: "claude-opus-4-6",
          timestamp: 1000,
        },
      }),
    );
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "usage-update",
        usage: {
          inputTokens: 20,
          outputTokens: 30,
          cacheReadTokens: 100,
          cacheWriteTokens: 10,
          model: "claude-opus-4-6",
          timestamp: 2000,
        },
      }),
    );

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );

    const snapshots = allSentOfType(browser, "usage-snapshot");
    expect(snapshots).toHaveLength(1);
    const usage = snapshots[0]!.usage as any;
    expect(usage.inputTokens).toBe(30);
    expect(usage.outputTokens).toBe(80);
    expect(usage.cacheReadTokens).toBe(300);
    expect(usage.requestCount).toBe(2);
  });

  it("forwards live usage-update to watching browsers", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    const browser = browserWs();
    hub.addBridge(bridge as any);
    hub.addBrowser(browser as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );
    browser.sent.length = 0;

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "usage-update",
        usage: {
          inputTokens: 5,
          outputTokens: 25,
          cacheReadTokens: 50,
          cacheWriteTokens: 0,
          model: "claude-opus-4-6",
          timestamp: 3000,
        },
      }),
    );

    const updates = allSentOfType(browser, "usage-update");
    expect(updates).toHaveLength(1);
    expect((updates[0]!.usage as any).outputTokens).toBe(25);
  });

  it("cleans up usage when bridge disconnects", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "usage-update",
        usage: {
          inputTokens: 10,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "claude-opus-4-6",
          timestamp: 1000,
        },
      }),
    );

    hub.removeBridge(bridge as any);

    const bridge2 = bridgeWs();
    hub.addBridge(bridge2 as any);
    await hub.handleMessage(
      bridge2 as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );

    const snapshots = allSentOfType(browser, "usage-snapshot");
    expect(snapshots).toHaveLength(1);
    expect((snapshots[0]!.usage as any).requestCount).toBe(0);
  });

  it("sends empty snapshot when no usage data exists", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );

    const snapshots = allSentOfType(browser, "usage-snapshot");
    expect(snapshots).toHaveLength(1);
    expect((snapshots[0]!.usage as any).requestCount).toBe(0);
  });
});

// -- Submit ack status --

describe("submit without bridge", () => {
  it("returns queued status when no bridge is connected", async () => {
    const { hub } = makeFixture();
    const browser = browserWs();
    hub.addBrowser(browser as any);

    await hub.handleMessage(
      browser as any,
      JSON.stringify({
        type: "submit",
        targetSessionId: "nonexistent",
        image: TINY_PNG_B64,
        prompt: "test",
      }),
    );

    const ack = lastSent(browser);
    expect(ack.type).toBe("ack");
    expect(ack.status).toBe("queued");
  });

  it("returns delivered status when bridge is connected", async () => {
    const { hub } = makeFixture();
    const browser = browserWs();
    const bridge = bridgeWs();
    hub.addBrowser(browser as any);
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "register",
        sessionId: "s1",
        label: "test",
      }),
    );

    await hub.handleMessage(
      browser as any,
      JSON.stringify({
        type: "submit",
        targetSessionId: "s1",
        image: TINY_PNG_B64,
        prompt: "test",
      }),
    );

    const msgs = browser.sent.map((s) => JSON.parse(s));
    const ack = msgs.find((m: any) => m.type === "ack");
    expect(ack.status).toBe("delivered");
  });
});

// -- canvas-push buffering --

describe("canvas-push buffering", () => {
  it("replays canvas-push to browsers that watch-session after the push", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    const browser = browserWs();
    hub.addBridge(bridge as any);
    hub.addBrowser(browser as any);

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "register",
        sessionId: "s1",
        label: "test",
      }),
    );

    // Bridge sends canvas-push before browser watches
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "canvas-push",
        image: "base64data",
        label: "test-image",
      }),
    );

    // Browser starts watching — should get the buffered push
    await hub.handleMessage(
      browser as any,
      JSON.stringify({
        type: "watch-session",
        sessionId: "s1",
      }),
    );

    const pushMsgs = allSentOfType(browser, "canvas-push");
    expect(pushMsgs.length).toBe(1);
    expect(pushMsgs[0]!.label).toBe("test-image");
  });
});

describe("shutdown-request", () => {
  it("calls shutdownFn with restart=true and sends server-exiting ack", async () => {
    const registry = new SessionRegistry();
    const store = new SubmissionStore(TEST_DIR, 20 * 1024 * 1024);
    const shutdownCalls: Array<{ restart: boolean; containerMode: boolean }> = [];
    const hub = new WebSocketHub(registry, store, BASE_CONFIG, (opts) => {
      shutdownCalls.push(opts);
    });

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;

    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "shutdown-request", restart: true }),
    );

    // Browser should receive server-exiting ack immediately (before the timeout fires)
    const ackMessages = browser.sent
      .map((s) => JSON.parse(s) as Record<string, unknown>)
      .filter((m) => m.type === "server-exiting");
    expect(ackMessages).toHaveLength(1);
    expect(ackMessages[0]!.restart).toBe(true);
    expect(typeof ackMessages[0]!.containerMode).toBe("boolean");

    // shutdownFn is called asynchronously via setTimeout(..., 50)
    await new Promise((r) => setTimeout(r, 100));
    expect(shutdownCalls).toHaveLength(1);
    expect(shutdownCalls[0]!.restart).toBe(true);
  });

  it("calls shutdownFn with restart=false for clean shutdown", async () => {
    const registry = new SessionRegistry();
    const store = new SubmissionStore(TEST_DIR, 20 * 1024 * 1024);
    const shutdownCalls: Array<{ restart: boolean; containerMode: boolean }> = [];
    const hub = new WebSocketHub(registry, store, BASE_CONFIG, (opts) => {
      shutdownCalls.push(opts);
    });

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;

    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "shutdown-request", restart: false }),
    );

    const ackMessages = browser.sent
      .map((s) => JSON.parse(s) as Record<string, unknown>)
      .filter((m) => m.type === "server-exiting");
    expect(ackMessages).toHaveLength(1);
    expect(ackMessages[0]!.restart).toBe(false);

    await new Promise((r) => setTimeout(r, 100));
    expect(shutdownCalls).toHaveLength(1);
    expect(shutdownCalls[0]!.restart).toBe(false);
  });
});
