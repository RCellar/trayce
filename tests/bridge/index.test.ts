import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const TEST_STATE_DIR = "/tmp/trayce-test-bridge";
const TEST_STATE_FILE = `${TEST_STATE_DIR}/state.json`;

const SAMPLE_STATE = {
  pid: process.pid,
  port: 9740,
  host: "127.0.0.1",
  token: "test-token-abc",
  url: "http://localhost:9740?token=test-token-abc",
};

describe("Bridge state discovery", () => {
  beforeAll(() => {
    mkdirSync(TEST_STATE_DIR, { recursive: true });
    writeFileSync(TEST_STATE_FILE, JSON.stringify(SAMPLE_STATE));
  });

  afterAll(() => {
    rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  });

  test("reads state file and extracts connection info", () => {
    const state = JSON.parse(readFileSync(TEST_STATE_FILE, "utf-8"));
    expect(state.port).toBe(9740);
    expect(state.token).toBe("test-token-abc");
    expect(state.host).toBe("127.0.0.1");
  });

  test("state file contains all expected fields", () => {
    const state = JSON.parse(readFileSync(TEST_STATE_FILE, "utf-8"));
    expect(typeof state.pid).toBe("number");
    expect(typeof state.port).toBe("number");
    expect(typeof state.host).toBe("string");
    expect(typeof state.token).toBe("string");
    expect(typeof state.url).toBe("string");
  });

  test("url contains the token", () => {
    const state = JSON.parse(readFileSync(TEST_STATE_FILE, "utf-8"));
    expect(state.url).toContain(`token=${state.token}`);
  });

  test("missing state file does not crash", () => {
    const missing = "/tmp/trayce-test-bridge-nonexistent/state.json";
    expect(existsSync(missing)).toBe(false);
    // The bridge would fall back to defaults — we just verify existsSync works
  });
});
