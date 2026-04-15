import { beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { getConfig } from "../../server/config";
import { SessionRegistry } from "../../server/sessions";
import { SubmissionStore } from "../../server/submissions";
import { WebSocketHub, type WsData } from "../../server/websocket";
import { testDir } from "../helpers/paths";

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
    send(d: string) {
      this.sent.push(d);
    },
    close() {
      this.closed = true;
    },
  } as MockWs;
}

function browserWs(): MockWs {
  return makeMockWs({ kind: "browser", id: crypto.randomUUID() });
}

function bridgeWs(): MockWs {
  return makeMockWs({ kind: "bridge", id: crypto.randomUUID() });
}

const TEST_DIR = testDir("annotation-buffer");
const BASE_CONFIG = getConfig({});

function makeHub(): WebSocketHub {
  const registry = new SessionRegistry();
  const store = new SubmissionStore(TEST_DIR, 20 * 1024 * 1024);
  return new WebSocketHub(registry, store, BASE_CONFIG, () => {});
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("annotation message buffering for late-joining browsers", () => {
  test("annotation-update is replayed on watch-session", async () => {
    const hub = makeHub();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s1", label: "app" }),
    );
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "annotation-update",
        updates: [{ id: "a1", status: "addressed", reply: "done" }],
      }),
    );

    const browser = browserWs();
    hub.addBrowser(browser as any);
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s1" }),
    );

    const frames = browser.sent.map((s) => JSON.parse(s));
    const replayed = frames.find((f: any) => f.type === "annotation-update");
    expect(replayed).toBeTruthy();
    expect(replayed.sessionId).toBe("s1");
    expect(replayed.updates[0].id).toBe("a1");
    expect(replayed.updates[0].reply).toBe("done");
  });

  test("annotations-push is replayed on watch-session", async () => {
    const hub = makeHub();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({ type: "register", sessionId: "s2", label: "app" }),
    );
    await hub.handleMessage(
      bridge as any,
      JSON.stringify({
        type: "annotations-push",
        annotations: [
          {
            id: "p1",
            kind: "pin",
            author: "claude",
            status: "open",
            createdAt: 1,
            updatedAt: 1,
            replies: [],
            number: 1,
            at: [10, 20],
          },
        ],
      }),
    );

    const browser = browserWs();
    hub.addBrowser(browser as any);
    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "watch-session", sessionId: "s2" }),
    );

    const frames = browser.sent.map((s) => JSON.parse(s));
    const replayed = frames.find((f: any) => f.type === "annotations-push");
    expect(replayed).toBeTruthy();
    expect(replayed.sessionId).toBe("s2");
    expect(replayed.annotations[0].id).toBe("p1");
  });
});
