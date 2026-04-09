import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, rmSync, utimesSync } from "node:fs";
import { SubmissionStore } from "../../server/submissions";

const TEST_DIR = "/tmp/trayce-test-submissions";

// Minimal valid PNG (1x1 transparent pixel)
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

let store: SubmissionStore;

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  store = new SubmissionStore(TEST_DIR, 20 * 1024 * 1024);
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("save", () => {
  it("writes a PNG file and returns a Submission", async () => {
    const result = await store.save(TINY_PNG_B64, "test prompt");
    expect(result.id).toMatch(/^sub-\d+-\d+$/);
    expect(result.pngPath).toContain(TEST_DIR);
    expect(result.pngPath).toEndWith(".png");
    expect(result.prompt).toBe("test prompt");
    expect(typeof result.timestamp).toBe("number");
    expect(existsSync(result.pngPath)).toBe(true);
  });

  it("creates the directory if it does not exist", async () => {
    expect(existsSync(TEST_DIR)).toBe(false);
    await store.save(TINY_PNG_B64, "");
    expect(existsSync(TEST_DIR)).toBe(true);
  });

  it("generates unique ids for rapid successive saves", async () => {
    const results = await Promise.all([
      store.save(TINY_PNG_B64, "a"),
      store.save(TINY_PNG_B64, "b"),
      store.save(TINY_PNG_B64, "c"),
    ]);
    const ids = results.map((r) => r.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });

  it("rejects payloads exceeding maxBytes", async () => {
    const tinyStore = new SubmissionStore(TEST_DIR, 10);
    expect(tinyStore.save(TINY_PNG_B64, "")).rejects.toThrow("exceeds");
  });

  it("accepts payloads exactly at maxBytes", async () => {
    const decoded = Buffer.from(TINY_PNG_B64, "base64");
    const exactStore = new SubmissionStore(TEST_DIR, decoded.byteLength);
    const result = await exactStore.save(TINY_PNG_B64, "");
    expect(existsSync(result.pngPath)).toBe(true);
  });

  it("stores empty prompt string", async () => {
    const result = await store.save(TINY_PNG_B64, "");
    expect(result.prompt).toBe("");
  });
});

describe("cleanup", () => {
  it("removes files older than TTL", async () => {
    const result = await store.save(TINY_PNG_B64, "");
    expect(existsSync(result.pngPath)).toBe(true);

    // Backdate the file to 2 hours ago
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(result.pngPath, past, past);

    const removed = await store.cleanup(60 * 60 * 1000); // 1 hour TTL
    expect(removed).toBe(1);
    expect(existsSync(result.pngPath)).toBe(false);
  });

  it("does not remove files within TTL", async () => {
    const result = await store.save(TINY_PNG_B64, "");
    const removed = await store.cleanup(60 * 60 * 1000);
    expect(removed).toBe(0);
    expect(existsSync(result.pngPath)).toBe(true);
  });

  it("returns 0 when directory does not exist", async () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    const removed = await store.cleanup(60 * 60 * 1000);
    expect(removed).toBe(0);
  });

  it("ignores non-PNG files", async () => {
    await store.save(TINY_PNG_B64, "");
    // Create a non-PNG file
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${TEST_DIR}/notes.txt`, "hello");

    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(`${TEST_DIR}/notes.txt`, past, past);

    await store.cleanup(60 * 60 * 1000);
    // Only the PNG should be considered (if old enough), notes.txt should be ignored
    expect(existsSync(`${TEST_DIR}/notes.txt`)).toBe(true);
  });
});

describe("removeAll", () => {
  it("deletes the entire directory", async () => {
    await store.save(TINY_PNG_B64, "");
    expect(existsSync(TEST_DIR)).toBe(true);
    store.removeAll();
    expect(existsSync(TEST_DIR)).toBe(false);
  });

  it("is a no-op when directory does not exist", () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    expect(() => store.removeAll()).not.toThrow();
  });
});
