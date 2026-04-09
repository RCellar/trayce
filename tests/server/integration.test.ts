import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const TEST_PORT = 19740 + Math.floor(Math.random() * 1000);
const TMP_DIR = `/tmp/trayce-integration-${process.pid}`;
const STATE_FILE = join(TMP_DIR, "state.json");
const SUBMISSIONS_DIR = join(TMP_DIR, "submissions");
const CLIENT_DIR = join(TMP_DIR, "client");
const SERVER_ENTRY = resolve(import.meta.dir, "../../server/index.ts");

interface StateJson {
  pid: number;
  port: number;
  host: string;
  token: string | null;
  url: string;
}

async function waitForState(path: string, timeoutMs = 10_000): Promise<StateJson> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf8");
        const state = JSON.parse(raw) as StateJson;
        if (state.port > 0) return state;
      } catch {}
    }
    await Bun.sleep(50);
  }
  throw new Error(`State file not ready at ${path} within ${timeoutMs}ms`);
}

async function waitForHttp(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      await res.body?.cancel();
      return;
    } catch {}
    await Bun.sleep(50);
  }
  throw new Error(`Server not reachable at ${url} within ${timeoutMs}ms`);
}

function connectWs(url: string): Promise<{ ws: WebSocket; firstMessage: unknown }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`WS timeout: ${url}`));
    }, 5000);
    ws.onmessage = (ev) => {
      clearTimeout(timer);
      resolve({ ws, firstMessage: JSON.parse(ev.data as string) });
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`WS error: ${url}`));
    };
  });
}

function nextMessage(ws: WebSocket, timeoutMs = 3000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No WS message")), timeoutMs);
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

// -- Main test suite (auth enabled) --

let serverProc: ReturnType<typeof Bun.spawn>;
let state: StateJson;
let baseUrl: string;

beforeAll(async () => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(CLIENT_DIR, { recursive: true });
  Bun.write(join(CLIENT_DIR, "index.html"), "<html><body>trayce</body></html>");

  serverProc = Bun.spawn(["bun", "run", SERVER_ENTRY], {
    cwd: "trayce",
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

  state = await waitForState(STATE_FILE);
  baseUrl = `http://127.0.0.1:${state.port}`;
  await waitForHttp(baseUrl);
}, 30_000);

afterAll(() => {
  try {
    serverProc.kill("SIGTERM");
  } catch {}
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("state file", () => {
  it("contains pid, port, host, token, url", () => {
    expect(state.pid).toBeGreaterThan(0);
    expect(state.port).toBe(TEST_PORT);
    expect(state.host).toBe("127.0.0.1");
    expect(typeof state.token).toBe("string");
    expect((state.token as string).length).toBeGreaterThan(0);
    expect(state.url).toContain(`token=${state.token}`);
  });
});

describe("HTTP", () => {
  it("GET / serves index.html", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("trayce");
  });

  it("GET /missing returns 404", async () => {
    const res = await fetch(`${baseUrl}/missing.html`);
    expect(res.status).toBe(404);
    await res.body?.cancel();
  });

  it("security headers present", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    await res.body?.cancel();
  });
});

describe("WebSocket /canvas — with token", () => {
  it("connects and receives sessions message", async () => {
    const { ws, firstMessage } = await connectWs(
      `ws://127.0.0.1:${state.port}/canvas?token=${state.token}`,
    );
    expect((firstMessage as any).type).toBe("sessions");
    ws.close();
  });

  it("heartbeat is echoed", async () => {
    const { ws } = await connectWs(`ws://127.0.0.1:${state.port}/canvas?token=${state.token}`);
    ws.send(JSON.stringify({ type: "heartbeat" }));
    const echo = await nextMessage(ws);
    expect(echo.type).toBe("heartbeat");
    ws.close();
  });
});

describe("WebSocket /canvas — auth rejection", () => {
  it("rejects without token (401)", async () => {
    const res = await fetch(`${baseUrl}/canvas`, {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  it("rejects with wrong token", async () => {
    const res = await fetch(`${baseUrl}/canvas?token=wrong`, {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });
});

describe("WebSocket /bridge", () => {
  it("connects with valid token", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${state.port}/bridge?token=${state.token}`);
    const opened = await new Promise<boolean>((res) => {
      ws.onopen = () => res(true);
      ws.onerror = () => res(false);
      setTimeout(() => res(false), 5000);
    });
    expect(opened).toBe(true);
    ws.close();
  });

  it("register broadcasts to browsers", async () => {
    const sessionId = crypto.randomUUID();

    // Connect bridge and register
    const bridge = new WebSocket(`ws://127.0.0.1:${state.port}/bridge?token=${state.token}`);
    await new Promise<void>((res, rej) => {
      bridge.onopen = () => res();
      bridge.onerror = () => rej(new Error("bridge failed"));
      setTimeout(() => rej(new Error("timeout")), 5000);
    });

    // Connect browser
    const { ws: browser } = await connectWs(
      `ws://127.0.0.1:${state.port}/canvas?token=${state.token}`,
    );

    // Listen for session update on browser
    const update = new Promise<any>((res, rej) => {
      const timer = setTimeout(() => rej(new Error("no update")), 5000);
      browser.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === "sessions" && msg.sessions.some((s: any) => s.id === sessionId)) {
          clearTimeout(timer);
          res(msg);
        }
      };
    });

    bridge.send(JSON.stringify({ type: "register", sessionId, label: "test-app" }));
    const result = await update;
    expect(result.sessions.some((s: any) => s.id === sessionId)).toBe(true);

    browser.close();
    bridge.close();
  });

  it("rejects without token", async () => {
    const res = await fetch(`${baseUrl}/bridge`, {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });
});
