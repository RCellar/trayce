import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptEntry } from "../../bridge/transcript-watcher";
import { TranscriptWatcher } from "../../bridge/transcript-watcher";
import { testDir } from "../helpers/paths";

const TEST_DIR = testDir("slim-watcher");
const TEST_FILE = join(TEST_DIR, "transcript.jsonl");

const ASSISTANT_TEXT = JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "Hi! How can I help?" }],
  },
  timestamp: "2026-03-27T19:00:01.000Z",
});

const USER_TEXT = JSON.stringify({
  type: "user",
  message: { role: "user", content: "Hello Claude" },
  timestamp: "2026-03-27T19:00:00.000Z",
});

const TOOL_USE_MSG = JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    content: [
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

const MIXED_MSG = JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    content: [
      { type: "text", text: "Let me read that file." },
      { type: "tool_use", id: "tu_456", name: "Read", input: { file_path: "/src/foo.ts" } },
    ],
  },
  timestamp: "2026-03-27T19:00:04.000Z",
});

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(TEST_FILE, "");
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("TranscriptWatcher (slim)", () => {
  test("emits assistant text entries as type 'response' with role 'assistant'", () => {
    writeFileSync(TEST_FILE, `${ASSISTANT_TEXT}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("response");
    expect(entries[0]!.role).toBe("assistant");
    expect(entries[0]!.content).toBe("Hi! How can I help?");
  });

  test("emits user text entries as type 'message' with role 'user'", () => {
    writeFileSync(TEST_FILE, `${USER_TEXT}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("message");
    expect(entries[0]!.role).toBe("user");
    expect(entries[0]!.content).toBe("Hello Claude");
  });

  test("skips tool_use entries (block type check)", () => {
    writeFileSync(TEST_FILE, `${TOOL_USE_MSG}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(0);
  });

  test("skips tool_result entries (block type check)", () => {
    writeFileSync(TEST_FILE, `${TOOL_RESULT_MSG}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(0);
  });

  test("reads incrementally from offset — append data and call readNewEntries again", () => {
    writeFileSync(TEST_FILE, `${USER_TEXT}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));

    watcher.readNewEntries();
    expect(entries).toHaveLength(1);

    appendFileSync(TEST_FILE, `${ASSISTANT_TEXT}\n`);

    watcher.readNewEntries();
    expect(entries).toHaveLength(2);
    expect(entries[1]!.type).toBe("response");
    expect(entries[1]!.content).toBe("Hi! How can I help?");
  });

  test("mixed content: text + tool_use block emits only the text block", () => {
    writeFileSync(TEST_FILE, `${MIXED_MSG}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("response");
    expect(entries[0]!.content).toBe("Let me read that file.");
  });

  test("does not re-emit already-read entries on second readNewEntries call", () => {
    writeFileSync(TEST_FILE, `${USER_TEXT}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));

    watcher.readNewEntries();
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
  });

  test("ignores malformed JSON lines gracefully", () => {
    writeFileSync(TEST_FILE, `not-valid-json\n${USER_TEXT}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));

    expect(() => watcher.readNewEntries()).not.toThrow();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.content).toBe("Hello Claude");
  });

  test("ignores non-message types like file-history-snapshot", () => {
    const snapshot = JSON.stringify({ type: "file-history-snapshot", snapshot: {} });
    writeFileSync(TEST_FILE, `${snapshot}\n${USER_TEXT}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]!.content).toBe("Hello Claude");
  });

  test("returns silently when file does not exist", () => {
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(
      join(TEST_DIR, "nonexistent.jsonl"),
      (entry) => entries.push(entry),
    );

    expect(() => watcher.readNewEntries()).not.toThrow();
    expect(entries).toHaveLength(0);
  });

  test("entries have a numeric timestamp", () => {
    writeFileSync(TEST_FILE, `${USER_TEXT}\n`);
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(typeof entries[0]!.timestamp).toBe("number");
    expect(entries[0]!.timestamp).toBeGreaterThan(0);
  });

  test("start() and stop() do not throw", () => {
    writeFileSync(TEST_FILE, `${USER_TEXT}\n`);
    const watcher = new TranscriptWatcher(TEST_FILE, () => {});
    expect(() => watcher.start()).not.toThrow();
    expect(() => watcher.stop()).not.toThrow();
  });
});
