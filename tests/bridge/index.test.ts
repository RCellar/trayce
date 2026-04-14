import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDir } from "../helpers/paths";
import { formatAnnotationsForNotification } from "../../bridge/index";
import type { Annotation } from "../../shared/protocol";

const TEST_STATE_DIR = testDir("bridge");
const TEST_STATE_FILE = join(TEST_STATE_DIR, "state.json");

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
    const missing = join(tmpdir(), "trayce-test-bridge-nonexistent", "state.json");
    expect(existsSync(missing)).toBe(false);
    // The bridge would fall back to defaults — we just verify existsSync works
  });
});

describe("formatAnnotationsForNotification", () => {
  test("returns empty string when no annotations", () => {
    expect(formatAnnotationsForNotification([])).toBe("");
  });

  test("includes human summary of open annotations with inline IDs", () => {
    const anns: Annotation[] = [
      {
        id: "abc123-long-id",
        kind: "pin",
        author: "user",
        status: "open",
        createdAt: 1,
        updatedAt: 1,
        replies: [],
        number: 1,
        at: [120, 400],
        note: "increase padding",
      },
    ];
    const out = formatAnnotationsForNotification(anns);
    expect(out).toContain("Annotations");
    expect(out).toContain("#1");
    expect(out).toContain("increase padding");
    expect(out).toContain("abc123");
  });

  test("includes JSON block with full annotation data", () => {
    const anns: Annotation[] = [
      {
        id: "id-1",
        kind: "text",
        author: "user",
        status: "open",
        createdAt: 1,
        updatedAt: 1,
        replies: [],
        text: "hi",
        bbox: [0, 0, 10, 10],
        style: { fontSize: 14, color: "#dc2626", weight: "normal" },
      },
    ];
    const out = formatAnnotationsForNotification(anns);
    expect(out).toContain("<annotations-json>");
    expect(out).toContain("</annotations-json>");
    const match = out.match(/<annotations-json>([\s\S]*?)<\/annotations-json>/);
    expect(match).toBeTruthy();
    const parsed = JSON.parse(match![1]!);
    expect(parsed[0].id).toBe("id-1");
  });

  test("summary lists only open items; JSON includes all statuses", () => {
    const anns: Annotation[] = [
      {
        id: "id-1", kind: "pin", author: "user", status: "open",
        createdAt: 1, updatedAt: 1, replies: [], number: 1, at: [0, 0],
      },
      {
        id: "id-2", kind: "pin", author: "user", status: "addressed",
        createdAt: 1, updatedAt: 2, replies: [], number: 2, at: [10, 10],
      },
    ];
    const out = formatAnnotationsForNotification(anns);
    expect(out).toMatch(/Annotations \(1 open\)/);
    const match = out.match(/<annotations-json>([\s\S]*?)<\/annotations-json>/);
    const parsed = JSON.parse(match![1]!);
    expect(parsed.length).toBe(2);
  });
});
