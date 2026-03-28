# Subagent Usage Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track token usage from subagent transcripts so the Usage tab shows per-model breakdowns (Sonnet, Haiku, etc.) instead of only the main session model.

**Architecture:** The `TranscriptWatcher` already tails the main transcript JSONL. Subagent transcripts live in a `subagents/` directory adjacent to the main transcript, using the same JSONL format. We extend the watcher to discover and tail those files on each poll, feeding their usage data through the existing `onUsage` callback. No changes to server aggregation or client UI — the per-model plumbing already works end-to-end.

**Tech Stack:** Bun, Node.js fs APIs, existing TranscriptWatcher infrastructure

---

## File Map

- **Modify:** `bridge/transcript-watcher.ts` — Add subagent directory discovery and multi-file tailing to `TranscriptWatcher`
- **Modify:** `tests/bridge/transcript-watcher.test.ts` — Add tests for subagent transcript discovery and parsing

---

### Task 1: Subagent Directory Discovery and Tailing

**Files:**
- Modify: `tests/bridge/transcript-watcher.test.ts`
- Modify: `bridge/transcript-watcher.ts`

- [ ] **Step 1: Write failing tests for subagent transcript discovery**

Append to `tests/bridge/transcript-watcher.test.ts`, inside a new describe block at the end of the file:

```ts
describe("TranscriptWatcher subagent tracking", () => {
  const SUBAGENT_DIR = `${TEST_DIR}/session-uuid/subagents`;

  // Helper: main transcript path follows the pattern {dir}/{session-uuid}.jsonl
  // Subagents live at {dir}/{session-uuid}/subagents/agent-{id}.jsonl
  const MAIN_TRANSCRIPT = `${TEST_DIR}/session-uuid.jsonl`;

  const sonnetUsage = JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "Done" }],
      usage: {
        input_tokens: 100,
        output_tokens: 500,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 200,
      },
    },
    timestamp: "2026-03-28T10:00:00.000Z",
  });

  const haikuUsage = JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text: "Found it" }],
      usage: {
        input_tokens: 50,
        output_tokens: 200,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 0,
      },
    },
    timestamp: "2026-03-28T10:00:01.000Z",
  });

  beforeEach(() => {
    mkdirSync(SUBAGENT_DIR, { recursive: true });
    writeFileSync(MAIN_TRANSCRIPT, USER_MSG + "\n");
  });

  test("picks up usage from subagent transcript files", () => {
    writeFileSync(`${SUBAGENT_DIR}/agent-abc123.jsonl`, sonnetUsage + "\n");

    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, TEST_DIR, Date.now(), () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    const sonnetUpdate = usageUpdates.find((u: any) => u.model === "claude-sonnet-4-6");
    expect(sonnetUpdate).toBeDefined();
    expect(sonnetUpdate.inputTokens).toBe(100);
    expect(sonnetUpdate.outputTokens).toBe(500);
    expect(sonnetUpdate.cacheReadTokens).toBe(5000);
    expect(sonnetUpdate.cacheWriteTokens).toBe(200);
  });

  test("tracks multiple subagent files with different models", () => {
    writeFileSync(`${SUBAGENT_DIR}/agent-abc123.jsonl`, sonnetUsage + "\n");
    writeFileSync(`${SUBAGENT_DIR}/agent-def456.jsonl`, haikuUsage + "\n");

    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, TEST_DIR, Date.now(), () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    const models = usageUpdates.map((u: any) => u.model);
    expect(models).toContain("claude-sonnet-4-6");
    expect(models).toContain("claude-haiku-4-5-20251001");
  });

  test("reads subagent files incrementally across polls", () => {
    writeFileSync(`${SUBAGENT_DIR}/agent-abc123.jsonl`, sonnetUsage + "\n");

    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, TEST_DIR, Date.now(), () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    const countAfterFirst = usageUpdates.length;

    // Append more content to the same subagent file
    appendFileSync(`${SUBAGENT_DIR}/agent-abc123.jsonl`, sonnetUsage + "\n");
    watcher.readNewEntries();

    // Should have new entries but no duplicates from the first read
    const sonnetUpdates = usageUpdates.filter((u: any) => u.model === "claude-sonnet-4-6");
    expect(sonnetUpdates.length).toBe(countAfterFirst + 1);
  });

  test("discovers subagent files that appear after initial read", () => {
    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, TEST_DIR, Date.now(), () => {}, (usage) => usageUpdates.push(usage));

    // First read — no subagent files yet
    watcher.readNewEntries();
    const countBefore = usageUpdates.filter((u: any) => u.model === "claude-haiku-4-5-20251001").length;

    // Subagent file appears
    writeFileSync(`${SUBAGENT_DIR}/agent-late.jsonl`, haikuUsage + "\n");
    watcher.readNewEntries();

    const haikuUpdates = usageUpdates.filter((u: any) => u.model === "claude-haiku-4-5-20251001");
    expect(haikuUpdates.length).toBe(countBefore + 1);
  });

  test("handles missing subagents directory gracefully", () => {
    // Remove the subagents dir
    rmSync(SUBAGENT_DIR, { recursive: true, force: true });

    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, TEST_DIR, Date.now(), () => {}, (usage) => usageUpdates.push(usage));

    expect(() => watcher.readNewEntries()).not.toThrow();
  });

  test("ignores non-jsonl files in subagents directory", () => {
    writeFileSync(`${SUBAGENT_DIR}/agent-abc123.meta.json`, '{"agentType":"Explore"}\n');

    const usageUpdates: any[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, TEST_DIR, Date.now(), () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    // Only main transcript usage should appear (none, since USER_MSG has no usage)
    const subagentUsage = usageUpdates.filter((u: any) => u.model !== "unknown");
    expect(subagentUsage).toHaveLength(0);
  });

  test("emits transcript entries from subagent files", () => {
    writeFileSync(`${SUBAGENT_DIR}/agent-abc123.jsonl`, sonnetUsage + "\n");

    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(MAIN_TRANSCRIPT, TEST_DIR, Date.now(), (entry) => entries.push(entry), () => {});
    watcher.readNewEntries();

    const subagentEntry = entries.find((e) => e.content === "Done");
    expect(subagentEntry).toBeDefined();
  });
});
```

Also add `rmSync` to the imports at the top if not already present (it is already imported).

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/bridge/transcript-watcher.test.ts`
Expected: FAIL — TranscriptWatcher does not read subagent files

- [ ] **Step 3: Add subagent directory discovery and tailing to TranscriptWatcher**

In `bridge/transcript-watcher.ts`, add two new private fields to the `TranscriptWatcher` class, after the existing `private rediscoverTimer` line:

```ts
  private subagentDir: string | null = null;
  private subagentOffsets = new Map<string, number>();
```

Add a new private method `computeSubagentDir()` that derives the subagents path from the main transcript path:

```ts
  private computeSubagentDir(): string | null {
    // Main transcript: {dir}/{session-uuid}.jsonl
    // Subagents dir:   {dir}/{session-uuid}/subagents/
    const base = this.filePath.replace(/\.jsonl$/, "");
    const dir = join(base, "subagents");
    return dir;
  }
```

Add a new private method `readSubagentEntries()` that scans the subagents directory and tails each `.jsonl` file:

```ts
  private readSubagentEntries(): void {
    if (!this.subagentDir) {
      this.subagentDir = this.computeSubagentDir();
    }
    if (!this.subagentDir || !existsSync(this.subagentDir)) return;

    let files: string[];
    try {
      files = readdirSync(this.subagentDir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      return;
    }

    for (const file of files) {
      const fullPath = join(this.subagentDir, file);
      const currentOffset = this.subagentOffsets.get(file) ?? 0;

      let fd: number;
      try {
        fd = openSync(fullPath, "r");
      } catch {
        continue;
      }

      try {
        const chunkSize = 65536;
        const buffers: Buffer[] = [];
        let totalRead = 0;

        while (true) {
          const buf = Buffer.allocUnsafe(chunkSize);
          const bytesRead = readSync(fd, buf, 0, chunkSize, currentOffset + totalRead);
          if (bytesRead === 0) break;
          buffers.push(buf.subarray(0, bytesRead));
          totalRead += bytesRead;
          if (bytesRead < chunkSize) break;
        }

        if (totalRead === 0) continue;

        this.subagentOffsets.set(file, currentOffset + totalRead);

        const text = Buffer.concat(buffers).toString("utf-8");
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this.parseLine(trimmed);
        }
      } finally {
        closeSync(fd);
      }
    }
  }
```

Modify the existing `readNewEntries()` method to also read subagent files. Add a call at the end, after the main transcript read completes (after the `finally` block's closing brace, before the method's closing brace):

```ts
  readNewEntries(): void {
    if (!existsSync(this.filePath)) return;

    const fd = openSync(this.filePath, "r");
    try {
      // ... existing chunked read logic (unchanged) ...
    } finally {
      closeSync(fd);
    }

    // Also read any subagent transcript files
    this.readSubagentEntries();
  }
```

Reset subagent state when the transcript switches. In the `rediscover()` method, after `this.offset = 0;` add:

```ts
    this.subagentDir = null;
    this.subagentOffsets.clear();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/bridge/transcript-watcher.test.ts`
Expected: PASS — all existing tests plus the new subagent tests

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add bridge/transcript-watcher.ts tests/bridge/transcript-watcher.test.ts
git commit -m "feat(bridge): track subagent transcript files for per-model usage"
```

---

### Task 2: Manual Verification

- [ ] **Step 1: Build and start the server**

Run: `bun run build:client && bash scripts/stop.sh; bash scripts/start.sh`

- [ ] **Step 2: Verify subagent usage appears in the browser**

Open the trayce canvas URL. Trigger a workflow that dispatches subagents (e.g. use a skill that dispatches Explore or implementation agents). Check the Usage tab:

- The Models section should show entries for each model used (e.g. `opus 4 6`, `sonnet 4 6`, `haiku 4 5 20251001`)
- Each model row should show token count and request count
- Subagent tokens should increment as subagents run

- [ ] **Step 3: Verify no regressions**

- Main session usage (Opus) should still be tracked correctly
- Transcript tab should still show entries from the main session
- No errors in server or bridge console output related to subagent file access
