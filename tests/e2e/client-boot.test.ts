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
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium } from "playwright";

const TEST_PORT = 18900 + Math.floor(Math.random() * 100);
const TMP_DIR = join(tmpdir(), `trayce-e2e-${process.pid}-boot`);
const STATE_FILE = join(TMP_DIR, "state.json");
const SUBMISSIONS_DIR = join(TMP_DIR, "submissions");
const CLIENT_DIR = resolve(import.meta.dir, "../../dist/client");
const SERVER_ENTRY = resolve(import.meta.dir, "../../server/index.ts");
const TEST_TOKEN = "test-token-client-boot";

interface StateJson {
  pid: number;
  port: number;
  host: string;
  token: string | null;
  url: string;
}

let serverProc: ReturnType<typeof Bun.spawn>;
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

beforeAll(async () => {
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

  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  try {
    await browser?.close();
  } catch {}
  try {
    serverProc?.kill();
  } catch {}
  // Give Windows a moment to release locks before cleanup
  await Bun.sleep(200);
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {}
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
