/**
 * E2E test: annotation round-trip
 *
 * 1. Start trayce server
 * 2. Connect a mock bridge, register session
 * 3. Connect a mock browser, watch session
 * 4. Browser submits with annotations — bridge receives them
 * 5. Bridge sends annotation-update — browser receives it (sessionId stamped)
 * 6. Bridge sends annotations-push — browser receives it
 * 7. Late-joining browser receives buffered annotation-update
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TEST_PORT = 20100 + Math.floor(Math.random() * 100);
const TMP_DIR = join(tmpdir(), `trayce-e2e-ann-${process.pid}`);
const STATE_FILE = join(TMP_DIR, "state.json");
const SUBMISSIONS_DIR = join(TMP_DIR, "submissions");
const CLIENT_DIR = join(TMP_DIR, "client");
const SERVER_ENTRY = resolve(import.meta.dir, "../../server/index.ts");

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

interface StateJson {
  pid: number;
  port: number;
  host: string;
  token: string | null;
  url: string;
}

let serverProc: ReturnType<typeof Bun.spawn>;
let state: StateJson;

async function waitForState(timeoutMs = 10_000): Promise<StateJson> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(STATE_FILE)) {
      try {
        const s = JSON.parse(readFileSync(STATE_FILE, "utf8")) as StateJson;
        if (s.port > 0) return s;
      } catch {}
    }
    await Bun.sleep(50);
  }
  throw new Error("Server did not start in time");
}

async function waitForHttp(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {}
    await Bun.sleep(50);
  }
  throw new Error("Server not reachable");
}

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WS timeout"));
    }, 5000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("WS error"));
    };
  });
}

function nextMessage(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No message")), timeoutMs);
    ws.addEventListener(
      "message",
      (ev) => {
        clearTimeout(timer);
        resolve(JSON.parse(ev.data as string) as Record<string, unknown>);
      },
      { once: true },
    );
  });
}

/** Drain messages until one with the expected type arrives (or timeout). */
function waitForType(
  ws: WebSocket,
  type: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMsg);
      reject(new Error(`Never saw ${type}`));
    }, timeoutMs);
    function onMsg(ev: MessageEvent) {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeEventListener("message", onMsg);
        resolve(msg);
      }
    }
    ws.addEventListener("message", onMsg);
  });
}

beforeAll(async () => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(CLIENT_DIR, { recursive: true });
  Bun.write(join(CLIENT_DIR, "index.html"), "<html>trayce</html>");

  serverProc = Bun.spawn(["bun", "run", SERVER_ENTRY], {
    cwd: resolve(import.meta.dir, "../.."),
    env: {
      ...process.env,
      TRAYCE_PORT: String(TEST_PORT),
      TRAYCE_HOST: "127.0.0.1",
      TRAYCE_STATE_FILE: STATE_FILE,
      TRAYCE_SUBMISSIONS_DIR: SUBMISSIONS_DIR,
      TRAYCE_CLIENT_DIR: CLIENT_DIR,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  state = await waitForState();
  await waitForHttp(`http://127.0.0.1:${state.port}/`);
}, 30_000);

afterAll(() => {
  try {
    serverProc.kill();
  } catch {}
  rmSync(TMP_DIR, { recursive: true, force: true });
});

const PIN_USER_1 = {
  id: "ann-1",
  kind: "pin",
  author: "user",
  status: "open",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  replies: [],
  number: 1,
  at: [120, 400],
  note: "increase padding",
};

const CALLOUT_CLAUDE = {
  id: "ann-2",
  kind: "callout",
  author: "claude",
  status: "open",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  replies: [],
  text: "is this what you meant?",
  bbox: [200, 100, 120, 30],
  target: [400, 200],
  style: { fontSize: 14, color: "#dc2626" },
};

describe("E2E annotation flow", () => {
  it("submit carries annotations through to bridge", async () => {
    const wsBase = `ws://127.0.0.1:${state.port}`;
    const token = state.token as string;
    const bridge = await connectWs(`${wsBase}/bridge?token=${token}`);
    const sessionId = crypto.randomUUID();
    bridge.send(JSON.stringify({ type: "register", sessionId, label: "e2e-ann" }));
    await Bun.sleep(100);

    const browser = await connectWs(`${wsBase}/canvas?token=${token}`);
    await nextMessage(browser); // server-info
    await nextMessage(browser); // sessions

    browser.send(
      JSON.stringify({
        type: "submit",
        targetSessionId: sessionId,
        image: TINY_PNG_B64,
        prompt: "review",
        annotations: [PIN_USER_1],
      }),
    );

    const submission = await waitForType(bridge, "submission");
    expect(Array.isArray(submission.annotations)).toBe(true);
    expect((submission.annotations as any[]).length).toBe(1);
    expect((submission.annotations as any[])[0].id).toBe("ann-1");
    expect((submission.annotations as any[])[0].kind).toBe("pin");

    bridge.close();
    browser.close();
  }, 15_000);

  it("bridge annotation-update reaches the watching browser with sessionId", async () => {
    const wsBase = `ws://127.0.0.1:${state.port}`;
    const token = state.token as string;
    const bridge = await connectWs(`${wsBase}/bridge?token=${token}`);
    const sessionId = crypto.randomUUID();
    bridge.send(JSON.stringify({ type: "register", sessionId, label: "e2e-upd" }));
    await Bun.sleep(100);

    const browser = await connectWs(`${wsBase}/canvas?token=${token}`);
    await nextMessage(browser); // server-info
    await nextMessage(browser); // sessions
    browser.send(JSON.stringify({ type: "watch-session", sessionId }));
    await Bun.sleep(100);

    bridge.send(
      JSON.stringify({
        type: "annotation-update",
        updates: [{ id: "ann-1", status: "addressed", reply: "done" }],
      }),
    );

    const recv = await waitForType(browser, "annotation-update");
    expect(recv.sessionId).toBe(sessionId);
    expect((recv.updates as any[])[0].id).toBe("ann-1");
    expect((recv.updates as any[])[0].status).toBe("addressed");
    expect((recv.updates as any[])[0].reply).toBe("done");

    bridge.close();
    browser.close();
  }, 15_000);

  it("bridge annotations-push reaches the watching browser with sessionId", async () => {
    const wsBase = `ws://127.0.0.1:${state.port}`;
    const token = state.token as string;
    const bridge = await connectWs(`${wsBase}/bridge?token=${token}`);
    const sessionId = crypto.randomUUID();
    bridge.send(JSON.stringify({ type: "register", sessionId, label: "e2e-push" }));
    await Bun.sleep(100);

    const browser = await connectWs(`${wsBase}/canvas?token=${token}`);
    await nextMessage(browser); // server-info
    await nextMessage(browser); // sessions
    browser.send(JSON.stringify({ type: "watch-session", sessionId }));
    await Bun.sleep(100);

    bridge.send(
      JSON.stringify({
        type: "annotations-push",
        annotations: [CALLOUT_CLAUDE],
      }),
    );

    const recv = await waitForType(browser, "annotations-push");
    expect(recv.sessionId).toBe(sessionId);
    expect((recv.annotations as any[])[0].id).toBe("ann-2");
    expect((recv.annotations as any[])[0].author).toBe("claude");

    bridge.close();
    browser.close();
  }, 15_000);

  it("late-joining browser receives buffered annotation-update", async () => {
    const wsBase = `ws://127.0.0.1:${state.port}`;
    const token = state.token as string;
    const bridge = await connectWs(`${wsBase}/bridge?token=${token}`);
    const sessionId = crypto.randomUUID();
    bridge.send(JSON.stringify({ type: "register", sessionId, label: "e2e-buf" }));
    await Bun.sleep(100);

    // Bridge sends update BEFORE browser is watching
    bridge.send(
      JSON.stringify({
        type: "annotation-update",
        updates: [{ id: "ann-1", status: "addressed" }],
      }),
    );
    await Bun.sleep(200);

    // Now the browser connects and starts watching
    const browser = await connectWs(`${wsBase}/canvas?token=${token}`);
    await nextMessage(browser); // server-info
    await nextMessage(browser); // sessions
    browser.send(JSON.stringify({ type: "watch-session", sessionId }));

    const recv = await waitForType(browser, "annotation-update");
    expect(recv.sessionId).toBe(sessionId);
    expect((recv.updates as any[])[0].status).toBe("addressed");

    bridge.close();
    browser.close();
  }, 15_000);
});
