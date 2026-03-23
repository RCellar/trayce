import { describe, expect, it, beforeEach } from "bun:test";
import { WebSocketHub, type WsMessage, type WsData } from "../../server/websocket";
import { SessionRegistry } from "../../server/sessions";
import { SubmissionStore } from "../../server/submissions";
import { getConfig, type Config } from "../../server/config";
import { rmSync } from "node:fs";

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
    send(data: string) { this.sent.push(data); },
    close() { this.closed = true; },
  } as MockWs;
}

function browserWs(id?: string): MockWs {
  return makeMockWs({ kind: "browser", id: id ?? crypto.randomUUID() });
}

function bridgeWs(id?: string): MockWs {
  return makeMockWs({ kind: "bridge", id: id ?? crypto.randomUUID() });
}

function lastSent(ws: MockWs): Record<string, unknown> {
  return JSON.parse(ws.sent[ws.sent.length - 1]) as Record<string, unknown>;
}

function allSentOfType(ws: MockWs, type: string): Record<string, unknown>[] {
  return ws.sent.map((s) => JSON.parse(s) as Record<string, unknown>).filter((m) => m.type === type);
}

// -- Test fixtures --

const TEST_DIR = "/tmp/trayce-test-ws";
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
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
  const hub = new WebSocketHub(registry, store, config, () => nowRef.value);
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
    expect(WebSocketHub.parseMessage(Buffer.from('{"type":"heartbeat"}'))).toEqual({ type: "heartbeat" });
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
    expect(lastSent(ws)).toEqual({ type: "sessions", sessions: [{ id: "s1", label: "app", status: "active" }] });
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
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));
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

    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "my-app" }));
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
    await hub.handleMessage(ws as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));
    expect(registry.list()).toEqual([]);
  });

  it("re-register replaces old session", async () => {
    const { hub, registry } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "first" }));
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s2", label: "second" }));
    expect(registry.has("s1")).toBe(false);
    expect(registry.has("s2")).toBe(true);
  });

  it("re-registration by different bridge evicts old bridge", async () => {
    const { hub } = makeFixture();
    const bridge1 = bridgeWs();
    const bridge2 = bridgeWs();
    hub.addBridge(bridge1 as any);
    hub.addBridge(bridge2 as any);
    await hub.handleMessage(bridge1 as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));
    await hub.handleMessage(bridge2 as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app-new" }));
    expect(bridge1.closed).toBe(true);
    expect(bridge2.data.sessionId).toBe("s1");
  });

  it("evicted bridge removeBridge does not remove new session", async () => {
    const { hub, registry } = makeFixture();
    const bridge1 = bridgeWs();
    const bridge2 = bridgeWs();
    hub.addBridge(bridge1 as any);
    hub.addBridge(bridge2 as any);
    await hub.handleMessage(bridge1 as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));
    await hub.handleMessage(bridge2 as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));
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
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));
    browser.sent.length = 0;

    await hub.handleMessage(browser as any, JSON.stringify({
      type: "submit", targetSessionId: "s1", image: TINY_PNG_B64, prompt: "draw this",
    }));

    // Bridge received submission
    const sub = JSON.parse(bridge.sent[bridge.sent.length - 1]) as any;
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
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));
    hub.removeBridge(bridge as any);
    browser.sent.length = 0;

    await hub.handleMessage(browser as any, JSON.stringify({
      type: "submit", targetSessionId: "s1", image: TINY_PNG_B64, prompt: "",
    }));

    const ack = lastSent(browser);
    expect(ack.type).toBe("ack");
  });

  it("defaults prompt to empty string when absent", async () => {
    const { hub } = makeFixture();
    const browser = browserWs();
    const bridge = bridgeWs();
    hub.addBrowser(browser as any);
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));

    await hub.handleMessage(browser as any, JSON.stringify({
      type: "submit", targetSessionId: "s1", image: TINY_PNG_B64,
    }));

    const sub = JSON.parse(bridge.sent[bridge.sent.length - 1]) as any;
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

  it("rejects missing image", async () => {
    const { hub } = makeFixture();
    const ws = browserWs();
    hub.addBrowser(ws as any);
    ws.sent.length = 0;
    await hub.handleMessage(ws as any, JSON.stringify({ type: "submit", targetSessionId: "s1" }));
    expect(lastSent(ws).code).toBe("INVALID_IMAGE");
  });

  it("rejects oversized submission", async () => {
    const { hub: _, registry } = makeFixture();
    const tinyStore = new SubmissionStore(TEST_DIR, 10);
    const hub = new WebSocketHub(registry, tinyStore, BASE_CONFIG);
    const ws = browserWs();
    hub.addBrowser(ws as any);
    ws.sent.length = 0;
    await hub.handleMessage(ws as any, JSON.stringify({
      type: "submit", targetSessionId: "s1", image: TINY_PNG_B64, prompt: "",
    }));
    expect(lastSent(ws).code).toBe("SUBMISSION_FAILED");
  });

  it("ignores submit from bridge", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    const before = bridge.sent.length;
    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "submit", targetSessionId: "s1", image: TINY_PNG_B64,
    }));
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
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));
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
    ws.send = () => { throw new Error("broken"); };
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
