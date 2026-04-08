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
import { TranscriptWatcher, discoverTranscriptPath, discoverTranscriptByBirthtime } from "../../bridge/transcript-watcher";
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
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("message");
    expect(entries[0].role).toBe("user");
    expect(entries[0].content).toBe("Hello Claude");
  });

  test("classifies assistant text as type 'response' with role 'assistant'", () => {
    writeFileSync(TEST_FILE, ASSISTANT_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("response");
    expect(entries[0].role).toBe("assistant");
    expect(entries[0].content).toBe("Hi! How can I help?");
  });

  test("classifies tool_use block as type 'tool-call' with toolName and toolInput", () => {
    writeFileSync(TEST_FILE, TOOL_USE_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (entry) => entries.push(entry));
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
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("tool-result");
    expect(entries[0].toolUseId).toBe("tu_123");
    expect(entries[0].content).toBe("file contents here");
  });

  test("reads incrementally from byte offset", () => {
    writeFileSync(TEST_FILE, USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (entry) => entries.push(entry));

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
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (entry) => entries.push(entry));

    watcher.readNewEntries();
    watcher.readNewEntries(); // second call with no new content

    expect(entries).toHaveLength(1);
  });

  test("emits both response and tool-call for mixed assistant message", () => {
    writeFileSync(TEST_FILE, TOOL_USE_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (entry) => entries.push(entry));
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
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (entry) => entries.push(entry));
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
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries[0].content.length).toBeLessThanOrEqual(500);
  });

  test("entries have a numeric timestamp", () => {
    writeFileSync(TEST_FILE, USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(typeof entries[0].timestamp).toBe("number");
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  test("ignores malformed JSON lines gracefully", () => {
    writeFileSync(TEST_FILE, "not-valid-json\n" + USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (entry) => entries.push(entry));

    expect(() => watcher.readNewEntries()).not.toThrow();
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("Hello Claude");
  });

  test("ignores non-message types like file-history-snapshot", () => {
    const snapshot = JSON.stringify({ type: "file-history-snapshot", snapshot: {} });
    writeFileSync(TEST_FILE, snapshot + "\n" + USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("Hello Claude");
  });

  test("start() and stop() do not throw", () => {
    writeFileSync(TEST_FILE, USER_MSG + "\n");
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), () => {});
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
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), () => {}, (usage) => usageUpdates.push(usage));
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
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    expect(usageUpdates).toHaveLength(0);
  });

  test("usage callback is optional (backwards compatible)", () => {
    writeFileSync(TEST_FILE, ASSISTANT_MSG + "\n");

    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
  });
});

describe("rediscovery bounds", () => {
  test("stops rediscovering after confirming transcript via birthtime", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(TEST_FILE, USER_MSG + "\n");

    const entries: TranscriptEntry[] = [];
    // Pass discoveredByBirthtime=true to simulate birthtime-confirmed discovery
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (e) => entries.push(e), undefined, true);
    watcher.start();
    await Bun.sleep(100);

    expect(entries.length).toBeGreaterThan(0);
    expect((watcher as any).confirmed).toBe(true);

    watcher.stop();
  });

  test("does not confirm transcript discovered via cwd fallback", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(TEST_FILE, USER_MSG + "\n");

    const entries: TranscriptEntry[] = [];
    // discoveredByBirthtime=false (default) — cwd fallback
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (e) => entries.push(e));
    watcher.start();
    await Bun.sleep(100);

    expect(entries.length).toBeGreaterThan(0);
    expect((watcher as any).confirmed).toBe(false);

    watcher.stop();
  });
});

describe("partial line handling", () => {
  test("does not lose entries split across reads", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (e) => entries.push(e));

    // Write first half of a JSONL line (incomplete — no newline)
    const fullLine = USER_MSG;
    const half = fullLine.slice(0, Math.floor(fullLine.length / 2));
    writeFileSync(TEST_FILE, half);

    // Read — should get nothing (incomplete line)
    watcher.readNewEntries();
    expect(entries.length).toBe(0);

    // Append the second half + newline
    appendFileSync(TEST_FILE, fullLine.slice(Math.floor(fullLine.length / 2)) + "\n");

    // Read again — now should get the complete entry
    watcher.readNewEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].content).toBe("Hello Claude");

    watcher.stop();
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

  test("watcher stays on birthtime-confirmed file and does not switch", async () => {
    const oldFile = join(projectDir, "old-session.jsonl");
    writeFileSync(oldFile, USER_MSG + "\n");

    // Ensure old file's birthtime is clearly before startTime
    await new Promise((resolve) => setTimeout(resolve, 250));

    const startTime = Date.now();
    const entries: TranscriptEntry[] = [];
    // discoveredByBirthtime=true — simulates birthtime-confirmed discovery
    const watcher = new TranscriptWatcher(oldFile, testCwd, startTime, (entry) => entries.push(entry), undefined, true);
    watcher.start();

    // Should have read the old file and set confirmed = true
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].content).toBe("Hello Claude");
    expect((watcher as any).confirmed).toBe(true);

    // Simulate a new file appearing — birthtime ≈ startTime
    const newFile = join(projectDir, "current-session.jsonl");
    writeFileSync(newFile, ASSISTANT_MSG + "\n");

    // Wait longer than the rediscovery timer (3s) — watcher should NOT switch
    await new Promise((resolve) => setTimeout(resolve, 3500));

    watcher.stop();

    // confirmed prevents rediscovery: new file content must NOT appear
    const hasNewContent = entries.some((e) => e.content === "Hi! How can I help?");
    expect(hasNewContent).toBe(false);
  });

  test("watcher switches from cwd-fallback file to birthtime-matched file", async () => {
    const oldFile = join(projectDir, "old-session.jsonl");
    writeFileSync(oldFile, USER_MSG + "\n");

    // Ensure old file's birthtime is clearly before startTime
    await new Promise((resolve) => setTimeout(resolve, 250));

    const startTime = Date.now();
    const entries: TranscriptEntry[] = [];
    // discoveredByBirthtime=false — cwd fallback, should allow rediscovery
    const watcher = new TranscriptWatcher(oldFile, testCwd, startTime, (entry) => entries.push(entry));
    watcher.start();

    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect((watcher as any).confirmed).toBe(false);

    // Simulate the real transcript appearing — birthtime ≈ startTime
    const newFile = join(projectDir, "current-session.jsonl");
    writeFileSync(newFile, ASSISTANT_MSG + "\n");

    // Wait longer than the rediscovery timer (3s) — watcher SHOULD switch
    await new Promise((resolve) => setTimeout(resolve, 3500));

    watcher.stop();

    const hasNewContent = entries.some((e) => e.content === "Hi! How can I help?");
    expect(hasNewContent).toBe(true);
  });

  test("discoverTranscriptByBirthtime finds file created near given timestamp", () => {
    // Create a file now — its birthtime will be close to Date.now()
    const testFile = join(projectDir, "birthtime-test.jsonl");
    const beforeCreate = Date.now();
    writeFileSync(testFile, USER_MSG + "\n");

    const discovered = discoverTranscriptByBirthtime(beforeCreate);
    expect(discovered).toBe(testFile);
  });

  test("discoverTranscriptByBirthtime returns null for old startTime", () => {
    const testFile = join(projectDir, "old-file.jsonl");
    writeFileSync(testFile, USER_MSG + "\n");

    // Start time far in the past — file's birthtime (now) is >60s away
    const discovered = discoverTranscriptByBirthtime(Date.now() - 120_000);
    // The file was just created so its birthtime is ~now, drift is ~120s > 60s max
    expect(discovered).toBeNull();
  });
});

describe("TranscriptWatcher subagent tracking", () => {
  const SUBAGENT_DIR_BASE = "/tmp/trayce-test-transcript";
  const MAIN_TRANSCRIPT = `${SUBAGENT_DIR_BASE}/session-uuid.jsonl`;
  const SUBAGENTS_DIR = `${SUBAGENT_DIR_BASE}/session-uuid/subagents`;

  const mkSubagentEntry = (model: string, input: number, output: number, cacheRead: number, cacheWrite: number) =>
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        model,
        content: [{ type: "text", text: "Done" }],
        usage: {
          input_tokens: input,
          output_tokens: output,
          cache_read_input_tokens: cacheRead,
          cache_creation_input_tokens: cacheWrite,
        },
      },
      timestamp: "2026-03-28T10:00:00.000Z",
    });

  beforeEach(() => {
    mkdirSync(SUBAGENTS_DIR, { recursive: true });
    writeFileSync(MAIN_TRANSCRIPT, USER_MSG + "\n");
  });

  afterEach(() => {
    rmSync(SUBAGENT_DIR_BASE, { recursive: true, force: true });
  });

  test("picks up usage from subagent transcript files", () => {
    const subFile = join(SUBAGENTS_DIR, "agent-001.jsonl");
    writeFileSync(subFile, mkSubagentEntry("claude-sonnet-4-6", 100, 500, 5000, 200) + "\n");

    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, SUBAGENT_DIR_BASE, Date.now(), () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    const sonnetUsage = usageUpdates.find((u) => u.model === "claude-sonnet-4-6");
    expect(sonnetUsage).toBeDefined();
    expect(sonnetUsage.inputTokens).toBe(100);
    expect(sonnetUsage.outputTokens).toBe(500);
    expect(sonnetUsage.cacheReadTokens).toBe(5000);
    expect(sonnetUsage.cacheWriteTokens).toBe(200);
  });

  test("tracks multiple subagent files with different models", () => {
    writeFileSync(join(SUBAGENTS_DIR, "agent-001.jsonl"), mkSubagentEntry("claude-sonnet-4-6", 100, 500, 5000, 200) + "\n");
    writeFileSync(join(SUBAGENTS_DIR, "agent-002.jsonl"), mkSubagentEntry("claude-haiku-3-5", 50, 200, 1000, 100) + "\n");

    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, SUBAGENT_DIR_BASE, Date.now(), () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    const models = usageUpdates.map((u) => u.model);
    expect(models).toContain("claude-sonnet-4-6");
    expect(models).toContain("claude-haiku-3-5");
  });

  test("reads subagent files incrementally across polls", () => {
    const subFile = join(SUBAGENTS_DIR, "agent-001.jsonl");
    writeFileSync(subFile, mkSubagentEntry("claude-sonnet-4-6", 100, 500, 5000, 200) + "\n");

    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, SUBAGENT_DIR_BASE, Date.now(), () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    // Append another entry to the same file
    appendFileSync(subFile, mkSubagentEntry("claude-sonnet-4-6", 200, 600, 3000, 100) + "\n");
    watcher.readNewEntries();

    // Should have picked up only the new entry (no duplicates)
    const sonnetEntries = usageUpdates.filter((u) => u.model === "claude-sonnet-4-6");
    expect(sonnetEntries).toHaveLength(2);
    // Second entry has different token counts
    expect(sonnetEntries[1].inputTokens).toBe(200);
    expect(sonnetEntries[1].outputTokens).toBe(600);
  });

  test("discovers subagent files that appear after initial read", () => {
    // Remove subagent files (dir exists but is empty)
    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, SUBAGENT_DIR_BASE, Date.now(), () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    const countBefore = usageUpdates.length;

    // Now create a subagent file after initial read
    writeFileSync(join(SUBAGENTS_DIR, "agent-late.jsonl"), mkSubagentEntry("claude-sonnet-4-6", 100, 500, 5000, 200) + "\n");
    watcher.readNewEntries();

    expect(usageUpdates.length).toBeGreaterThan(countBefore);
    expect(usageUpdates.some((u) => u.model === "claude-sonnet-4-6")).toBe(true);
  });

  test("handles missing subagents directory gracefully", () => {
    // Remove the subagents directory entirely
    rmSync(SUBAGENTS_DIR, { recursive: true, force: true });
    // Also remove the session-uuid dir
    rmSync(join(SUBAGENT_DIR_BASE, "session-uuid"), { recursive: true, force: true });

    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, SUBAGENT_DIR_BASE, Date.now(), () => {});
    expect(() => watcher.readNewEntries()).not.toThrow();
  });

  test("ignores non-jsonl files in subagents directory", () => {
    writeFileSync(join(SUBAGENTS_DIR, "agent-001.meta.json"), JSON.stringify({ some: "metadata" }));

    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, SUBAGENT_DIR_BASE, Date.now(), () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    // No subagent usage should be emitted (only main transcript usage, if any)
    const subagentUsage = usageUpdates.filter((u) => u.model !== "claude-opus-4-6");
    expect(subagentUsage).toHaveLength(0);
  });

  test("does not lose subagent entries split across reads", async () => {
    const subFile = join(SUBAGENTS_DIR, "agent-partial.jsonl");
    const fullLine = mkSubagentEntry("claude-sonnet-4-6", 100, 500, 5000, 200);
    const half = fullLine.slice(0, Math.floor(fullLine.length / 2));

    writeFileSync(subFile, half);

    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, SUBAGENT_DIR_BASE, Date.now(), () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    // No complete line yet — should get nothing from the subagent file
    const beforeCount = usageUpdates.filter((u) => u.model === "claude-sonnet-4-6").length;
    expect(beforeCount).toBe(0);

    // Append the second half + newline
    appendFileSync(subFile, fullLine.slice(Math.floor(fullLine.length / 2)) + "\n");
    watcher.readNewEntries();

    // Now the complete entry should be emitted
    const afterCount = usageUpdates.filter((u) => u.model === "claude-sonnet-4-6").length;
    expect(afterCount).toBe(1);

    watcher.stop();
  });

  test("emits transcript entries from subagent files", () => {
    const subFile = join(SUBAGENTS_DIR, "agent-001.jsonl");
    writeFileSync(subFile, mkSubagentEntry("claude-sonnet-4-6", 100, 500, 5000, 200) + "\n");

    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, SUBAGENT_DIR_BASE, Date.now(), (entry) => entries.push(entry));
    watcher.readNewEntries();

    // Should have entries from both main transcript and subagent
    const subagentEntry = entries.find((e) => e.content === "Done");
    expect(subagentEntry).toBeDefined();
    expect(subagentEntry!.type).toBe("response");
  });
});
