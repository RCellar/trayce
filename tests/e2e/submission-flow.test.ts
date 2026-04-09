/**
 * E2E test: full submission flow
 *
 * 1. Start trayce server
 * 2. Connect a mock bridge via WebSocket (register session)
 * 3. Connect a mock browser via WebSocket
 * 4. Browser sends submit message with base64 PNG
 * 5. Verify bridge receives submission with correct pngPath
 * 6. Verify PNG file exists on disk
 * 7. Verify browser receives ack
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const TEST_PORT = 19900 + Math.floor(Math.random() * 100);
const TMP_DIR = `/tmp/trayce-e2e-${process.pid}`;
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
        const raw = readFileSync(STATE_FILE, "utf8");
        const s = JSON.parse(raw) as StateJson;
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
    serverProc.kill("SIGTERM");
  } catch {}
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("E2E submission flow", () => {
  it("browser submits → bridge receives → PNG on disk → browser gets ack", async () => {
    const wsBase = `ws://127.0.0.1:${state.port}`;
    const token = state.token as string;

    // 1. Connect bridge and register
    const bridge = await connectWs(`${wsBase}/bridge?token=${token}`);
    const sessionId = crypto.randomUUID();
    bridge.send(JSON.stringify({ type: "register", sessionId, label: "e2e-test" }));

    // Small delay for registration to propagate
    await Bun.sleep(100);

    // 2. Connect browser
    const browser = await connectWs(`${wsBase}/canvas?token=${token}`);
    const sessionsMsg = await nextMessage(browser);
    expect(sessionsMsg.type).toBe("sessions");
    expect((sessionsMsg.sessions as any[]).some((s: any) => s.id === sessionId)).toBe(true);

    // 3. Browser submits
    browser.send(
      JSON.stringify({
        type: "submit",
        targetSessionId: sessionId,
        image: TINY_PNG_B64,
        prompt: "implement this layout",
      }),
    );

    // 4. Bridge receives submission
    const submission = await nextMessage(bridge);
    expect(submission.type).toBe("submission");
    expect(typeof submission.id).toBe("string");
    expect(typeof submission.pngPath).toBe("string");
    expect(submission.prompt).toBe("implement this layout");

    // 5. PNG exists on disk
    expect(existsSync(submission.pngPath as string)).toBe(true);
    const pngBytes = readFileSync(submission.pngPath as string);
    expect(pngBytes.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(pngBytes[0]).toBe(0x89);
    expect(pngBytes[1]).toBe(0x50); // P
    expect(pngBytes[2]).toBe(0x4e); // N
    expect(pngBytes[3]).toBe(0x47); // G

    // 6. Browser receives ack
    const ack = await nextMessage(browser);
    expect(ack.type).toBe("ack");
    expect(ack.submissionId).toBe(submission.id);
    expect(typeof ack.timestamp).toBe("number");

    bridge.close();
    browser.close();
  }, 15_000);

  it("submit to disconnected bridge still acks browser", async () => {
    const wsBase = `ws://127.0.0.1:${state.port}`;
    const token = state.token as string;

    // Register and disconnect a bridge
    const bridge = await connectWs(`${wsBase}/bridge?token=${token}`);
    const sessionId = crypto.randomUUID();
    bridge.send(JSON.stringify({ type: "register", sessionId, label: "ephemeral" }));
    await Bun.sleep(100);
    bridge.close();
    await Bun.sleep(100);

    // Browser submits to the now-disconnected session
    const browser = await connectWs(`${wsBase}/canvas?token=${token}`);
    await nextMessage(browser); // consume sessions

    browser.send(
      JSON.stringify({
        type: "submit",
        targetSessionId: sessionId,
        image: TINY_PNG_B64,
        prompt: "to nobody",
      }),
    );

    // Browser should still get an ack (PNG saved on disk)
    const response = await nextMessage(browser);
    expect(response.type).toBe("ack");

    browser.close();
  }, 15_000);
});
