# Usage Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface real-time token usage, cost estimates, cache efficiency, and tool call frequency in the Trayce side panel, using data already present in Claude Code's JSONL conversation files.

**Architecture:** The existing TranscriptWatcher extracts `message.usage` from assistant JSONL entries and emits `usage-update` messages through the bridge-server-browser WebSocket pipeline. The server accumulates per-session usage into a `SessionUsage` snapshot (not raw event buffering). When a browser sends `watch-session`, the server sends the current snapshot; live updates are forwarded as deltas. The client renders a Usage tab alongside Response and Transcript.

**Tech Stack:** TypeScript, Bun runtime, WebSocket, vanilla DOM (no framework)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/usage.ts` | Create | `SessionUsage` accumulator class -- aggregates token counts, model breakdown, cost estimates |
| `server/websocket.ts` | Modify | Route `usage-update` from bridges, accumulate in `SessionUsage`, send snapshot on `watch-session`, cleanup on disconnect |
| `bridge/transcript-watcher.ts` | Modify | Extract `message.usage` + `message.model` from assistant entries, emit via new callback |
| `bridge/index.ts` | Modify | Forward usage data as `usage-update` WebSocket messages |
| `client/usage-tab.ts` | Create | `UsageTab` class -- renders token totals, cost estimate, cache efficiency, model breakdown |
| `client/pricing.ts` | Create | Claude model pricing table and cost calculation helper |
| `client/side-panel.ts` | Modify | Add third "usage" tab and content area |
| `client/toolbar.ts` | Modify | Add "usage" to `PanelId` type and `PANEL_BUTTONS` array |
| `client/app.ts` | Modify | Wire `UsageTab`, handle `usage-snapshot` and `usage-update` messages, mount eagerly |
| `client/style.css` | Modify | Styles for usage tab content |
| `tests/server/usage.test.ts` | Create | Unit tests for `SessionUsage` accumulator |
| `tests/server/websocket.test.ts` | Modify | Tests for usage routing, snapshot on watch-session, cleanup |
| `tests/bridge/transcript-watcher.test.ts` | Modify | Tests for usage extraction from JSONL entries |

---

### Task 1: Create the pricing module

**Files:**
- Create: `client/pricing.ts`

- [ ] **Step 1: Create the pricing module**

```typescript
// client/pricing.ts

export interface ModelPricing {
  input: number;        // $ per million tokens
  output: number;       // $ per million tokens
  cacheRead: number;    // $ per million tokens
  cacheWrite: number;   // $ per million tokens (1-hour ephemeral)
}

// Prices per million tokens (as of March 2026)
const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6":   { input: 5,   output: 25, cacheRead: 0.50, cacheWrite: 10 },
  "claude-sonnet-4-6": { input: 3,   output: 15, cacheRead: 0.30, cacheWrite: 6 },
  "claude-haiku-4-5":  { input: 1,   output: 5,  cacheRead: 0.10, cacheWrite: 2 },
};

// Fallback for unknown models -- use Sonnet pricing as a reasonable middle ground
const DEFAULT_PRICING: ModelPricing = MODEL_PRICING["claude-sonnet-4-6"];

export function getPricing(model: string): ModelPricing {
  // Try exact match first, then prefix match (handles version suffixes)
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key.replace(/-\d+-\d+$/, ""))) return pricing;
  }
  return DEFAULT_PRICING;
}

export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requestCount: number;
  models: Record<string, { inputTokens: number; outputTokens: number; requests: number }>;
  firstTimestamp: number;
  lastTimestamp: number;
}

export function estimateCost(snapshot: UsageSnapshot): number {
  let total = 0;
  for (const [model, data] of Object.entries(snapshot.models)) {
    const p = getPricing(model);
    total += (data.inputTokens / 1_000_000) * p.input;
    total += (data.outputTokens / 1_000_000) * p.output;
  }
  // Cache costs are not broken down by model in the usage data,
  // so apply the primary model's pricing (model with most requests)
  const primaryModel = Object.entries(snapshot.models)
    .sort((a, b) => b[1].requests - a[1].requests)[0]?.[0] ?? "";
  const pp = getPricing(primaryModel);
  total += (snapshot.cacheReadTokens / 1_000_000) * pp.cacheRead;
  total += (snapshot.cacheWriteTokens / 1_000_000) * pp.cacheWrite;
  return total;
}

export function formatCost(dollars: number): string {
  if (dollars < 0.01) return "<$0.01";
  return "$" + dollars.toFixed(4);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
```

- [ ] **Step 2: Run build to verify no syntax errors**

Run: `bun build client/pricing.ts --outdir /tmp/trayce-check --target browser 2>&1`
Expected: Builds without errors.

- [ ] **Step 3: Commit**

```bash
git add client/pricing.ts
git commit -m "feat(client): add Claude model pricing table and cost helpers"
```

---

### Task 2: Create the SessionUsage accumulator

**Files:**
- Create: `server/usage.ts`
- Create: `tests/server/usage.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/server/usage.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { SessionUsage, type UsageUpdate } from "../../server/usage";

function makeUpdate(overrides: Partial<UsageUpdate> = {}): UsageUpdate {
  return {
    inputTokens: 10,
    outputTokens: 50,
    cacheReadTokens: 100,
    cacheWriteTokens: 5,
    model: "claude-opus-4-6",
    timestamp: 1000000,
    ...overrides,
  };
}

describe("SessionUsage", () => {
  it("starts with zero snapshot", () => {
    const usage = new SessionUsage();
    const snap = usage.snapshot();
    expect(snap.inputTokens).toBe(0);
    expect(snap.outputTokens).toBe(0);
    expect(snap.cacheReadTokens).toBe(0);
    expect(snap.cacheWriteTokens).toBe(0);
    expect(snap.requestCount).toBe(0);
    expect(Object.keys(snap.models)).toHaveLength(0);
  });

  it("accumulates token counts from updates", () => {
    const usage = new SessionUsage();
    usage.add(makeUpdate({ inputTokens: 10, outputTokens: 50 }));
    usage.add(makeUpdate({ inputTokens: 20, outputTokens: 30 }));
    const snap = usage.snapshot();
    expect(snap.inputTokens).toBe(30);
    expect(snap.outputTokens).toBe(80);
    expect(snap.requestCount).toBe(2);
  });

  it("tracks cache tokens separately", () => {
    const usage = new SessionUsage();
    usage.add(makeUpdate({ cacheReadTokens: 500, cacheWriteTokens: 100 }));
    usage.add(makeUpdate({ cacheReadTokens: 300, cacheWriteTokens: 50 }));
    const snap = usage.snapshot();
    expect(snap.cacheReadTokens).toBe(800);
    expect(snap.cacheWriteTokens).toBe(150);
  });

  it("tracks per-model breakdown", () => {
    const usage = new SessionUsage();
    usage.add(makeUpdate({ model: "claude-opus-4-6", inputTokens: 10, outputTokens: 50 }));
    usage.add(makeUpdate({ model: "claude-haiku-4-5", inputTokens: 5, outputTokens: 20 }));
    usage.add(makeUpdate({ model: "claude-opus-4-6", inputTokens: 15, outputTokens: 30 }));
    const snap = usage.snapshot();
    expect(Object.keys(snap.models)).toHaveLength(2);
    expect(snap.models["claude-opus-4-6"].inputTokens).toBe(25);
    expect(snap.models["claude-opus-4-6"].outputTokens).toBe(80);
    expect(snap.models["claude-opus-4-6"].requests).toBe(2);
    expect(snap.models["claude-haiku-4-5"].requests).toBe(1);
  });

  it("tracks first and last timestamp", () => {
    const usage = new SessionUsage();
    usage.add(makeUpdate({ timestamp: 1000 }));
    usage.add(makeUpdate({ timestamp: 5000 }));
    usage.add(makeUpdate({ timestamp: 3000 }));
    const snap = usage.snapshot();
    expect(snap.firstTimestamp).toBe(1000);
    expect(snap.lastTimestamp).toBe(5000);
  });

  it("serializes snapshot to JSON", () => {
    const usage = new SessionUsage();
    usage.add(makeUpdate());
    const json = usage.toJSON();
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("usage-snapshot");
    expect(parsed.usage.inputTokens).toBe(10);
    expect(parsed.usage.requestCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/server/usage.test.ts`
Expected: FAIL -- module not found.

- [ ] **Step 3: Create the SessionUsage class**

Create `server/usage.ts`:

```typescript
export interface UsageUpdate {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  timestamp: number;
}

export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requestCount: number;
  models: Record<string, { inputTokens: number; outputTokens: number; requests: number }>;
  firstTimestamp: number;
  lastTimestamp: number;
}

export class SessionUsage {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private requestCount = 0;
  private models: Record<string, { inputTokens: number; outputTokens: number; requests: number }> = {};
  private firstTimestamp = 0;
  private lastTimestamp = 0;

  add(update: UsageUpdate): void {
    this.inputTokens += update.inputTokens;
    this.outputTokens += update.outputTokens;
    this.cacheReadTokens += update.cacheReadTokens;
    this.cacheWriteTokens += update.cacheWriteTokens;
    this.requestCount++;

    if (!this.models[update.model]) {
      this.models[update.model] = { inputTokens: 0, outputTokens: 0, requests: 0 };
    }
    this.models[update.model].inputTokens += update.inputTokens;
    this.models[update.model].outputTokens += update.outputTokens;
    this.models[update.model].requests++;

    if (this.firstTimestamp === 0 || update.timestamp < this.firstTimestamp) {
      this.firstTimestamp = update.timestamp;
    }
    if (update.timestamp > this.lastTimestamp) {
      this.lastTimestamp = update.timestamp;
    }
  }

  snapshot(): UsageSnapshot {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      requestCount: this.requestCount,
      models: { ...this.models },
      firstTimestamp: this.firstTimestamp,
      lastTimestamp: this.lastTimestamp,
    };
  }

  toJSON(): string {
    return JSON.stringify({ type: "usage-snapshot", usage: this.snapshot() });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/server/usage.test.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add server/usage.ts tests/server/usage.test.ts
git commit -m "feat(server): add SessionUsage accumulator with tests"
```

---

### Task 3: Emit usage data from TranscriptWatcher

**Files:**
- Modify: `bridge/transcript-watcher.ts`
- Modify: `tests/bridge/transcript-watcher.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of the `describe("TranscriptWatcher", ...)` block in `tests/bridge/transcript-watcher.test.ts`:

```typescript
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
    const watcher = new TranscriptWatcher(TEST_FILE, () => {}, (usage) => usageUpdates.push(usage));
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
    const watcher = new TranscriptWatcher(TEST_FILE, () => {}, (usage) => usageUpdates.push(usage));
    watcher.readNewEntries();

    expect(usageUpdates).toHaveLength(0);
  });

  test("usage callback is optional (backwards compatible)", () => {
    writeFileSync(TEST_FILE, ASSISTANT_MSG + "\n");

    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (entry) => entries.push(entry));
    watcher.readNewEntries();

    expect(entries).toHaveLength(1); // still works without usage callback
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/bridge/transcript-watcher.test.ts`
Expected: New tests fail (constructor signature mismatch or missing callback).

- [ ] **Step 3: Add usage callback to TranscriptWatcher**

In `bridge/transcript-watcher.ts`, add a `UsageData` interface after the `TranscriptEntry` interface:

```typescript
export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  timestamp: number;
}
```

Modify the `TranscriptWatcher` class to accept an optional third constructor parameter. Change the fields and constructor:

```typescript
  private onUsage?: (usage: UsageData) => void;

  constructor(
    filePath: string,
    onEntry: (entry: TranscriptEntry) => void,
    onUsage?: (usage: UsageData) => void,
  ) {
    this.filePath = filePath;
    this.onEntry = onEntry;
    this.onUsage = onUsage;
  }
```

At the end of `parseLine`, after the content block `for` loop but before the closing `}` of the method, add usage extraction:

```typescript
    // Emit usage data for assistant messages
    if (this.onUsage && raw.type === "assistant") {
      const usage = (msg as any).usage;
      const model = (msg as any).model;
      if (usage && typeof usage.output_tokens === "number") {
        this.onUsage({
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          model: typeof model === "string" ? model : "unknown",
          timestamp,
        });
      }
    }
```

Note: The `message` field in Claude Code JSONL contains both `role`/`content` AND `model`/`usage` on the same object. The `ClaudeCodeLine` interface only types `role` and `content`, so we cast to `any` for the usage fields.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/bridge/transcript-watcher.test.ts`
Expected: All tests pass including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add bridge/transcript-watcher.ts tests/bridge/transcript-watcher.test.ts
git commit -m "feat(bridge): extract usage data from Claude Code JSONL entries"
```

---

### Task 4: Forward usage data through the bridge

**Files:**
- Modify: `bridge/index.ts:77-88` (startTranscriptWatcher function)

- [ ] **Step 1: Add usage forwarding to startTranscriptWatcher**

In `bridge/index.ts`, update the import to include `UsageData`:

```typescript
import { TranscriptWatcher, discoverTranscriptPath, type TranscriptEntry, type UsageData } from "./transcript-watcher";
```

Replace the `TranscriptWatcher` instantiation (the `new TranscriptWatcher(...)` call) with a version that passes the usage callback:

```typescript
  transcriptWatcher = new TranscriptWatcher(
    transcriptPath,
    (entry: TranscriptEntry) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "transcript-entry", entry }));
      if (entry.type === "response") {
        ws.send(JSON.stringify({
          type: "response",
          content: entry.content,
          timestamp: entry.timestamp,
          format: "markdown",
          final: true,
        }));
      }
    },
    (usage: UsageData) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "usage-update", usage }));
    },
  );
```

- [ ] **Step 2: Verify the bridge compiles**

Run: `timeout 3 bun run bridge/index.ts 2>&1 || true`
Expected: No compilation errors (will timeout because it tries to connect to server).

- [ ] **Step 3: Commit**

```bash
git add bridge/index.ts
git commit -m "feat(bridge): forward usage-update messages to server"
```

---

### Task 5: Route usage through the server

**Files:**
- Modify: `server/websocket.ts`
- Modify: `tests/server/websocket.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/websocket.test.ts`, in a new `describe("usage routing", ...)` block at the end:

```typescript
// -- Usage routing --

describe("usage routing", () => {
  it("accumulates usage-update and sends snapshot on watch-session", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));

    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "usage-update",
      usage: { inputTokens: 10, outputTokens: 50, cacheReadTokens: 200, cacheWriteTokens: 30, model: "claude-opus-4-6", timestamp: 1000 },
    }));
    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "usage-update",
      usage: { inputTokens: 20, outputTokens: 30, cacheReadTokens: 100, cacheWriteTokens: 10, model: "claude-opus-4-6", timestamp: 2000 },
    }));

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session", sessionId: "s1" }));

    const snapshots = allSentOfType(browser, "usage-snapshot");
    expect(snapshots).toHaveLength(1);
    const usage = snapshots[0].usage as any;
    expect(usage.inputTokens).toBe(30);
    expect(usage.outputTokens).toBe(80);
    expect(usage.cacheReadTokens).toBe(300);
    expect(usage.requestCount).toBe(2);
  });

  it("forwards live usage-update to watching browsers", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    const browser = browserWs();
    hub.addBridge(bridge as any);
    hub.addBrowser(browser as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));
    await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session", sessionId: "s1" }));
    browser.sent.length = 0;

    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "usage-update",
      usage: { inputTokens: 5, outputTokens: 25, cacheReadTokens: 50, cacheWriteTokens: 0, model: "claude-opus-4-6", timestamp: 3000 },
    }));

    const updates = allSentOfType(browser, "usage-update");
    expect(updates).toHaveLength(1);
    expect((updates[0].usage as any).outputTokens).toBe(25);
  });

  it("cleans up usage when bridge disconnects", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));

    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "usage-update",
      usage: { inputTokens: 10, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, model: "claude-opus-4-6", timestamp: 1000 },
    }));

    hub.removeBridge(bridge as any);

    // Re-register, watch -- should get empty snapshot
    const bridge2 = bridgeWs();
    hub.addBridge(bridge2 as any);
    await hub.handleMessage(bridge2 as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session", sessionId: "s1" }));

    const snapshots = allSentOfType(browser, "usage-snapshot");
    expect(snapshots).toHaveLength(1);
    expect((snapshots[0].usage as any).requestCount).toBe(0);
  });

  it("sends empty snapshot when no usage data exists", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session", sessionId: "s1" }));

    const snapshots = allSentOfType(browser, "usage-snapshot");
    expect(snapshots).toHaveLength(1);
    expect((snapshots[0].usage as any).requestCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/server/websocket.test.ts`
Expected: New usage tests fail. Existing tests still pass.

- [ ] **Step 3: Implement usage routing in WebSocketHub**

In `server/websocket.ts`, add the import at the top:

```typescript
import { SessionUsage } from "./usage";
```

Add a new field after `sessionBuffers`:

```typescript
private readonly sessionUsage = new Map<string, SessionUsage>();
```

Add `"usage-update"` to `BRIDGE_ROUTED_TYPES`:

```typescript
const BRIDGE_ROUTED_TYPES = ["transcript-entry", "response", "canvas-push", "transcript-status", "usage-update"];
```

In the bridge routing block, add usage accumulation BEFORE the existing buffering logic (after `const payload = ...`):

```typescript
      // Accumulate usage data
      if (msg.type === "usage-update" && msg.usage) {
        let usage = this.sessionUsage.get(sessionId);
        if (!usage) {
          usage = new SessionUsage();
          this.sessionUsage.set(sessionId, usage);
        }
        const u = msg.usage as any;
        usage.add({
          inputTokens: u.inputTokens ?? 0,
          outputTokens: u.outputTokens ?? 0,
          cacheReadTokens: u.cacheReadTokens ?? 0,
          cacheWriteTokens: u.cacheWriteTokens ?? 0,
          model: u.model ?? "unknown",
          timestamp: u.timestamp ?? Date.now(),
        });
      }
```

In the `watch-session` handler, after the buffer replay loop, add usage snapshot:

```typescript
        // Send current usage snapshot
        const usage = this.sessionUsage.get(sid) ?? new SessionUsage();
        safeSend(ws, usage.toJSON());
```

In `removeBridge`, add cleanup alongside `sessionBuffers.delete`:

```typescript
        this.sessionUsage.delete(sessionId);
```

In `handleRegister`, add cleanup alongside each `sessionBuffers.delete` call (there are two -- one for re-registration cleanup, one for eviction cleanup):

```typescript
        this.sessionUsage.delete(ws.data.sessionId);  // first cleanup
```

```typescript
        this.sessionUsage.delete(sessionId);            // eviction cleanup
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/server/websocket.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Run the full server + bridge test suite**

Run: `bun test tests/server/ tests/bridge/`
Expected: All pass (except pre-existing integration test PATH issue).

- [ ] **Step 6: Commit**

```bash
git add server/websocket.ts tests/server/websocket.test.ts
git commit -m "feat(server): route usage-update messages and send snapshots on watch-session"
```

---

### Task 6: Add Usage tab to the side panel and toolbar

**Files:**
- Modify: `client/toolbar.ts:3,31-34` (PanelId type and PANEL_BUTTONS)
- Modify: `client/side-panel.ts:1,9-10,53-61,88-94,120-127` (PanelTab type, usage content area, show/hide)

- [ ] **Step 1: Add "usage" to toolbar PanelId and PANEL_BUTTONS**

In `client/toolbar.ts`, change line 3:

```typescript
export type PanelId = "response" | "transcript" | "usage";
```

Add to `PANEL_BUTTONS` array (after the transcript entry):

```typescript
  { id: "usage", icon: "\uD83D\uDCC8", title: "Usage Panel" },
```

- [ ] **Step 2: Add "usage" tab to SidePanel**

In `client/side-panel.ts`, change line 1:

```typescript
export type PanelTab = "response" | "transcript" | "usage";
```

Add a field after `transcriptContent`:

```typescript
  private usageContent: HTMLElement | null = null;
```

In the `mount` method, after the transcript button creation (before `closeBtn`), add a usage button:

```typescript
    const usageBtn = document.createElement("button");
    usageBtn.className = "panel-tab";
    usageBtn.dataset.tab = "usage";
    usageBtn.textContent = "Usage";
    usageBtn.addEventListener("click", () => this.toggle("usage"));
```

Add `usageBtn` to the tab bar (insert `this.tabBar.appendChild(usageBtn);` before `this.tabBar.appendChild(closeBtn);`).

After the transcript content area creation, add:

```typescript
    // Usage content area
    this.usageContent = document.createElement("div");
    this.usageContent.className = "panel-content usage-content";
    container.appendChild(this.usageContent);
```

Add a getter after `getTranscriptContainer`:

```typescript
  getUsageContainer(): HTMLElement | null {
    return this.usageContent;
  }
```

In `updateDOM`, add usage content show/hide alongside the existing response/transcript blocks:

```typescript
    if (this.usageContent) {
      this.usageContent.style.display =
        this.isOpen && this.activeTab === "usage" ? "" : "none";
    }
```

- [ ] **Step 3: Build to verify no errors**

Run: `bun build client/app.ts --outdir /tmp/trayce-check --target browser 2>&1`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add client/toolbar.ts client/side-panel.ts
git commit -m "feat(client): add Usage tab to side panel and toolbar"
```

---

### Task 7: Create the UsageTab component

**Files:**
- Create: `client/usage-tab.ts`
- Modify: `client/style.css`

- [ ] **Step 1: Create the UsageTab class**

Create `client/usage-tab.ts`:

```typescript
import { estimateCost, formatCost, formatTokens, type UsageSnapshot } from "./pricing";

const EMPTY_SNAPSHOT: UsageSnapshot = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  requestCount: 0,
  models: {},
  firstTimestamp: 0,
  lastTimestamp: 0,
};

export class UsageTab {
  private container: HTMLElement | null = null;
  private snapshot: UsageSnapshot = { ...EMPTY_SNAPSHOT, models: {} };

  mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  /** Replace the entire snapshot (on watch-session / session switch). */
  setSnapshot(snapshot: UsageSnapshot): void {
    this.snapshot = snapshot;
    this.render();
  }

  /** Incrementally add a single usage update (live). */
  addUpdate(usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    model: string;
    timestamp: number;
  }): void {
    this.snapshot.inputTokens += usage.inputTokens;
    this.snapshot.outputTokens += usage.outputTokens;
    this.snapshot.cacheReadTokens += usage.cacheReadTokens;
    this.snapshot.cacheWriteTokens += usage.cacheWriteTokens;
    this.snapshot.requestCount++;

    if (!this.snapshot.models[usage.model]) {
      this.snapshot.models[usage.model] = { inputTokens: 0, outputTokens: 0, requests: 0 };
    }
    this.snapshot.models[usage.model].inputTokens += usage.inputTokens;
    this.snapshot.models[usage.model].outputTokens += usage.outputTokens;
    this.snapshot.models[usage.model].requests++;

    if (this.snapshot.firstTimestamp === 0 || usage.timestamp < this.snapshot.firstTimestamp) {
      this.snapshot.firstTimestamp = usage.timestamp;
    }
    if (usage.timestamp > this.snapshot.lastTimestamp) {
      this.snapshot.lastTimestamp = usage.timestamp;
    }

    this.render();
  }

  clear(): void {
    this.snapshot = { ...EMPTY_SNAPSHOT, models: {} };
    this.render();
  }

  private render(): void {
    if (!this.container) return;
    const s = this.snapshot;
    const cost = estimateCost(s);
    const totalInput = s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens;
    const cacheHitRate = totalInput > 0
      ? Math.round((s.cacheReadTokens / totalInput) * 100)
      : 0;

    const duration = s.lastTimestamp && s.firstTimestamp
      ? Math.max(1, Math.round((s.lastTimestamp - s.firstTimestamp) / 1000))
      : 0;
    const tokPerSec = duration > 0
      ? ((s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens) / duration).toFixed(1)
      : "--";

    // Build DOM safely using createElement + textContent (no innerHTML)
    this.container.textContent = "";

    this.addSection("Cost Estimate", (section) => {
      const costEl = document.createElement("div");
      costEl.className = "usage-cost";
      costEl.textContent = formatCost(cost);
      section.appendChild(costEl);

      const detail = document.createElement("div");
      detail.className = "usage-detail";
      detail.textContent = s.requestCount + " requests";
      section.appendChild(detail);
    });

    this.addSection("Tokens", (section) => {
      const grid = document.createElement("div");
      grid.className = "usage-grid";
      const pairs: [string, number][] = [
        ["Input", s.inputTokens],
        ["Output", s.outputTokens],
        ["Cache read", s.cacheReadTokens],
        ["Cache write", s.cacheWriteTokens],
      ];
      for (const [label, value] of pairs) {
        const labelEl = document.createElement("span");
        labelEl.className = "usage-label";
        labelEl.textContent = label;
        const valueEl = document.createElement("span");
        valueEl.className = "usage-value";
        valueEl.textContent = formatTokens(value);
        grid.appendChild(labelEl);
        grid.appendChild(valueEl);
      }
      section.appendChild(grid);
    });

    this.addSection("Cache Efficiency", (section) => {
      const barContainer = document.createElement("div");
      barContainer.className = "usage-bar-container";
      const bar = document.createElement("div");
      bar.className = "usage-bar";
      bar.style.width = cacheHitRate + "%";
      barContainer.appendChild(bar);
      section.appendChild(barContainer);

      const detail = document.createElement("div");
      detail.className = "usage-detail";
      detail.textContent = cacheHitRate + "% cache hit rate";
      section.appendChild(detail);
    });

    this.addSection("Rate", (section) => {
      const detail = document.createElement("div");
      detail.className = "usage-detail";
      detail.textContent = tokPerSec + " tokens/sec" + (duration > 0 ? " over " + duration + "s" : "");
      section.appendChild(detail);
    });

    const modelEntries = Object.entries(s.models).sort((a, b) => b[1].requests - a[1].requests);
    if (modelEntries.length > 0) {
      this.addSection("Models", (section) => {
        for (const [model, data] of modelEntries) {
          const row = document.createElement("div");
          row.className = "usage-model-row";
          const nameEl = document.createElement("span");
          nameEl.className = "usage-model-name";
          nameEl.textContent = model.replace("claude-", "").replace(/-/g, " ");
          const statEl = document.createElement("span");
          statEl.className = "usage-model-stat";
          statEl.textContent = formatTokens(data.inputTokens + data.outputTokens) + " tok / " + data.requests + " req";
          row.appendChild(nameEl);
          row.appendChild(statEl);
          section.appendChild(row);
        }
      });
    }
  }

  private addSection(title: string, populate: (section: HTMLElement) => void): void {
    if (!this.container) return;
    const section = document.createElement("div");
    section.className = "usage-section";
    const heading = document.createElement("div");
    heading.className = "usage-heading";
    heading.textContent = title;
    section.appendChild(heading);
    populate(section);
    this.container.appendChild(section);
  }
}
```

- [ ] **Step 2: Add CSS for the usage tab**

Add to `client/style.css`, before the `/* -- Bottom Bar -- */` comment:

```css
/* -- Usage Tab -- */

.usage-section {
  margin-bottom: 16px;
}

.usage-heading {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.usage-cost {
  font-size: 22px;
  font-weight: 700;
  color: var(--accent);
  margin-bottom: 2px;
}

.usage-grid {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 12px;
}

.usage-label {
  color: var(--text-muted);
}

.usage-value {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.usage-bar-container {
  height: 6px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
  margin: 4px 0;
}

.usage-bar {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.usage-detail {
  color: var(--text-muted);
  font-size: 11px;
}

.usage-model-row {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
}

.usage-model-name {
  text-transform: capitalize;
}

.usage-model-stat {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Build to verify**

Run: `bun build client/app.ts --outdir /tmp/trayce-check --target browser 2>&1`
Expected: Builds (UsageTab isn't wired yet but should compile independently).

- [ ] **Step 4: Commit**

```bash
git add client/usage-tab.ts client/style.css
git commit -m "feat(client): create UsageTab component with cost, tokens, cache, and model views"
```

---

### Task 8: Wire UsageTab into app.ts

**Files:**
- Modify: `client/app.ts`

- [ ] **Step 1: Add UsageTab import and state**

In `client/app.ts`, add import:

```typescript
import { UsageTab } from "./usage-tab";
```

After the `let transcriptTab: TranscriptTab | null = null;` declaration, add:

```typescript
let usageTab: UsageTab | null = null;
```

- [ ] **Step 2: Instantiate and mount UsageTab in initUIComponents**

In `initUIComponents`, after `transcriptTab = new TranscriptTab();`:

```typescript
  usageTab = new UsageTab();
```

In the eager mounting block (after the transcriptContainer mount), add:

```typescript
  const usageContainer = sidePanel.getUsageContainer();
  if (usageContainer) {
    usageTab.mount(usageContainer);
    usageContainer.dataset.mounted = "true";
  }
```

In the `onPanelToggle` callback, add alongside the existing response/transcript mount checks:

```typescript
        const usageContainer = sidePanel.getUsageContainer();
        if (usageContainer && usageTab && !usageContainer.dataset.mounted) {
          usageTab.mount(usageContainer);
          usageContainer.dataset.mounted = "true";
        }
```

- [ ] **Step 3: Handle usage messages in handleServerMessage**

In `handleServerMessage`, add two new cases after the `transcript-status` handler:

```typescript
  } else if (msg.type === "usage-snapshot") {
    usageTab?.setSnapshot(msg.usage as any);
  } else if (msg.type === "usage-update") {
    usageTab?.addUpdate(msg.usage as any);
  }
```

- [ ] **Step 4: Clear usage on session switch**

In the `sessionSelect` change handler, add alongside the existing clear calls:

```typescript
  usageTab?.clear();
```

- [ ] **Step 5: Build and verify**

Run: `bun build client/app.ts --outdir dist/client --minify --target browser && cp client/index.html client/style.css dist/client/`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add client/app.ts
git commit -m "feat(client): wire UsageTab to handle usage-snapshot and usage-update messages"
```

---

### Task 9: Integration test

- [ ] **Step 1: Run the full test suite**

Run: `bun test tests/server/ tests/bridge/ tests/client/`
Expected: All pass (except pre-existing integration test PATH issue).

- [ ] **Step 2: Restart the trayce server**

```bash
kill $(cat /tmp/trayce/state.json | python3 -c "import sys,json; print(json.load(sys.stdin)['pid'])") 2>/dev/null
sleep 1
nohup bun run server/index.ts > /tmp/trayce/server.log 2>&1 &
sleep 2
cat /tmp/trayce/state.json
```

- [ ] **Step 3: Manual verification**

Open the browser with the URL from `state.json`. Start or connect to a Claude Code session with `--dangerously-load-development-channels server:trayce`. Generate some activity. Verify:

1. The Usage tab appears in the side panel toolbar (chart icon)
2. Clicking it shows token totals, cost estimate, cache efficiency
3. Values update in real-time as Claude processes requests
4. Switching sessions resets and loads the new session's usage
5. Cache hit rate bar reflects actual cache utilization
6. Model breakdown shows which models were used
