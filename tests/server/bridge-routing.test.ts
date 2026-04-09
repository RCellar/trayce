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

// -- Test fixtures --

const TEST_DIR = "/tmp/trayce-test-bridge-routing";
const BASE_CONFIG = getConfig({});

function makeHub(configOverrides: Partial<Config> = {}): WebSocketHub {
  const registry = new SessionRegistry();
  const store = new SubmissionStore(TEST_DIR, 20 * 1024 * 1024);
  const config = { ...BASE_CONFIG, ...configOverrides };
  return new WebSocketHub(registry, store, config, () => {});
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// Helper: set up bridge+browser with registration and watch-session
async function setupWatching(
  hub: WebSocketHub,
  sessionId: string = "s1",
): Promise<{ bridge: MockWs; browser: MockWs }> {
  const bridge = bridgeWs();
  const browser = browserWs();
  hub.addBridge(bridge as any);
  hub.addBrowser(browser as any);
  await hub.handleMessage(
    bridge as any,
    JSON.stringify({ type: "register", sessionId, label: "app" }),
  );
  await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session", sessionId }));
  browser.sent.length = 0;
  bridge.sent.length = 0;
  return { bridge, browser };
}

// -- watch-session handling --

describe("watch-session", () => {
  it("stores which session a browser is watching", async () => {
    const hub = makeHub();
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
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );

    // Only a usage-snapshot is sent (no errors, no other responses)
    expect(browser.sent.length).toBe(1);
    expect(JSON.parse(browser.sent[0]!).type).toBe("usage-snapshot");
  });

  it("ignores watch-session with missing sessionId", async () => {
    const hub = makeHub();
    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;

    await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session" }));

    expect(browser.sent.length).toBe(0);
  });

  it("ignores watch-session with non-string sessionId", async () => {
    const hub = makeHub();
    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;

    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: 42 }),
    );

    expect(browser.sent.length).toBe(0);
  });

  it("ignores watch-session from bridge", async () => {
    const hub = makeHub();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    bridge.sent.length = 0;

    // No error should be thrown; bridge just ignores non-bridge messages
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );

    expect(bridge.sent.length).toBe(0);
  });
});

// -- Bridge-to-browser routing --

describe("bridge routing — transcript-entry", () => {
  it("routes transcript-entry to browsers watching the session", async () => {
    const hub = makeHub();
    const { bridge, browser } = await setupWatching(hub, "s1");

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "transcript-entry",
        role: "assistant",
        text: "Hello!",
      }),
    );

    expect(browser.sent.length).toBe(1);
    const msg = JSON.parse(browser.sent[0]!) as Record<string, unknown>;
    expect(msg.type).toBe("transcript-entry");
    expect(msg.role).toBe("assistant");
    expect(msg.text).toBe("Hello!");
    expect(msg.sessionId).toBe("s1");
  });

  it("does NOT route transcript-entry to browsers watching a different session", async () => {
    const hub = makeHub();
    const { bridge } = await setupWatching(hub, "s1");

    // Second browser watching s2
    const browser2 = browserWs();
    hub.addBrowser(browser2 as any);
    await hub.handleMessage(
      browser2 as any,
      JSON.stringify({ type: "watch-session", sessionId: "s2" }),
    );
    browser2.sent.length = 0;

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "transcript-entry",
        role: "user",
        text: "Hi",
      }),
    );

    expect(browser2.sent.length).toBe(0);
  });
});

describe("bridge routing — response", () => {
  it("routes response from bridge to browsers watching that session", async () => {
    const hub = makeHub();
    const { bridge, browser } = await setupWatching(hub, "s1");

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "response",
        content: "Here is the answer.",
      }),
    );

    expect(browser.sent.length).toBe(1);
    const msg = JSON.parse(browser.sent[0]!) as Record<string, unknown>;
    expect(msg.type).toBe("response");
    expect(msg.content).toBe("Here is the answer.");
    expect(msg.sessionId).toBe("s1");
  });

  it("does NOT route response to browsers watching a different session", async () => {
    const hub = makeHub();
    const { bridge } = await setupWatching(hub, "s1");

    const browser2 = browserWs();
    hub.addBrowser(browser2 as any);
    await hub.handleMessage(
      browser2 as any,
      JSON.stringify({ type: "watch-session", sessionId: "s2" }),
    );
    browser2.sent.length = 0;

    await hub.handleMessage(bridge as any, JSON.stringify({ type: "response", content: "Answer" }));

    expect(browser2.sent.length).toBe(0);
  });
});

describe("bridge routing — canvas-push", () => {
  it("routes canvas-push from bridge to browsers watching that session", async () => {
    const hub = makeHub();
    const { bridge, browser } = await setupWatching(hub, "s1");

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "canvas-push",
        image: "base64data==",
      }),
    );

    expect(browser.sent.length).toBe(1);
    const msg = JSON.parse(browser.sent[0]!) as Record<string, unknown>;
    expect(msg.type).toBe("canvas-push");
    expect(msg.image).toBe("base64data==");
    expect(msg.sessionId).toBe("s1");
  });

  it("does NOT route canvas-push to browsers watching a different session", async () => {
    const hub = makeHub();
    const { bridge } = await setupWatching(hub, "s1");

    const browser2 = browserWs();
    hub.addBrowser(browser2 as any);
    await hub.handleMessage(
      browser2 as any,
      JSON.stringify({ type: "watch-session", sessionId: "s2" }),
    );
    browser2.sent.length = 0;

    await hub.handleMessage(bridge as any, JSON.stringify({ type: "canvas-push", image: "data" }));

    expect(browser2.sent.length).toBe(0);
  });
});

describe("bridge routing — transcript-status", () => {
  it("routes transcript-status from bridge to browsers watching that session", async () => {
    const hub = makeHub();
    const { bridge, browser } = await setupWatching(hub, "s1");

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "transcript-status",
        status: "running",
      }),
    );

    expect(browser.sent.length).toBe(1);
    const msg = JSON.parse(browser.sent[0]!) as Record<string, unknown>;
    expect(msg.type).toBe("transcript-status");
    expect(msg.status).toBe("running");
    expect(msg.sessionId).toBe("s1");
  });

  it("does NOT route transcript-status to browsers watching a different session", async () => {
    const hub = makeHub();
    const { bridge } = await setupWatching(hub, "s1");

    const browser2 = browserWs();
    hub.addBrowser(browser2 as any);
    await hub.handleMessage(
      browser2 as any,
      JSON.stringify({ type: "watch-session", sessionId: "s2" }),
    );
    browser2.sent.length = 0;

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "transcript-status", status: "idle" }),
    );

    expect(browser2.sent.length).toBe(0);
  });
});

// -- Multi-browser fan-out --

describe("bridge routing — multi-browser fan-out", () => {
  it("routes to multiple browsers watching the same session", async () => {
    const hub = makeHub();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    const browser1 = browserWs();
    const browser2 = browserWs();
    hub.addBrowser(browser1 as any);
    hub.addBrowser(browser2 as any);
    await hub.handleMessage(
      browser1 as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );
    await hub.handleMessage(
      browser2 as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );
    browser1.sent.length = 0;
    browser2.sent.length = 0;

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "transcript-entry", role: "user", text: "hi" }),
    );

    expect(browser1.sent.length).toBe(1);
    expect(browser2.sent.length).toBe(1);
  });

  it("routes only to watching browsers, not unwatching ones", async () => {
    const hub = makeHub();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    const watching = browserWs();
    const notWatching = browserWs();
    hub.addBrowser(watching as any);
    hub.addBrowser(notWatching as any);
    await hub.handleMessage(
      watching as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );
    // notWatching never sends watch-session
    watching.sent.length = 0;
    notWatching.sent.length = 0;

    await hub.handleMessage(bridge as any, JSON.stringify({ type: "response", content: "result" }));

    expect(watching.sent.length).toBe(1);
    expect(notWatching.sent.length).toBe(0);
  });
});

// -- sessionId injected into forwarded message --

describe("bridge routing — sessionId injection", () => {
  it("adds sessionId to message even when original message omits it", async () => {
    const hub = makeHub();
    const { bridge, browser } = await setupWatching(hub, "my-session");

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "transcript-entry",
        text: "hello",
      }),
    );

    const msg = JSON.parse(browser.sent[0]!) as Record<string, unknown>;
    expect(msg.sessionId).toBe("my-session");
  });

  it("overwrites sessionId if message already has one", async () => {
    const hub = makeHub();
    const { bridge, browser } = await setupWatching(hub, "real-session");

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "transcript-entry",
        text: "hello",
        sessionId: "spoofed-session",
      }),
    );

    const msg = JSON.parse(browser.sent[0]!) as Record<string, unknown>;
    expect(msg.sessionId).toBe("real-session");
  });
});

// -- Bridge with no sessionId (unregistered) --

describe("bridge routing — unregistered bridge", () => {
  it("does not route when bridge has no sessionId", async () => {
    const hub = makeHub();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    // NOTE: no register message — bridge has no sessionId

    const browser = browserWs();
    hub.addBrowser(browser as any);
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );
    browser.sent.length = 0;

    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "transcript-entry", text: "hi" }),
    );

    expect(browser.sent.length).toBe(0);
  });
});

// -- Non-routed message types from bridge --

describe("bridge routing — non-routed types ignored", () => {
  it("does not route unknown bridge message types to browsers", async () => {
    const hub = makeHub();
    const { bridge, browser } = await setupWatching(hub, "s1");

    await hub.handleMessage(bridge as any, JSON.stringify({ type: "custom-event", data: "value" }));

    expect(browser.sent.length).toBe(0);
  });
});

// -- removeBrowser cleans up watch state --

describe("removeBrowser", () => {
  it("cleans up watch-session state when browser disconnects", async () => {
    const hub = makeHub();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );

    const browser = browserWs();
    hub.addBrowser(browser as any);
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );
    hub.removeBrowser(browser as any);
    browser.sent.length = 0;

    // After removal, routing bridge messages should not try to send to removed browser
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "transcript-entry", text: "hi" }),
    );

    expect(browser.sent.length).toBe(0);
  });
});
