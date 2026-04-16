/**
 * Tests for the slim TranscriptWatcher.
 *
 * The full discovery/subagent/usage tests that existed here have been removed
 * along with those features. See slim-watcher.test.ts for the canonical test
 * suite for the rewritten watcher.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptEntry } from "../../bridge/transcript-watcher";
import { TranscriptWatcher } from "../../bridge/transcript-watcher";
import { testDir } from "../helpers/paths";

const TEST_DIR = testDir("transcript");
const TEST_FILE = join(TEST_DIR, "transcript.jsonl");

// Claude Code envelope format: { type, message: { role, content }, timestamp, ... }
const USER_MSG = JSON.stringify({
  type: "user",
  message: { role: "user", content: "Hello Claude" },
  timestamp: "2026-03-27T19:00:00.000Z",
});

const ASSISTANT_MSG = JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "Hi! How can I help?" }],
  },
  timestamp: "2026-03-27T19:00:01.000Z",
});

const TOOL_USE_MSG = JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    content: [
      { type: "text", text: "Let me read that file." },
      { type: "tool_use", id: "tu_123", name: "Read", input: { file_path: "/src/main.ts" } },
    ],
  },
  timestamp: "2026-03-27T19:00:02.000Z",
});

const TOOL_RESULT_MSG = JSON.stringify({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "tu_123", content: "file contents here" }],
  },
  timestamp: "2026-03-27T19:00:03.000Z",
});

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(TEST_FILE, ""); // start with empty file
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("TranscriptWatcher", () => {
  test("classifies user text messages as type 'message' with role 'user'", () => {
    writeFileSync(TEST_FILE, `${USER_MSG}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("message");
    expect(entries[0]!.role).toBe("user");
    expect(entries[0]!.content).toBe("Hello Claude");
  });

  test("classifies assistant text as type 'response' with role 'assistant'", () => {
    writeFileSync(TEST_FILE, `${ASSISTANT_MSG}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("response");
    expect(entries[0]!.role).toBe("assistant");
    expect(entries[0]!.content).toBe("Hi! How can I help?");
  });

  test("skips tool_use blocks (handled by hooks, not watcher)", () => {
    writeFileSync(TEST_FILE, `${TOOL_USE_MSG}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    // Only the text block should be emitted; tool_use is skipped
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("response");
    expect(entries[0]!.content).toBe("Let me read that file.");
    const toolCallEntry = entries.find((e) => e.type === "tool-call");
    expect(toolCallEntry).toBeUndefined();
  });

  test("skips tool_result blocks (handled by hooks, not watcher)", () => {
    writeFileSync(TEST_FILE, `${TOOL_RESULT_MSG}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    // tool_result has no text block — nothing emitted
    expect(entries).toHaveLength(0);
  });

  test("reads incrementally from byte offset", () => {
    writeFileSync(TEST_FILE, `${USER_MSG}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));

    // First read
    watcher.readNewEntries();
    expect(entries).toHaveLength(1);

    // Append more content
    appendFileSync(TEST_FILE, `${ASSISTANT_MSG}\n`);

    // Second read should only get the new entry
    watcher.readNewEntries();
    expect(entries).toHaveLength(2);
    expect(entries[1]!.type).toBe("response");
    expect(entries[1]!.content).toBe("Hi! How can I help?");
  });

  test("does not re-emit already-read entries on second readNewEntries call", () => {
    writeFileSync(TEST_FILE, `${USER_MSG}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));

    watcher.readNewEntries();
    watcher.readNewEntries(); // second call with no new content

    expect(entries).toHaveLength(1);
  });

  test("emits only the text block for a mixed assistant message (text + tool_use)", () => {
    writeFileSync(TEST_FILE, `${TOOL_USE_MSG}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    const responseEntry = entries.find((e) => e.type === "response");
    expect(responseEntry).toBeDefined();
    expect(responseEntry!.content).toBe("Let me read that file.");

    // tool-call must NOT be emitted
    expect(entries.find((e) => e.type === "tool-call")).toBeUndefined();
  });

  test("entries have a numeric timestamp", () => {
    writeFileSync(TEST_FILE, `${USER_MSG}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(typeof entries[0]!.timestamp).toBe("number");
    expect(entries[0]!.timestamp).toBeGreaterThan(0);
  });

  test("ignores malformed JSON lines gracefully", () => {
    writeFileSync(TEST_FILE, `not-valid-json\n${USER_MSG}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));

    expect(() => watcher.readNewEntries()).not.toThrow();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.content).toBe("Hello Claude");
  });

  test("ignores non-message types like file-history-snapshot", () => {
    const snapshot = JSON.stringify({ type: "file-history-snapshot", snapshot: {} });
    writeFileSync(TEST_FILE, `${snapshot}\n${USER_MSG}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.content).toBe("Hello Claude");
  });

  test("start() and stop() do not throw", () => {
    writeFileSync(TEST_FILE, `${USER_MSG}\n`);
    const watcher = new TranscriptWatcher(TEST_FILE, () => {});
    expect(() => watcher.start()).not.toThrow();
    expect(() => watcher.stop()).not.toThrow();
  });
});

describe("partial line handling", () => {
  test("does not lose entries split across reads", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (e) => entries.push(e));

    // Write first half of a JSONL line (incomplete — no newline)
    const fullLine = USER_MSG;
    const half = fullLine.slice(0, Math.floor(fullLine.length / 2));
    writeFileSync(TEST_FILE, half);

    // Read — should get nothing (incomplete line)
    watcher.readNewEntries();
    expect(entries.length).toBe(0);

    // Append the second half + newline
    appendFileSync(TEST_FILE, `${fullLine.slice(Math.floor(fullLine.length / 2))}\n`);

    // Read again — now should get the complete entry
    watcher.readNewEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]!.content).toBe("Hello Claude");

    watcher.stop();
  });
});
