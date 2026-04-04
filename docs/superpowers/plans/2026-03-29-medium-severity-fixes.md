# Medium Severity Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all 12 medium-severity issues identified in the code-to-docs health report across Server, Bridge, and Client modules.

**Architecture:** Fixes are scoped per-module and per-issue. Most changes are localized (1-2 files + test file). No new modules or dependencies are introduced. The three modules (Server, Bridge, Client) have zero cross-module imports, so all module-level tasks are independent and parallelizable.

**Tech Stack:** TypeScript, Bun runtime, Bun test runner. Server uses Bun native HTTP/WebSocket. Bridge uses `@modelcontextprotocol/sdk`. Client uses PixiJS + perfect-freehand.

---

## File Map

| Task | Create | Modify | Test |
|------|--------|--------|------|
| 1. Compositor per-layer dirty tracking | | `client/compositor.ts`, `client/layers.ts` | `tests/client/layers.test.ts` |
| 2. Bridge rate limiting | | `server/websocket.ts` | `tests/server/websocket.test.ts` |
| 3. Submit ack without bridge | | `server/websocket.ts` | `tests/server/websocket.test.ts` |
| 4. Buffer canvas-push messages | | `server/websocket.ts` | `tests/server/websocket.test.ts` |
| 5. JSONL partial line handling | | `bridge/transcript-watcher.ts` | `tests/bridge/transcript-watcher.test.ts` |
| 6. Birthtime discovery filter | | `bridge/transcript-watcher.ts` | `tests/bridge/transcript-watcher.test.ts` |
| 7. Bounded transcript scan | | `bridge/transcript-watcher.ts` | `tests/bridge/transcript-watcher.test.ts` |
| 8. State file re-read on reconnect | | `bridge/index.ts` | `tests/bridge/index.test.ts` |
| 9. Persistence saves transforms | | `client/persistence.ts` | `tests/client/persistence.test.ts` |
| 10. duplicateLayer copies all props | | `client/layers.ts` | `tests/client/layers.test.ts` |
| 11. Wire undo/redo shortcuts | | `client/app.ts` | (manual — app.ts is not unit-testable) |
| 12. Heartbeat interval leak | | `bridge/index.ts` | `tests/bridge/index.test.ts` |

---

## Task 1: Compositor Per-Layer Dirty Tracking

**Issue:** `client-texture-per-frame-churn` — Every `update()` creates new `ImageSource`/`Texture` for all layers, even unchanged ones.

**Files:**
- Modify: `client/layers.ts:14-27` (add revision counter to Layer)
- Modify: `client/compositor.ts:17-18` (track last-seen revisions, skip unchanged)
- Test: `tests/client/layers.test.ts`

- [ ] **Step 1: Add `revision` field to Layer interface and `bumpRevision` helper**

In `client/layers.ts`, add `revision: number` to the `Layer` interface and initialize it to `0` in `createLayer()`:

```typescript
// In Layer interface, after `transform?: LayerTransform;`
revision: number;
```

```typescript
// In createLayer(), add to the returned object:
revision: 0,
```

Add a helper method to LayerManager:

```typescript
bumpRevision(layerId: string): void {
  const layer = this.layers.find(l => l.id === layerId);
  if (layer) layer.revision++;
}
```

- [ ] **Step 2: Write test for revision tracking**

In `tests/client/layers.test.ts`, add:

```typescript
describe("revision tracking", () => {
  test("new layers start at revision 0", () => {
    const lm = new LayerManager(100, 100, "white");
    expect(lm.layers[0].revision).toBe(0);
  });

  test("bumpRevision increments revision counter", () => {
    const lm = new LayerManager(100, 100, "white");
    const layer = lm.addLayer("Test");
    lm.bumpRevision(layer.id);
    expect(layer.revision).toBe(1);
    lm.bumpRevision(layer.id);
    expect(layer.revision).toBe(2);
  });

  test("bumpRevision is no-op for unknown id", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.bumpRevision("nonexistent"); // should not throw
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/client/layers.test.ts`
Expected: FAIL — `revision` not yet on Layer

- [ ] **Step 4: Implement the Layer revision field and bumpRevision**

Apply the changes from Step 1 to `client/layers.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/client/layers.test.ts`
Expected: PASS

- [ ] **Step 6: Update compositor to skip unchanged layers**

In `client/compositor.ts`, add a revision tracking map alongside sprites:

```typescript
private spriteRevisions = new Map<string, number>();
```

In the `update()` loop, after getting the sprite, check revision:

```typescript
// Create texture only if the layer content changed
const lastRev = this.spriteRevisions.get(layer.id) ?? -1;
if (lastRev !== layer.revision) {
  const source = new ImageSource({ resource: layer.canvas });
  const oldTexture = sprite.texture;
  sprite.texture = new Texture({ source });
  if (oldTexture !== Texture.EMPTY) oldTexture.destroy(true);
  this.spriteRevisions.set(layer.id, layer.revision);
}
```

Remove the unconditional texture creation that's there now. Also clean up `spriteRevisions` when sprites are deleted (in the cleanup loop alongside `this.sprites.delete(id)`):

```typescript
this.spriteRevisions.delete(id);
```

And in `destroy()`:

```typescript
this.spriteRevisions.clear();
```

- [ ] **Step 7: Build client and verify**

Run: `bun run build:client`
Expected: Bundled successfully

- [ ] **Step 8: Commit**

```bash
git add client/compositor.ts client/layers.ts tests/client/layers.test.ts
git commit -m "fix(client): skip texture recreation for unchanged layers via revision counter"
```

---

## Task 2: Bridge Rate Limiting

**Issue:** `server-rate-limit-bridge` — Rate limiting only covers browser connections; bridge connections can flood browsers.

**Files:**
- Modify: `server/websocket.ts:61-75` (add rate bucket for bridges), `server/websocket.ts:151-194` (apply rate check to bridge-routed messages)
- Test: `tests/server/websocket.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/server/websocket.test.ts`, add a describe block:

```typescript
describe("bridge rate limiting", () => {
  it("rate-limits bridge-routed messages", async () => {
    const { hub, registry } = makeFixture({ rateLimitPerMinute: 3 });
    const browser = browserWs();
    const bridge = bridgeWs();
    hub.addBrowser(browser as any);
    hub.addBridge(bridge as any);

    // Register bridge
    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "register", sessionId: "s1", label: "test",
    }));

    // Browser watches the session
    await hub.handleMessage(browser as any, JSON.stringify({
      type: "watch-session", sessionId: "s1",
    }));

    // Send 3 transcript entries — should all arrive
    for (let i = 0; i < 3; i++) {
      await hub.handleMessage(bridge as any, JSON.stringify({
        type: "transcript-entry", entry: { content: `msg ${i}` },
      }));
    }
    const delivered = allSentOfType(browser, "transcript-entry");
    expect(delivered.length).toBe(3);

    // 4th should be dropped
    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "transcript-entry", entry: { content: "blocked" },
    }));
    const afterLimit = allSentOfType(browser, "transcript-entry");
    expect(afterLimit.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/websocket.test.ts -t "bridge rate limiting"`
Expected: FAIL — 4th message gets through (no bridge rate limiting)

- [ ] **Step 3: Implement bridge rate limiting**

In `server/websocket.ts`:

1. In `addBridge()`, add a rate bucket:

```typescript
addBridge(ws: Ws): void {
  this.pendingBridges.set(ws.data.id, ws);
  this.rateBuckets.set(ws.data.id, []);
}
```

2. In `removeBridge()`, clean up the bucket:

```typescript
// Add at the start of removeBridge():
this.rateBuckets.delete(ws.data.id);
```

3. In the bridge-routed message handler (line ~152), add rate check before broadcasting:

```typescript
if (ws.data.kind === "bridge" && BRIDGE_ROUTED_TYPES.includes(msg.type)) {
  if (!this.checkRateLimit(ws.data.id)) return; // <-- add this line
  // ... rest of handler unchanged
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/websocket.test.ts -t "bridge rate limiting"`
Expected: PASS

- [ ] **Step 5: Run full server test suite**

Run: `bun test tests/server/`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add server/websocket.ts tests/server/websocket.test.ts
git commit -m "fix(server): apply rate limiting to bridge-routed messages"
```

---

## Task 3: Submit Ack Without Bridge

**Issue:** `server-submit-ack-no-bridge` — `handleSubmit` acks the browser even when no bridge is connected, creating orphaned submissions.

**Files:**
- Modify: `server/websocket.ts:282-299` (add bridge-presence check, return distinct status)
- Test: `tests/server/websocket.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("submit without bridge", () => {
  it("returns queued status when no bridge is connected", async () => {
    const { hub } = makeFixture();
    const browser = browserWs();
    hub.addBrowser(browser as any);

    await hub.handleMessage(browser as any, JSON.stringify({
      type: "submit",
      targetSessionId: "nonexistent",
      image: TINY_PNG_B64,
      prompt: "test",
    }));

    const ack = lastSent(browser);
    expect(ack.type).toBe("ack");
    expect(ack.status).toBe("queued");
  });

  it("returns delivered status when bridge is connected", async () => {
    const { hub } = makeFixture();
    const browser = browserWs();
    const bridge = bridgeWs();
    hub.addBrowser(browser as any);
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "register", sessionId: "s1", label: "test",
    }));

    await hub.handleMessage(browser as any, JSON.stringify({
      type: "submit",
      targetSessionId: "s1",
      image: TINY_PNG_B64,
      prompt: "test",
    }));

    const msgs = browser.sent.map(s => JSON.parse(s));
    const ack = msgs.find((m: any) => m.type === "ack");
    expect(ack.status).toBe("delivered");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/websocket.test.ts -t "submit without bridge"`
Expected: FAIL — ack has no `status` field

- [ ] **Step 3: Implement status field in ack**

In `server/websocket.ts`, in `handleSubmit()`, replace the ack section (lines ~282-299):

```typescript
// Route to bridge (check it's still connected post-await)
const bridge = this.bridges.get(targetSessionId);
const delivered = !!bridge;
if (bridge) {
  const bridgeMsg: Record<string, unknown> = {
    type: "submission",
    id: submission.id,
    prompt: submission.prompt,
  };
  if (submission.pngPath) bridgeMsg.pngPath = submission.pngPath;
  safeSend(bridge, JSON.stringify(bridgeMsg));
}

// Ack the browser with delivery status
safeSend(ws, JSON.stringify({
  type: "ack",
  submissionId: submission.id,
  timestamp: submission.timestamp,
  status: delivered ? "delivered" : "queued",
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/websocket.test.ts -t "submit without bridge"`
Expected: PASS

- [ ] **Step 5: Run full server test suite**

Run: `bun test tests/server/`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add server/websocket.ts tests/server/websocket.test.ts
git commit -m "fix(server): include delivery status in submit ack"
```

---

## Task 4: Buffer Canvas-Push Messages

**Issue:** `server-canvas-push-not-buffered` — Browsers connecting after a push miss image layers.

**Files:**
- Modify: `server/websocket.ts:38` (add "canvas-push" to BUFFERED_TYPES)
- Test: `tests/server/websocket.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("canvas-push buffering", () => {
  it("replays canvas-push to browsers that watch-session after the push", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    const browser = browserWs();
    hub.addBridge(bridge as any);
    hub.addBrowser(browser as any);

    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "register", sessionId: "s1", label: "test",
    }));

    // Bridge sends canvas-push before browser watches
    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "canvas-push", image: "base64data", label: "test-image",
    }));

    // Browser starts watching — should get the buffered push
    await hub.handleMessage(browser as any, JSON.stringify({
      type: "watch-session", sessionId: "s1",
    }));

    const pushMsgs = allSentOfType(browser, "canvas-push");
    expect(pushMsgs.length).toBe(1);
    expect(pushMsgs[0].label).toBe("test-image");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/websocket.test.ts -t "canvas-push buffering"`
Expected: FAIL — canvas-push not replayed on watch-session

- [ ] **Step 3: Add canvas-push to BUFFERED_TYPES**

In `server/websocket.ts`, line 38:

```typescript
private static readonly BUFFERED_TYPES = new Set(["transcript-entry", "response", "transcript-status", "canvas-push"]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/websocket.test.ts -t "canvas-push buffering"`
Expected: PASS

- [ ] **Step 5: Run full server test suite**

Run: `bun test tests/server/`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add server/websocket.ts tests/server/websocket.test.ts
git commit -m "fix(server): buffer canvas-push messages for late-joining browsers"
```

---

## Task 5: JSONL Partial Line Handling

**Issue:** `bridge-incomplete-jsonl-parsing` — Offset advances past partial lines; incomplete JSON is silently discarded.

**Files:**
- Modify: `bridge/transcript-watcher.ts:136-170` (hold back partial lines using lastIndexOf)
- Test: `tests/bridge/transcript-watcher.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/bridge/transcript-watcher.test.ts`, add:

```typescript
describe("partial line handling", () => {
  test("does not lose entries split across reads", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (e) => entries.push(e));

    // Write first half of a JSONL line (incomplete)
    const fullLine = USER_MSG;
    const half = fullLine.slice(0, Math.floor(fullLine.length / 2));
    writeFileSync(TEST_FILE, half);

    watcher.start();
    await Bun.sleep(100);

    // No entries yet — line is incomplete
    expect(entries.length).toBe(0);

    // Append the second half + newline
    appendFileSync(TEST_FILE, fullLine.slice(Math.floor(fullLine.length / 2)) + "\n");
    await Bun.sleep(100);

    watcher.readNewEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].content).toBe("Hello Claude");

    watcher.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/bridge/transcript-watcher.test.ts -t "partial line"`
Expected: FAIL — watcher advances offset past the partial line, entry is lost

- [ ] **Step 3: Fix readNewEntries to hold back incomplete lines**

In `bridge/transcript-watcher.ts`, in `readNewEntries()`, replace the text parsing block (after `if (totalRead > 0) {`):

```typescript
if (totalRead > 0) {
  const text = Buffer.concat(buffers).toString("utf-8");
  // Find the last complete line boundary
  const lastNewline = text.lastIndexOf("\n");

  if (lastNewline === -1) {
    // No complete line — don't advance offset, retry next poll
  } else {
    // Only advance offset past complete lines
    const completeBytes = Buffer.byteLength(text.slice(0, lastNewline + 1), "utf-8");
    this.offset += completeBytes;

    const completeText = text.slice(0, lastNewline + 1);
    for (const line of completeText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.parseLine(trimmed);
    }
  }
}
```

Apply the same fix to `readSubagentEntries()` — same pattern with `currentOffset`:

```typescript
if (totalRead === 0) continue;

const text = Buffer.concat(buffers).toString("utf-8");
const lastNewline = text.lastIndexOf("\n");

if (lastNewline === -1) {
  // No complete line — don't advance offset
  continue;
}

const completeBytes = Buffer.byteLength(text.slice(0, lastNewline + 1), "utf-8");
this.subagentOffsets.set(file, currentOffset + completeBytes);

const completeText = text.slice(0, lastNewline + 1);
for (const line of completeText.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  this.parseLine(trimmed);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/bridge/transcript-watcher.test.ts -t "partial line"`
Expected: PASS

- [ ] **Step 5: Run full bridge test suite**

Run: `bun test tests/bridge/`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add bridge/transcript-watcher.ts tests/bridge/transcript-watcher.test.ts
git commit -m "fix(bridge): hold back partial JSONL lines instead of advancing past them"
```

---

## Task 6: Birthtime Discovery Filter

**Issue:** `bridge-birthtime-older-files` — `discoverTranscriptByBirthtime` can select files created before the bridge started.

**Files:**
- Modify: `bridge/transcript-watcher.ts:326-351` (filter to files born after `startTime - grace`)
- Test: `tests/bridge/transcript-watcher.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("birthtime discovery filtering", () => {
  test("does not select files created well before startTime", () => {
    // This is tested via the function directly
    // Create a fake .jsonl with a very old birthtime
    const testProjectDir = join(homedir(), ".claude", "projects", "test-birthtime-filter");
    mkdirSync(testProjectDir, { recursive: true });
    const oldFile = join(testProjectDir, "old-session.jsonl");
    writeFileSync(oldFile, '{"type":"user"}\n');

    // The file was created now, but we set startTime far in the future
    const futureStart = Date.now() + 120_000; // 2 minutes from now
    const result = discoverTranscriptByBirthtime(futureStart);

    // Should NOT match — file was created >60s before startTime
    // (birthtime drift > MAX_DRIFT_MS means file predates bridge)
    expect(result).not.toBe(oldFile);

    // Cleanup
    rmSync(testProjectDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test — may already pass due to 60s window**

Run: `bun test tests/bridge/transcript-watcher.test.ts -t "birthtime discovery"`

If it passes, the 60s drift window already covers this. If not, proceed.

- [ ] **Step 3: Restrict birthtime to forward-looking window**

In `bridge/transcript-watcher.ts`, in `discoverTranscriptByBirthtime()`, change the drift calculation to prefer files created *after* startTime (with a small grace window):

```typescript
export function discoverTranscriptByBirthtime(startTime: number): string | null {
  const claudeProjectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeProjectsDir)) return null;

  const GRACE_MS = 2_000; // allow 2s before startTime
  const MAX_AFTER_MS = 60_000; // up to 60s after startTime
  let bestPath: string | null = null;
  let bestDrift = Infinity;

  for (const dir of safeReaddir(claudeProjectsDir)) {
    const projectDir = join(claudeProjectsDir, dir);
    for (const entry of safeReaddir(projectDir)) {
      if (!entry.endsWith(".jsonl")) continue;
      const full = join(projectDir, entry);
      try {
        const stat = statSync(full);
        const born = stat.birthtimeMs;
        // Only consider files born within [startTime - GRACE, startTime + MAX_AFTER]
        if (born < startTime - GRACE_MS || born > startTime + MAX_AFTER_MS) continue;
        const drift = Math.abs(born - startTime);
        if (drift < bestDrift) {
          bestDrift = drift;
          bestPath = full;
        }
      } catch {}
    }
  }

  return bestPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/bridge/transcript-watcher.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add bridge/transcript-watcher.ts tests/bridge/transcript-watcher.test.ts
git commit -m "fix(bridge): restrict birthtime discovery to files created near bridge start"
```

---

## Task 7: Bounded Transcript Scan

**Issue:** `bridge-unbounded-tree-scan` — `discoverTranscriptByBirthtime` scans all project dirs every 3s for the bridge's entire lifetime.

**Files:**
- Modify: `bridge/transcript-watcher.ts:118-134` (add confirmed flag, skip rediscovery once confirmed)
- Test: `tests/bridge/transcript-watcher.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
describe("rediscovery bounds", () => {
  test("stops rediscovering after confirming transcript", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(TEST_FILE, USER_MSG + "\n");

    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, TEST_DIR, Date.now(), (e) => entries.push(e));
    watcher.start();
    await Bun.sleep(100);

    // After parsing at least one entry, transcript is confirmed
    expect(entries.length).toBeGreaterThan(0);
    expect((watcher as any).confirmed).toBe(true);

    watcher.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/bridge/transcript-watcher.test.ts -t "rediscovery bounds"`
Expected: FAIL — no `confirmed` field exists

- [ ] **Step 3: Add confirmed flag**

In `bridge/transcript-watcher.ts`, add to the class:

```typescript
private confirmed = false;
```

In `readNewEntries()`, after successfully parsing at least one line, set:

```typescript
// After the for-loop that calls this.parseLine(), if any line was parsed:
this.confirmed = true;
```

In `rediscover()`, skip if confirmed:

```typescript
private rediscover(): void {
  if (this.confirmed) return;
  // ... rest unchanged
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/bridge/transcript-watcher.test.ts -t "rediscovery bounds"`
Expected: PASS

- [ ] **Step 5: Run full bridge test suite**

Run: `bun test tests/bridge/`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add bridge/transcript-watcher.ts tests/bridge/transcript-watcher.test.ts
git commit -m "fix(bridge): stop rediscovering transcript once first entry is parsed"
```

---

## Task 8: State File Re-Read on Reconnect

**Issue:** `bridge-no-state-reread` — State file is read once at startup; bridge can't recover if server restarts with a new token.

**Files:**
- Modify: `bridge/index.ts:39-56` (extract state reader, call in ws.onclose), `bridge/index.ts:237-241` (rebuild wsUrl)
- Test: `tests/bridge/index.test.ts`

- [ ] **Step 1: Extract state reading into a function**

In `bridge/index.ts`, replace the inline state reading (lines 39-56) with:

```typescript
function readState(): { host: string; port: string; token: string } {
  const stateFile = process.env.TRAYCE_STATE_FILE ?? "/tmp/trayce/state.json";
  let host = process.env.TRAYCE_HOST ?? "";
  let port = process.env.TRAYCE_PORT ?? "";
  let token = process.env.TRAYCE_TOKEN ?? "";

  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf-8"));
      if (!token) token = state.token ?? "";
      if (!port && state.port) port = String(state.port);
      if (!host) host = "localhost";
    } catch {
      // state file unreadable — continue with defaults
    }
  }

  if (!host) host = "localhost";
  if (!port) port = "9740";

  return { host, port, token };
}

let { host, port, token } = readState();
```

- [ ] **Step 2: Re-read state in `connect()` before each connection attempt**

In the `connect()` function, re-read the state file:

```typescript
function connect() {
  // Re-read state file on each connection attempt (token may have changed)
  ({ host, port, token } = readState());
  const wsUrl = `ws://${host}:${port}/bridge?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl);
  // ... rest unchanged
```

Remove the old `const wsUrl = ...` line that was outside `connect()` (line ~237).

- [ ] **Step 3: Run existing bridge tests**

Run: `bun test tests/bridge/`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add bridge/index.ts
git commit -m "fix(bridge): re-read state file on reconnect to pick up new server token"
```

---

## Task 9: Persistence Saves Transforms

**Issue:** `client-persistence-no-transform` — `SavedLayer` omits `transform`, `locked`, and `deletable`; image layers lose positioning on reload.

**Files:**
- Modify: `client/persistence.ts:23-30` (add fields to SavedLayer)
- Test: `tests/client/persistence.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/client/persistence.test.ts`, add:

```typescript
import type { SavedLayer } from "../../client/persistence";

describe("SavedLayer interface", () => {
  test("SavedLayer includes transform, locked, and deletable fields", () => {
    const layer: SavedLayer = {
      id: "test",
      name: "Test",
      blob: new Blob(),
      opacity: 100,
      blendMode: "normal",
      visible: true,
      locked: false,
      deletable: true,
      transform: undefined,
    };
    expect(layer.locked).toBe(false);
    expect(layer.deletable).toBe(true);
    expect(layer.transform).toBeUndefined();
  });

  test("SavedLayer stores transform data", () => {
    const layer: SavedLayer = {
      id: "test",
      name: "Test",
      blob: new Blob(),
      opacity: 100,
      blendMode: "normal",
      visible: true,
      locked: true,
      deletable: false,
      transform: { x: 10, y: 20, width: 100, height: 200, sourceWidth: 100, sourceHeight: 200 },
    };
    expect(layer.transform?.x).toBe(10);
    expect(layer.locked).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/persistence.test.ts`
Expected: FAIL — `locked`, `deletable`, `transform` not on SavedLayer

- [ ] **Step 3: Add fields to SavedLayer**

In `client/persistence.ts`, update the interface:

```typescript
export interface SavedLayer {
  id: string;
  name: string;
  blob: Blob;
  opacity: number;
  blendMode: string;
  visible: boolean;
  locked: boolean;
  deletable: boolean;
  transform?: {
    x: number;
    y: number;
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/persistence.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/persistence.ts tests/client/persistence.test.ts
git commit -m "fix(client): include transform, locked, deletable in SavedLayer"
```

---

## Task 10: duplicateLayer Copies All Properties

**Issue:** `client-duplicate-no-transform` — `duplicateLayer()` doesn't copy `transform`, `locked`, or `visible`.

**Files:**
- Modify: `client/layers.ts:73-85`
- Test: `tests/client/layers.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/client/layers.test.ts`, add:

```typescript
describe("duplicateLayer copies all properties", () => {
  test("copies transform from image layer", () => {
    const lm = new LayerManager(100, 100, "white");
    const layer = lm.addLayer("Image", { canvasWidth: 50, canvasHeight: 50 });
    layer.transform = { x: 10, y: 20, width: 50, height: 50, sourceWidth: 50, sourceHeight: 50 };
    layer.locked = true;
    layer.visible = false;

    const copy = lm.duplicateLayer(1);
    expect(copy.transform).toEqual({ x: 10, y: 20, width: 50, height: 50, sourceWidth: 50, sourceHeight: 50 });
    expect(copy.locked).toBe(true);
    expect(copy.visible).toBe(false);
  });

  test("copy transform is independent from source", () => {
    const lm = new LayerManager(100, 100, "white");
    const layer = lm.addLayer("Image", { canvasWidth: 50, canvasHeight: 50 });
    layer.transform = { x: 10, y: 20, width: 50, height: 50, sourceWidth: 50, sourceHeight: 50 };

    const copy = lm.duplicateLayer(1);
    copy.transform!.x = 999;
    expect(layer.transform.x).toBe(10); // source unchanged
  });

  test("copies canvas dimensions from source", () => {
    const lm = new LayerManager(100, 100, "white");
    const layer = lm.addLayer("Image", { canvasWidth: 50, canvasHeight: 30 });

    const copy = lm.duplicateLayer(1);
    expect(copy.canvas.width).toBe(50);
    expect(copy.canvas.height).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/layers.test.ts -t "duplicateLayer copies"`
Expected: FAIL — transform is undefined on copy, canvas dimensions wrong

- [ ] **Step 3: Fix duplicateLayer**

In `client/layers.ts`, replace `duplicateLayer()`:

```typescript
duplicateLayer(index: number): Layer {
  if (this.layers.length >= MAX_LAYERS) {
    throw new Error(`Maximum ${MAX_LAYERS} layers`);
  }
  const source = this.layers[index];
  const copy = this.createLayer(
    `${source.name} copy`,
    true,
    source.canvas.width,
    source.canvas.height,
  );
  copy.ctx.drawImage(source.canvas, 0, 0);
  copy.opacity = source.opacity;
  copy.blendMode = source.blendMode;
  copy.visible = source.visible;
  copy.locked = source.locked;
  if (source.transform) {
    copy.transform = { ...source.transform };
  }
  this.layers.splice(index + 1, 0, copy);
  this.activeLayerIndex = index + 1;
  return copy;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/layers.test.ts -t "duplicateLayer copies"`
Expected: PASS

- [ ] **Step 5: Run full client test suite**

Run: `bun test tests/client/`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add client/layers.ts tests/client/layers.test.ts
git commit -m "fix(client): duplicateLayer copies transform, locked, visible, and canvas dimensions"
```

---

## Task 11: Wire Undo/Redo Shortcuts

**Issue:** `client-undo-stubbed` — Ctrl+Z/Ctrl+Y handlers are empty stubs despite History being implemented.

**Files:**
- Modify: `client/app.ts:938-947` (wire undo/redo)

Note: `app.ts` is not unit-testable (browser globals, PixiJS). This task is manual integration. The `History` class itself is already tested in `tests/client/history.test.ts`.

- [ ] **Step 1: Locate and read the history integration points**

Read `client/app.ts` to find where `history` is instantiated (search for "History" and "history"). Identify the module-level variable and where stroke operations end.

- [ ] **Step 2: Wire undo/redo keyboard handlers**

In `client/app.ts`, replace the undo/redo stubs (lines ~938-947):

```typescript
case "z":
  if (e.ctrlKey || e.metaKey) {
    if (!history || !layerManager || !compositor) break;
    const cmd = history.undo();
    if (cmd && cmd.checkpoint) {
      // Restore from checkpoint blob
      const bitmap = await createImageBitmap(cmd.checkpoint);
      const layer = layerManager.layers.find(l => l.id === cmd.layerId);
      if (layer) {
        layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        layer.ctx.drawImage(bitmap, 0, 0);
        layer.revision++;
        compositor.markDirty();
        layersUI?.render();
      }
    }
  }
  break;
case "y":
  if (e.ctrlKey || e.metaKey) {
    if (!history || !layerManager || !compositor) break;
    const cmd = history.redo();
    if (cmd && cmd.checkpoint) {
      const bitmap = await createImageBitmap(cmd.checkpoint);
      const layer = layerManager.layers.find(l => l.id === cmd.layerId);
      if (layer) {
        layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        layer.ctx.drawImage(bitmap, 0, 0);
        layer.revision++;
        compositor.markDirty();
        layersUI?.render();
      }
    }
  }
  break;
```

Note: The `history` variable and checkpoint-on-stroke-end wiring may need to be added if not present. Check if `history` is already instantiated as a module-level variable. If not, add:

```typescript
let history: History | null = null;
```

And initialize it in `initCanvas()`:

```typescript
history = new History(50 * 1024 * 1024); // 50MB budget
```

Push stroke commands at the end of `handleInput` when `event === "end"`:

```typescript
if (event === "end" && history && layerManager) {
  const layer = layerManager.activeLayer;
  const shouldCP = history.shouldCheckpoint();
  let checkpoint: Blob | undefined;
  let checkpointSize: number | undefined;
  if (shouldCP) {
    checkpoint = await layer.canvas.convertToBlob();
    checkpointSize = checkpoint.size;
    history.resetCheckpointCounter();
  }
  history.push({
    type: "stroke",
    layerId: layer.id,
    data: null,
    checkpoint,
    checkpointSize,
  });
}
```

- [ ] **Step 3: Build client**

Run: `bun run build:client`
Expected: Bundled successfully

- [ ] **Step 4: Commit**

```bash
git add client/app.ts
git commit -m "feat(client): wire undo/redo keyboard shortcuts to History module"
```

---

## Task 12: Heartbeat Interval Leak

**Issue:** `bridge-heartbeat-interval-leak` — `setInterval` for heartbeat not cleared in `ws.onclose`; leaks on rapid reconnect.

**Files:**
- Modify: `bridge/index.ts:249-255` (hoist interval ref, clear in onclose)

- [ ] **Step 1: Fix heartbeat cleanup**

In `bridge/index.ts`, hoist the heartbeat interval to module scope:

```typescript
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
```

In `ws.onopen`, replace the current heartbeat setup:

```typescript
ws.onopen = () => {
  reconnectDelay = 1000;
  currentWs = ws;
  ws.send(JSON.stringify({ type: "register", sessionId, label }));
  startTranscriptWatcher(ws);

  // Clear any prior heartbeat (from a previous connection attempt)
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "heartbeat" }));
    }
  }, 10_000);
};
```

In `ws.onclose`, clear the interval:

```typescript
ws.onclose = () => {
  currentWs = null;
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (transcriptWatcher) {
    transcriptWatcher.stop();
    transcriptWatcher = null;
  }
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    connect();
  }, reconnectDelay);
};
```

Remove the `clearInterval(heartbeat)` from inside the setInterval callback (the `else` branch) since it's now handled in onclose.

- [ ] **Step 2: Run bridge tests**

Run: `bun test tests/bridge/`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add bridge/index.ts
git commit -m "fix(bridge): clear heartbeat interval on WebSocket close to prevent leak"
```

---

## Execution Order

Tasks are grouped by module. Within each module, tasks are independent and can run in parallel.

**Server (Tasks 2, 3, 4):** All modify `server/websocket.ts` — run sequentially to avoid merge conflicts.

**Bridge (Tasks 5, 6, 7, 8, 12):** Tasks 5-7 modify `transcript-watcher.ts` — run sequentially. Tasks 8 and 12 modify `bridge/index.ts` — run sequentially with each other but can parallel with 5-7.

**Client (Tasks 1, 9, 10, 11):** Tasks 1 and 10 both modify `layers.ts` — run sequentially. Task 9 modifies `persistence.ts` (independent). Task 11 modifies `app.ts` (independent).

**Recommended parallel groups:**
1. Server tasks (2→3→4) | Bridge transcript tasks (5→6→7) | Client independent (9)
2. Bridge index tasks (8→12) | Client layers tasks (1→10) | Client app (11)
