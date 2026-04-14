/**
 * E2E smoke test: client boot via Playwright
 *
 * Boots the trayce server against the real dist/client bundle, loads the
 * canvas in headless Chromium, and asserts:
 *   1. No console errors or page errors occurred during load
 *   2. window.__trayceReady === true was set by the app bootstrap
 *
 * Catches regressions that static analysis misses: CSP blocks on inline
 * scripts, bundler tree-shake drops, missing assets (fonts, workers), and
 * WebSocket connection setup failures.
 *
 * Windows note: On no-GPU Windows hosts (local Windows Server, GitHub's
 * windows-latest), Playwright's standard chromium.launch() hangs waiting
 * on the remote-debugging pipe. Workaround: spawn Chrome with
 * --remote-debugging-port directly and connect via Playwright's private
 * chromium._connectOverCDPTransport() using Bun's native WebSocket (the
 * bundled ws npm package also fails the upgrade on Bun/Windows). Tracked
 * via GitHub issue #12.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium } from "playwright";

const IS_WINDOWS = process.platform === "win32";

const TEST_PORT = 18900 + Math.floor(Math.random() * 100);
const CDP_PORT = 19300 + Math.floor(Math.random() * 100);
const TMP_DIR = join(tmpdir(), `trayce-e2e-${process.pid}-boot`);
const STATE_FILE = join(TMP_DIR, "state.json");
const SUBMISSIONS_DIR = join(TMP_DIR, "submissions");
const CLIENT_DIR = resolve(import.meta.dir, "../../dist/client");
const SERVER_ENTRY = resolve(import.meta.dir, "../../server/index.ts");
const TEST_TOKEN = "test-token-client-boot";
const USER_DATA_DIR = join(tmpdir(), `trayce-chrome-${process.pid}`);

interface StateJson {
  pid: number;
  port: number;
  host: string;
  token: string | null;
  url: string;
}

let serverProc: ReturnType<typeof Bun.spawn>;
let chromeProc: ChildProcess | null = null;
let browser: Browser | null = null;

async function waitForState(timeoutMs = 15_000): Promise<StateJson> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(STATE_FILE)) {
      try {
        const raw = readFileSync(STATE_FILE, "utf8");
        const s = JSON.parse(raw) as StateJson;
        if (s.port > 0) return s;
      } catch {
        // file still being written — retry
      }
    }
    await Bun.sleep(50);
  }
  throw new Error("Server did not write state.json in time");
}

async function waitForHttp(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      // not ready yet
    }
    await Bun.sleep(50);
  }
  throw new Error(`Server not reachable at ${url}`);
}

async function spawnChrome(cdpPort: number): Promise<ChildProcess> {
  const executablePath = (chromium as unknown as { executablePath: () => string }).executablePath();
  const proc = spawn(
    executablePath,
    [
      "--no-sandbox",
      "--headless",
      "--disable-gpu",
      `--remote-debugging-port=${cdpPort}`,
      "--no-first-run",
      "--no-startup-window",
      "--disable-extensions",
      "--disable-component-extensions-with-background-pages",
      `--user-data-dir=${USER_DATA_DIR}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (resp.ok) return proc;
    } catch {
      // not ready yet
    }
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error(`Chrome CDP not ready on port ${cdpPort}`);
}

// Playwright's bundled `ws` package fails the WebSocket upgrade on Bun, so
// connectOverCDP() is unusable here. The private _connectOverCDPTransport()
// accepts any transport matching { onmessage, onclose, send, close } — we hand
// it one backed by Bun's native WebSocket.
async function connectOverBunCDP(cdpPort: number): Promise<Browser> {
  const versionResp = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
  const versionData = (await versionResp.json()) as { webSocketDebuggerUrl?: string };
  if (!versionData.webSocketDebuggerUrl) throw new Error("No webSocketDebuggerUrl from Chrome CDP");

  const ws = new WebSocket(versionData.webSocketDebuggerUrl);
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error("WebSocket failed to connect to Chrome CDP"));
  });

  const transport = {
    onmessage: null as ((msg: unknown) => void) | null,
    onclose: null as ((reason: string) => void) | null,
    send(msg: unknown) {
      ws.send(JSON.stringify(msg));
    },
    close() {
      ws.close();
    },
  };
  ws.onmessage = (ev) => {
    transport.onmessage?.(JSON.parse(ev.data as string));
  };
  ws.onclose = () => {
    transport.onclose?.("closed");
  };

  const pw = chromium as unknown as {
    _connectOverCDPTransport: (t: typeof transport) => Promise<Browser>;
  };
  return pw._connectOverCDPTransport(transport);
}

beforeAll(async () => {
  if (!existsSync(join(CLIENT_DIR, "app.js"))) {
    const build = Bun.spawnSync(["bun", "run", "build:client"], {
      cwd: resolve(import.meta.dir, "../.."),
      stdout: "inherit",
      stderr: "inherit",
    });
    if (build.exitCode !== 0) {
      throw new Error(`build:client failed with exit code ${build.exitCode}`);
    }
  }

  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(SUBMISSIONS_DIR, { recursive: true });

  serverProc = Bun.spawn(["bun", "run", SERVER_ENTRY], {
    cwd: resolve(import.meta.dir, "../.."),
    env: {
      ...process.env,
      TRAYCE_PORT: String(TEST_PORT),
      TRAYCE_HOST: "127.0.0.1",
      TRAYCE_STATE_FILE: STATE_FILE,
      TRAYCE_SUBMISSIONS_DIR: SUBMISSIONS_DIR,
      TRAYCE_CLIENT_DIR: CLIENT_DIR,
      TRAYCE_TOKEN: TEST_TOKEN,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForState();
  await waitForHttp(`http://127.0.0.1:${TEST_PORT}/`);

  if (IS_WINDOWS) {
    chromeProc = await spawnChrome(CDP_PORT);
    browser = await connectOverBunCDP(CDP_PORT);
  } else {
    browser = await chromium.launch({ headless: true });
  }
}, 60_000);

afterAll(async () => {
  try {
    await browser?.close();
  } catch {}
  try {
    chromeProc?.kill();
  } catch {}
  try {
    serverProc?.kill();
  } catch {}
  // Windows needs a moment to release file handles before the user-data-dir
  // and tmp dir can be removed.
  await Bun.sleep(IS_WINDOWS ? 500 : 200);
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {}
  if (IS_WINDOWS) {
    try {
      rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch {}
  }
});

describe("Client boot smoke test", () => {
  it("loads canvas with zero console errors and sets window.__trayceReady", async () => {
    if (!browser) throw new Error("browser not initialized");

    const errors: string[] = [];
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[console.error] ${msg.text()}`);
    });

    page.on("pageerror", (err) => {
      errors.push(`[pageerror] ${err.message}`);
    });

    try {
      await page.goto(`http://127.0.0.1:${TEST_PORT}/?token=${TEST_TOKEN}`, {
        waitUntil: "domcontentloaded",
      });

      await page.waitForFunction(
        () => (window as unknown as { __trayceReady?: boolean }).__trayceReady === true,
        { timeout: 5_000 },
      );

      expect(errors, `Expected zero browser errors but got:\n${errors.join("\n")}`).toHaveLength(0);

      const ready = await page.evaluate(
        () => (window as unknown as { __trayceReady?: boolean }).__trayceReady,
      );
      expect(ready).toBe(true);
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }, 30_000);
});
