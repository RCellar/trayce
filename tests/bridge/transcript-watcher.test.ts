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
import { TranscriptWatcher } from "../../bridge/transcript-watcher";
import type { TranscriptEntry } from "../../bridge/transcript-watcher";

const TEST_DIR = "/tmp/trayce-test-transcript";
const TEST_FILE = `${TEST_DIR}/transcript.jsonl`;

const USER_MSG = JSON.stringify({
  role: "user",
  content: [{ type: "text", text: "Hello Claude" }],
});

const ASSISTANT_MSG = JSON.stringify({
  role: "assistant",
  content: [{ type: "text", text: "Hi! How can I help?" }],
});

const TOOL_USE_MSG = JSON.stringify({
  role: "assistant",
  content: [
    { type: "text", text: "Let me read that file." },
    { type: "tool_use", id: "tu_123", name: "Read", input: { file_path: "/src/main.ts" } },
  ],
});

const TOOL_RESULT_MSG = JSON.stringify({
  role: "user",
  content: [
    { type: "tool_result", tool_use_id: "tu_123", content: "file contents here" },
  ],
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
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("message");
    expect(entries[0].role).toBe("user");
    expect(entries[0].content).toBe("Hello Claude");
  });

  test("classifies assistant text as type 'response' with role 'assistant'", () => {
    writeFileSync(TEST_FILE, ASSISTANT_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("response");
    expect(entries[0].role).toBe("assistant");
    expect(entries[0].content).toBe("Hi! How can I help?");
  });

  test("classifies tool_use block as type 'tool-call' with toolName and toolInput", () => {
    writeFileSync(TEST_FILE, TOOL_USE_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
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
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("tool-result");
    expect(entries[0].toolUseId).toBe("tu_123");
    expect(entries[0].content).toBe("file contents here");
  });

  test("reads incrementally from byte offset", () => {
    writeFileSync(TEST_FILE, USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));

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
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));

    watcher.readNewEntries();
    watcher.readNewEntries(); // second call with no new content

    expect(entries).toHaveLength(1);
  });

  test("emits both response and tool-call for mixed assistant message", () => {
    writeFileSync(TEST_FILE, TOOL_USE_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
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
      role: "assistant",
      content: [
        { type: "tool_use", id: "tu_long", name: "Write", input: longInput },
      ],
    });
    writeFileSync(TEST_FILE, msg + "\n");

    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    const toolEntry = entries.find((e) => e.type === "tool-call");
    expect(toolEntry).toBeDefined();
    expect(toolEntry!.toolInput!.length).toBeLessThanOrEqual(200);
  });

  test("truncates tool_result content to 500 chars", () => {
    const longContent = "y".repeat(600);
    const msg = JSON.stringify({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu_long", content: longContent },
      ],
    });
    writeFileSync(TEST_FILE, msg + "\n");

    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries[0].content.length).toBeLessThanOrEqual(500);
  });

  test("entries have a numeric timestamp", () => {
    writeFileSync(TEST_FILE, USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(typeof entries[0].timestamp).toBe("number");
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  test("ignores malformed JSON lines gracefully", () => {
    writeFileSync(TEST_FILE, "not-valid-json\n" + USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));

    expect(() => watcher.readNewEntries()).not.toThrow();
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("Hello Claude");
  });

  test("start() and stop() do not throw", () => {
    writeFileSync(TEST_FILE, USER_MSG + "\n");
    const watcher = new TranscriptWatcher(TEST_FILE, () => {});
    expect(() => watcher.start()).not.toThrow();
    expect(() => watcher.stop()).not.toThrow();
  });
});
