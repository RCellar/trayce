import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
} from "bun:test";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { TranscriptWatcher, discoverTranscriptPath } from "../../bridge/transcript-watcher";
import type { TranscriptEntry } from "../../bridge/transcript-watcher";

const TEST_DIR = "/tmp/trayce-test-transcript";
const TEST_FILE = `${TEST_DIR}/transcript.jsonl`;

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
    content: [
      { type: "tool_result", tool_use_id: "tu_123", content: "file contents here" },
    ],
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
    writeFileSync(TEST_FILE, USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("message");
    expect(entries[0].role).toBe("user");
    expect(entries[0].content).toBe("Hello Claude");
  });

  test("classifies assistant text as type 'response' with role 'assistant'", () => {
    writeFileSync(TEST_FILE, ASSISTANT_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("response");
    expect(entries[0].role).toBe("assistant");
    expect(entries[0].content).toBe("Hi! How can I help?");
  });

  test("classifies tool_use block as type 'tool-call' with toolName and toolInput", () => {
    writeFileSync(TEST_FILE, TOOL_USE_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, (entry) => entries.push(entry));
    watcher.readNewEntries();

    const toolCallEntry = entries.find((e) => e.type === "tool-call");
    expect(toolCallEntry).toBeDefined();
    expect(toolCallEntry!.toolName).toBe("Read");
    expect(toolCallEntry!.toolUseId).toBe("tu_123");
    expect(toolCallEntry!.toolInput).toContain("/src/main.ts");
  });

  test("classifies tool_result block as type 'tool-result' with toolUseId", () => {
    writeFileSync(TEST_FILE, TOOL_RESULT_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("tool-result");
    expect(entries[0].toolUseId).toBe("tu_123");
    expect(entries[0].content).toBe("file contents here");
  });

  test("reads incrementally from byte offset", () => {
    writeFileSync(TEST_FILE, USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, (entry) => entries.push(entry));

    // First read
    watcher.readNewEntries();
    expect(entries).toHaveLength(1);

    // Append more content
    appendFileSync(TEST_FILE, ASSISTANT_MSG + "\n");

    // Second read should only get the new entry
    watcher.readNewEntries();
    expect(entries).toHaveLength(2);
    expect(entries[1].type).toBe("response");
    expect(entries[1].content).toBe("Hi! How can I help?");
  });

  test("does not re-emit already-read entries on second readNewEntries call", () => {
    writeFileSync(TEST_FILE, USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, (entry) => entries.push(entry));

    watcher.readNewEntries();
    watcher.readNewEntries(); // second call with no new content

    expect(entries).toHaveLength(1);
  });

  test("emits both response and tool-call for mixed assistant message", () => {
    writeFileSync(TEST_FILE, TOOL_USE_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, (entry) => entries.push(entry));
    watcher.readNewEntries();

    const responseEntry = entries.find((e) => e.type === "response");
    const toolCallEntry = entries.find((e) => e.type === "tool-call");

    expect(responseEntry).toBeDefined();
    expect(responseEntry!.content).toBe("Let me read that file.");
    expect(toolCallEntry).toBeDefined();
    expect(toolCallEntry!.toolName).toBe("Read");
  });

  test("truncates toolInput to 200 chars", () => {
    const longInput = { data: "x".repeat(300) };
    const msg = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tu_long", name: "Write", input: longInput },
        ],
      },
    });
    writeFileSync(TEST_FILE, msg + "\n");

    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, (entry) => entries.push(entry));
    watcher.readNewEntries();

    const toolEntry = entries.find((e) => e.type === "tool-call");
    expect(toolEntry).toBeDefined();
    expect(toolEntry!.toolInput!.length).toBeLessThanOrEqual(200);
  });

  test("truncates tool_result content to 500 chars", () => {
    const longContent = "y".repeat(600);
    const msg = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tu_long", content: longContent },
        ],
      },
    });
    writeFileSync(TEST_FILE, msg + "\n");

    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries[0].content.length).toBeLessThanOrEqual(500);
  });

  test("entries have a numeric timestamp", () => {
    writeFileSync(TEST_FILE, USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(typeof entries[0].timestamp).toBe("number");
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  test("ignores malformed JSON lines gracefully", () => {
    writeFileSync(TEST_FILE, "not-valid-json\n" + USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, (entry) => entries.push(entry));

    expect(() => watcher.readNewEntries()).not.toThrow();
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("Hello Claude");
  });

  test("ignores non-message types like file-history-snapshot", () => {
    const snapshot = JSON.stringify({ type: "file-history-snapshot", snapshot: {} });
    writeFileSync(TEST_FILE, snapshot + "\n" + USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("Hello Claude");
  });

  test("start() and stop() do not throw", () => {
    writeFileSync(TEST_FILE, USER_MSG + "\n");
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, () => {});
    expect(() => watcher.start()).not.toThrow();
    expect(() => watcher.stop()).not.toThrow();
  });

  test("emits usage callback for assistant entries with usage data", () => {
    const assistantWithUsage = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-6",
        content: [{ type: "text", text: "Hello" }],
        usage: {
          input_tokens: 10,
          output_tokens: 50,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 30,
        },
      },
      timestamp: "2026-03-27T19:00:00.000Z",
    });
    writeFileSync(TEST_FILE, assistantWithUsage + "\n");

    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    expect(usageUpdates).toHaveLength(1);
    expect(usageUpdates[0].inputTokens).toBe(10);
    expect(usageUpdates[0].outputTokens).toBe(50);
    expect(usageUpdates[0].cacheReadTokens).toBe(200);
    expect(usageUpdates[0].cacheWriteTokens).toBe(30);
    expect(usageUpdates[0].model).toBe("claude-opus-4-6");
  });

  test("does not emit usage callback for entries without usage data", () => {
    writeFileSync(TEST_FILE, USER_MSG + "\n");

    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    expect(usageUpdates).toHaveLength(0);
  });

  test("usage callback is optional (backwards compatible)", () => {
    writeFileSync(TEST_FILE, ASSISTANT_MSG + "\n");

    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
  });
});

describe("TranscriptWatcher rediscovery", () => {
  // Use a unique cwd so discoverTranscriptPath finds our test files
  // in ~/.claude/projects/{encoded-cwd}/
  const testCwd = "/tmp/trayce-test-rediscovery-cwd";
  const encodedCwd = "-tmp-trayce-test-rediscovery-cwd";
  const projectDir = join(homedir(), ".claude", "projects", encodedCwd);

  beforeEach(() => {
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("discoverTranscriptPath picks the most recently modified .jsonl", () => {
    const oldFile = join(projectDir, "old-session.jsonl");
    const newFile = join(projectDir, "new-session.jsonl");

    writeFileSync(oldFile, USER_MSG + "\n");
    // Ensure new file has a later mtime
    const future = new Date(Date.now() + 2000);
    writeFileSync(newFile, ASSISTANT_MSG + "\n");
    const { utimesSync } = require("node:fs");
    utimesSync(newFile, future, future);

    const discovered = discoverTranscriptPath(testCwd);
    expect(discovered).toBe(newFile);
  });

  test("watcher switches to newer file when it appears", async () => {
    const oldFile = join(projectDir, "old-session.jsonl");
    writeFileSync(oldFile, USER_MSG + "\n");

    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(oldFile, testCwd, (entry) => entries.push(entry));
    watcher.start();

    // Should have read the old file
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].content).toBe("Hello Claude");
    const countAfterOld = entries.length;

    // Simulate the current session's file appearing with a newer mtime
    const newFile = join(projectDir, "current-session.jsonl");
    const future = new Date(Date.now() + 5000);
    writeFileSync(newFile, ASSISTANT_MSG + "\n");
    const { utimesSync } = require("node:fs");
    utimesSync(newFile, future, future);

    // Wait for rediscovery timer (3s) + a small buffer
    await new Promise((resolve) => setTimeout(resolve, 3500));

    watcher.stop();

    // Should have picked up the new file's content
    const newEntries = entries.slice(countAfterOld);
    const hasNewContent = newEntries.some((e) => e.content === "Hi! How can I help?");
    expect(hasNewContent).toBe(true);
  });
});
