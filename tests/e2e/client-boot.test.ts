/**
 * E2E smoke test: client boot via Playwright
 *
 * Boots the trayce server against the real dist/client bundle, loads the
 * canvas in headless Chromium, and asserts:
 *   1. No console errors or page errors occurred during load
 *   2. window.__trayceReady === true was set by the app bootstrap
 *
 * This catches regressions that static analysis misses: CSP blocks on inline
 * scripts, minifier identifier mangling, missing assets (fonts, workers), and
 * WebSocket connection setup failures.
 *
 * Implementation note: On Windows Server (no GPU), Playwright's standard
 * chromium.launch() and connectOverCDP() are unavailable due to:
 *   - launch(): GPU subprocess crashes before the remote-debugging-pipe responds
 *   - connectOverCDP(): the bundled ws npm package fails the WS upgrade on Bun
 * We work around both by spawning Chrome with --remote-debugging-port and
 * connecting via chromium._connectOverCDPTransport() with Bun's native WebSocket.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const TEST_PORT = 18900 + Math.floor(Math.random() * 100);
// CDP port must not collide with the trayce server port; use a separate range
const CDP_PORT = 19300 + Math.floor(Math.random() * 100);
const TMP_DIR = join(tmpdir(), `trayce-e2e-${process.pid}-boot`);
const STATE_FILE = join(TMP_DIR, "state.json");
const SUBMISSIONS_DIR = join(TMP_DIR, "submissions");
const CLIENT_DIR = resolve(import.meta.dir, "../../dist/client");
const SERVER_ENTRY = resolve(import.meta.dir, "../../server/index.ts");
const TEST_TOKEN = "test-token-client-boot";

// Unique user-data-dir per run so there's no state bleed between runs
const USER_DATA_DIR = join(tmpdir(), `trayce-chrome-${process.pid}`);

interface StateJson {
  pid: number;
  port: number;
  host: string;
  token: string | null;
  url: string;
}

let serverProc: ReturnType<typeof Bun.spawn>;
let chromeProc: ReturnType<typeof spawn> | null = null;
let browser: Awaited<ReturnType<typeof connectBrowser>> | null = null;

// ---------------------------------------------------------------------------
// Helpers copied from tests/e2e/submission-flow.test.ts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Browser helpers (Playwright via CDP + Bun WebSocket transport)
// ---------------------------------------------------------------------------

/** Spawn Chrome with a remote-debugging port and wait until it's ready. */
async function spawnChrome(cdpPort: number): Promise<ReturnType<typeof spawn>> {
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

  // Wait until /json/version is reachable
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (resp.ok) return proc;
    } catch {
      // not ready
    }
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error(`Chrome CDP not ready on port ${cdpPort}`);
}

/**
 * Connect Playwright to the Chrome process via CDP using Bun's native
 * WebSocket as the underlying transport (the bundled ws npm package doesn't
 * work on Bun/Windows; the private _connectOverCDPTransport API accepts any
 * object that matches the Playwright transport interface).
 */
async function connectBrowser(cdpPort: number) {
  const versionResp = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
  const versionData = (await versionResp.json()) as { webSocketDebuggerUrl?: string };
  if (!versionData.webSocketDebuggerUrl) throw new Error("No webSocketDebuggerUrl");

  const ws = new WebSocket(versionData.webSocketDebuggerUrl);

  let resolveOpen!: () => void;
  let rejectOpen!: (e: Error) => void;
  const openP = new Promise<void>((res, rej) => {
    resolveOpen = res;
    rejectOpen = rej;
  });
  ws.onopen = () => resolveOpen();
  ws.onerror = () => rejectOpen(new Error("WebSocket failed to connect to Chrome CDP"));
  await openP;

  // Playwright's transport interface: { onmessage, onclose, send, close }
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
    if (transport.onmessage) transport.onmessage(JSON.parse(ev.data as string));
  };
  ws.onclose = () => {
    if (transport.onclose) transport.onclose("closed");
  };

  // Private Playwright API: accepts a raw transport object and returns a Browser
  const b = await (
    chromium as unknown as {
      _connectOverCDPTransport: (t: typeof transport) => Promise<{
        newContext: () => Promise<{ newPage: () => Promise<unknown> }>;
        close: () => Promise<void>;
      }>;
    }
  )._connectOverCDPTransport(transport);

  return b;
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

const SKIP = process.platform !== "win32";

beforeAll(async () => {
  if (SKIP) return;
  // Ensure dist/client bundle is present; rebuild if missing.
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

  chromeProc = await spawnChrome(CDP_PORT);
  browser = await connectBrowser(CDP_PORT);
}, 60_000);

afterAll(async () => {
  if (SKIP) return;
  try {
    await browser?.close();
  } catch {}
  try {
    chromeProc?.kill();
  } catch {}
  try {
    serverProc?.kill();
  } catch {}
  // Give the OS a moment to release file handles after killing Chrome.
  // On Windows, Chrome's user-data-dir is locked until the process fully exits.
  await Bun.sleep(500);
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {}
  try {
    rmSync(USER_DATA_DIR, { recursive: true, force: true });
  } catch {}
});

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

// The CDP+transport workaround in spawnChrome/connectBrowser was needed to get
// Playwright working on this Windows Server (no GPU) host. chromium.launch()
// and connectOverCDP() both work on standard macOS/Linux, but this test hasn't
// been adapted to them. Gate to win32 until the launch path is also supported.
describe.skipIf(process.platform !== "win32")("Client boot smoke test", () => {
  it("loads canvas with zero console errors and sets window.__trayceReady", async () => {
    if (!browser) throw new Error("browser not initialized");

    const errors: string[] = [];

    const context = await browser.newContext();
    // newPage is actually typed as unknown above; use type assertion
    const page = (await context.newPage()) as {
      on: (event: string, handler: (arg: unknown) => void) => void;
      goto: (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
      waitForFunction: (fn: () => unknown, opts?: Record<string, unknown>) => Promise<void>;
      evaluate: <T>(fn: () => T) => Promise<T>;
      close: () => Promise<void>;
    };

    page.on("console", (msg) => {
      const m = msg as { type: () => string; text: () => string };
      if (m.type() === "error") {
        errors.push(`[console.error] ${m.text()}`);
      }
    });

    page.on("pageerror", (err) => {
      const e = err as { message: string };
      errors.push(`[pageerror] ${e.message}`);
    });

    try {
      await page.goto(`http://127.0.0.1:${TEST_PORT}/?token=${TEST_TOKEN}`, {
        waitUntil: "domcontentloaded",
      });

      // Wait for app bootstrap to complete
      await page.waitForFunction(
        () => (window as unknown as { __trayceReady?: boolean }).__trayceReady === true,
        { timeout: 5_000 },
      );

      // Assert no console or page errors occurred
      expect(errors, `Expected zero browser errors but got:\n${errors.join("\n")}`).toHaveLength(0);

      // Confirm the flag is actually truthy
      const ready = await page.evaluate(
        () => (window as unknown as { __trayceReady?: boolean }).__trayceReady,
      );
      expect(ready).toBe(true);
    } finally {
      await page.close().catch(() => {});
    }
  }, 30_000);
});
