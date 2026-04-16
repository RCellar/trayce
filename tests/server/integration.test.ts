import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TEST_PORT = 19740 + Math.floor(Math.random() * 1000);
const TMP_DIR = join(tmpdir(), `trayce-integration-${process.pid}`);
const STATE_FILE = join(TMP_DIR, "state.json");
const SUBMISSIONS_DIR = join(TMP_DIR, "submissions");
const CLIENT_DIR = join(TMP_DIR, "client");
const SERVER_ENTRY = resolve(import.meta.dir, "../../server/index.ts");
const PROJECT_ROOT = resolve(import.meta.dir, "../..");

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

function connectWs(
  url: string,
  timeoutMs = 10_000,
): Promise<{ ws: WebSocket; firstMessage: unknown }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`WS timeout: ${url}`));
    }, timeoutMs);
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

/** Retry WebSocket connection until server-info AND sessions are received. */
async function waitForWs(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { ws, firstMessage } = await connectWs(url, 5000);
      if ((firstMessage as any).type === "server-info") {
        // Also wait for the sessions broadcast to confirm full readiness
        const msg = await new Promise<any>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("timeout")), 5000);
          ws.addEventListener(
            "message",
            (ev) => {
              clearTimeout(timer);
              resolve(JSON.parse(ev.data as string));
            },
            { once: true },
          );
        });
        ws.close();
        if (msg.type === "sessions") return;
      } else {
        ws.close();
      }
    } catch {
      /* retry */
    }
    await Bun.sleep(200);
  }
  throw new Error(`WebSocket not ready at ${url} within ${timeoutMs}ms`);
}

function nextMessage(ws: WebSocket, timeoutMs = 15_000): Promise<Record<string, unknown>> {
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

// Bun's test runner kills spawned subprocesses ("dangling process") mid-suite on
// CI, even with detached node:child_process. These tests pass 100% locally on
// Unix. On Windows, `node:child_process` + `detached: true` spawning the bun
// binary doesn't reliably produce a listening server inside the test harness
// (the server itself works — see scripts/start.ts — only this in-process test
// spawn flow is fragile). Skip in CI and on Windows; the e2e submission-flow
// test exercises the same code paths via Bun.spawn and runs on all platforms.
const isCI = process.env.CI === "true";
const isWindows = process.platform === "win32";
const suite = isCI || isWindows ? describe.skip : describe;

suite("integration", () => {
  let serverProc: ChildProcess;
  let state: StateJson;
  let baseUrl: string;

  beforeAll(async () => {
    rmSync(TMP_DIR, { recursive: true, force: true });
    mkdirSync(CLIENT_DIR, { recursive: true });
    Bun.write(join(CLIENT_DIR, "index.html"), "<html><body>trayce</body></html>");

    // Use node:child_process with detached: true to prevent Bun's test runner
    // from killing the server as a "dangling process" mid-suite.
    serverProc = nodeSpawn(process.execPath, ["run", SERVER_ENTRY], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        TRAYCE_PORT: String(TEST_PORT),
        TRAYCE_HOST: "127.0.0.1",
        TRAYCE_STATE_FILE: STATE_FILE,
        TRAYCE_SUBMISSIONS_DIR: SUBMISSIONS_DIR,
        TRAYCE_CLIENT_DIR: CLIENT_DIR,
      },
      stdio: "ignore",
      detached: true,
    });
    serverProc.unref();

    state = await waitForState(STATE_FILE);
    baseUrl = `http://127.0.0.1:${state.port}`;
    await waitForHttp(baseUrl);
    // Confirm WebSocket is accepting connections before tests start
    await waitForWs(`ws://127.0.0.1:${state.port}/canvas?token=${state.token}`);
  }, 30_000);

  afterAll(() => {
    try {
      // Kill the detached process group (negative PID)
      if (serverProc.pid) {
        // Process-group kill (negative PID) is Unix-only; on Windows
        // we kill the PID directly. Bun's child_process will still clean up.
        if (process.platform === "win32") {
          process.kill(serverProc.pid);
        } else {
          process.kill(-serverProc.pid, "SIGTERM");
        }
      }
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
      expect((firstMessage as any).type).toBe("server-info");
      const sessionsMsg = await nextMessage(ws);
      expect(sessionsMsg.type).toBe("sessions");
      ws.close();
    }, 15_000);

    it("heartbeat is echoed", async () => {
      const { ws, firstMessage } = await connectWs(
        `ws://127.0.0.1:${state.port}/canvas?token=${state.token}`,
      );
      expect((firstMessage as any).type).toBe("server-info");
      const sessionsMsg = await nextMessage(ws);
      expect(sessionsMsg.type).toBe("sessions");
      ws.send(JSON.stringify({ type: "heartbeat" }));
      const echo = await nextMessage(ws);
      expect(echo.type).toBe("heartbeat");
      ws.close();
    }, 15_000);
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
        setTimeout(() => res(false), 10_000);
      });
      expect(opened).toBe(true);
      ws.close();
    }, 15_000);

    it("register broadcasts to browsers", async () => {
      const sessionId = crypto.randomUUID();

      // Connect bridge and register
      const bridge = new WebSocket(`ws://127.0.0.1:${state.port}/bridge?token=${state.token}`);
      await new Promise<void>((res, rej) => {
        bridge.onopen = () => res();
        bridge.onerror = () => rej(new Error("bridge failed"));
        setTimeout(() => rej(new Error("timeout")), 10_000);
      });

      // Connect browser
      const { ws: browser } = await connectWs(
        `ws://127.0.0.1:${state.port}/canvas?token=${state.token}`,
      );

      // Listen for session update on browser
      const update = new Promise<any>((res, rej) => {
        const timer = setTimeout(() => rej(new Error("no update")), 10_000);
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
    }, 15_000);

    it("rejects without token", async () => {
      const res = await fetch(`${baseUrl}/bridge`, {
        headers: { Upgrade: "websocket" },
      });
      expect(res.status).toBe(401);
      await res.body?.cancel();
    });
  });

  describe("Hook ingress — SessionStart delivers session-context to bridge", () => {
    it("bridge receives session-context after SessionStart POST", async () => {
      const sessionId = crypto.randomUUID();

      // Connect bridge WebSocket
      const bridge = new WebSocket(`ws://127.0.0.1:${state.port}/bridge?token=${state.token}`);
      await new Promise<void>((res, rej) => {
        bridge.onopen = () => res();
        bridge.onerror = () => rej(new Error("bridge connect failed"));
        setTimeout(() => rej(new Error("bridge connect timeout")), 10_000);
      });

      // Collect incoming bridge messages
      const bridgeMessages: any[] = [];
      bridge.addEventListener("message", (ev) => {
        bridgeMessages.push(JSON.parse(ev.data as string));
      });

      // Register the bridge
      bridge.send(JSON.stringify({ type: "register", sessionId, label: "hook-test" }));

      // POST SessionStart hook payload with Bearer auth
      const hookRes = await fetch(`${baseUrl}/hook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.token}`,
        },
        body: JSON.stringify({
          session_id: sessionId,
          hook_event_name: "SessionStart",
          transcript_path: "/tmp/test-transcript.jsonl",
          cwd: "/home/user/project",
        }),
      });
      expect(hookRes.status).toBe(200);
      await hookRes.body?.cancel();

      // Allow the server to process and deliver the WebSocket message
      await new Promise((r) => setTimeout(r, 50));

      const sessionContextMsg = bridgeMessages.find((m) => m.type === "session-context");
      expect(sessionContextMsg).toBeDefined();
      expect(sessionContextMsg.sessionId).toBe(sessionId);
      expect(sessionContextMsg.transcriptPath).toBe("/tmp/test-transcript.jsonl");

      bridge.close();
    }, 15_000);
  });

  describe("Hook ingress — PostToolUse broadcasts transcript-entry to browser", () => {
    it("browser receives transcript-entry after PostToolUse POST", async () => {
      const sessionId = crypto.randomUUID();

      // Connect bridge
      const bridge = new WebSocket(`ws://127.0.0.1:${state.port}/bridge?token=${state.token}`);
      await new Promise<void>((res, rej) => {
        bridge.onopen = () => res();
        bridge.onerror = () => rej(new Error("bridge connect failed"));
        setTimeout(() => rej(new Error("bridge connect timeout")), 10_000);
      });

      // Connect browser and consume initial server-info + sessions messages
      const { ws: browser, firstMessage: serverInfo } = await connectWs(
        `ws://127.0.0.1:${state.port}/canvas?token=${state.token}`,
      );
      expect((serverInfo as any).type).toBe("server-info");
      const sessionsMsg = await nextMessage(browser);
      expect(sessionsMsg.type).toBe("sessions");

      // Register bridge and wait for the resulting sessions broadcast to browser
      const sessionsBroadcast = new Promise<void>((res, rej) => {
        const timer = setTimeout(() => rej(new Error("no sessions broadcast")), 10_000);
        browser.addEventListener("message", function handler(ev) {
          const msg = JSON.parse(ev.data as string);
          if (msg.type === "sessions" && msg.sessions.some((s: any) => s.id === sessionId)) {
            clearTimeout(timer);
            browser.removeEventListener("message", handler);
            res();
          }
        });
      });
      bridge.send(JSON.stringify({ type: "register", sessionId, label: "hook-broadcast-test" }));
      await sessionsBroadcast;

      // Browser watches the session so broadcastToSession routes to it
      browser.send(JSON.stringify({ type: "watch-session", sessionId }));

      // Collect incoming browser messages after watch-session
      const browserMessages: any[] = [];
      browser.addEventListener("message", (ev) => {
        browserMessages.push(JSON.parse(ev.data as string));
      });

      // Small delay so the watch-session is processed server-side
      await new Promise((r) => setTimeout(r, 50));

      // POST PostToolUse hook payload
      const hookRes = await fetch(`${baseUrl}/hook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.token}`,
        },
        body: JSON.stringify({
          session_id: sessionId,
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "ls -la" },
          tool_output: { stdout: "file.txt" },
        }),
      });
      expect(hookRes.status).toBe(200);
      await hookRes.body?.cancel();

      // Allow the server to process and deliver the WebSocket message
      await new Promise((r) => setTimeout(r, 50));

      const transcriptMsg = browserMessages.find((m) => m.type === "transcript-entry");
      expect(transcriptMsg).toBeDefined();
      expect(transcriptMsg.entry.toolName).toBe("Bash");

      browser.close();
      bridge.close();
    }, 15_000);
  });

  describe("OTEL ingress — metrics broadcast usage-update to browser", () => {
    it("browser receives usage-update after OTLP metrics POST", async () => {
      const sessionId = crypto.randomUUID();

      // Connect bridge
      const bridge = new WebSocket(`ws://127.0.0.1:${state.port}/bridge?token=${state.token}`);
      await new Promise<void>((res, rej) => {
        bridge.onopen = () => res();
        bridge.onerror = () => rej(new Error("bridge connect failed"));
        setTimeout(() => rej(new Error("bridge connect timeout")), 10_000);
      });

      // Connect browser and consume initial server-info + sessions messages
      const { ws: browser, firstMessage: serverInfo } = await connectWs(
        `ws://127.0.0.1:${state.port}/canvas?token=${state.token}`,
      );
      expect((serverInfo as any).type).toBe("server-info");
      const sessionsMsg = await nextMessage(browser);
      expect(sessionsMsg.type).toBe("sessions");

      // Register bridge (exactly one session so OTEL single-session resolution works)
      // and wait for the resulting sessions broadcast to browser
      const sessionsBroadcast = new Promise<void>((res, rej) => {
        const timer = setTimeout(() => rej(new Error("no sessions broadcast")), 10_000);
        browser.addEventListener("message", function handler(ev) {
          const msg = JSON.parse(ev.data as string);
          if (msg.type === "sessions" && msg.sessions.some((s: any) => s.id === sessionId)) {
            clearTimeout(timer);
            browser.removeEventListener("message", handler);
            res();
          }
        });
      });
      bridge.send(JSON.stringify({ type: "register", sessionId, label: "otel-test" }));
      await sessionsBroadcast;

      // Browser watches the session so broadcastUsage routes to it
      browser.send(JSON.stringify({ type: "watch-session", sessionId }));

      // Collect incoming browser messages after watch-session
      const browserMessages: any[] = [];
      browser.addEventListener("message", (ev) => {
        browserMessages.push(JSON.parse(ev.data as string));
      });

      // Small delay so the watch-session is processed server-side
      await new Promise((r) => setTimeout(r, 50));

      // POST OTLP metrics payload — no auth required
      const otlpRes = await fetch(`${baseUrl}/otlp/v1/metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceMetrics: [
            {
              resource: {
                attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }],
              },
              scopeMetrics: [
                {
                  metrics: [
                    {
                      name: "claude_code.token.usage",
                      sum: {
                        dataPoints: [
                          {
                            asInt: "1000",
                            attributes: [
                              { key: "type", value: { stringValue: "input" } },
                              { key: "model", value: { stringValue: "claude-sonnet-4-6" } },
                            ],
                          },
                          {
                            asInt: "500",
                            attributes: [
                              { key: "type", value: { stringValue: "output" } },
                              { key: "model", value: { stringValue: "claude-sonnet-4-6" } },
                            ],
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      });
      expect(otlpRes.status).toBe(200);
      await otlpRes.body?.cancel();

      // Allow the server to process and deliver the WebSocket message
      await new Promise((r) => setTimeout(r, 50));

      const usageUpdateMsg = browserMessages.find((m) => m.type === "usage-update");
      expect(usageUpdateMsg).toBeDefined();
      expect(usageUpdateMsg.usage.inputTokens).toBe(1000);

      browser.close();
      bridge.close();
    }, 15_000);
  });
}); // end integration
