# Transcript Buffering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a browser starts watching a session, replay all buffered transcript entries so the user sees the full conversation history, not just entries that arrive after they connect.

**Architecture:** The server buffers transcript-related messages (transcript-entry, response, transcript-status) per session as they arrive from bridges. When a browser sends `watch-session`, the server replays the buffer before routing new live entries. The buffer is capped at 500 entries per session and cleaned up when sessions are removed.

**Tech Stack:** TypeScript, Bun runtime, WebSocket

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/websocket.ts` | Modify | Add `sessionBuffers` map, buffer incoming transcript entries, replay on `watch-session` |
| `server/config.ts` | Modify | Add `transcriptBufferSize` config field |
| `tests/server/websocket.test.ts` | Modify | Add tests for buffering and replay behavior |

No new files needed. The change is contained to three existing files.

---

### Task 1: Add transcriptBufferSize to Config

**Files:**
- Modify: `server/config.ts:1-15` (Config interface and DEFAULTS)
- Test: `tests/server/websocket.test.ts` (uses `getConfig({})` — no changes needed, new field has a default)

- [ ] **Step 1: Add the config field to the interface and defaults**

In `server/config.ts`, add the field to the `Config` interface and `DEFAULTS`:

```typescript
// In the Config interface, after rateLimitPerMinute:
transcriptBufferSize: number;
```

```typescript
// In the DEFAULTS object, after rateLimitPerMinute:
transcriptBufferSize: 500,
```

- [ ] **Step 2: Run existing config tests to verify nothing broke**

Run: `bun test tests/server/config.test.ts`
Expected: All existing tests pass

- [ ] **Step 3: Commit**

```bash
git add server/config.ts
git commit -m "feat(config): add transcriptBufferSize setting (default 500)"
```

---

### Task 2: Write failing tests for transcript buffering

**Files:**
- Test: `tests/server/websocket.test.ts`

All new tests go in a new `describe("transcript buffering", ...)` block at the end of the file, before the closing. Use the existing test helpers (`makeFixture`, `browserWs`, `bridgeWs`, `lastSent`, `allSentOfType`).

- [ ] **Step 1: Write test — bridge transcript entries are buffered**

Add to `tests/server/websocket.test.ts`:

```typescript
describe("transcript buffering", () => {
  it("buffers transcript-entry messages from bridge", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));

    // Send transcript entries with no browser watching
    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "transcript-entry", entry: { type: "message", role: "user", content: "Hello" },
    }));
    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "transcript-entry", entry: { type: "response", role: "assistant", content: "Hi there" },
    }));

    // Now connect a browser and watch that session
    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session", sessionId: "s1" }));

    const transcriptMsgs = allSentOfType(browser, "transcript-entry");
    expect(transcriptMsgs).toHaveLength(2);
    expect((transcriptMsgs[0].entry as any).content).toBe("Hello");
    expect((transcriptMsgs[1].entry as any).content).toBe("Hi there");
  });
});
```

- [ ] **Step 2: Write test — response messages are also buffered**

```typescript
  it("buffers response messages from bridge", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));

    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "response", content: "Here is my answer", format: "markdown",
    }));

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session", sessionId: "s1" }));

    const responseMsgs = allSentOfType(browser, "response");
    expect(responseMsgs).toHaveLength(1);
    expect(responseMsgs[0].content).toBe("Here is my answer");
  });
```

- [ ] **Step 3: Write test — watch-session replays buffer then live entries continue**

```typescript
  it("replays buffer on watch-session, then routes live entries normally", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));

    // Buffer one entry before browser connects
    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "transcript-entry", entry: { type: "message", role: "user", content: "buffered" },
    }));

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session", sessionId: "s1" }));

    // Should have received the buffered entry
    const beforeLive = allSentOfType(browser, "transcript-entry");
    expect(beforeLive).toHaveLength(1);

    // Now send a live entry — should arrive too
    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "transcript-entry", entry: { type: "response", role: "assistant", content: "live" },
    }));

    const afterLive = allSentOfType(browser, "transcript-entry");
    expect(afterLive).toHaveLength(2);
    expect((afterLive[1].entry as any).content).toBe("live");
  });
```

- [ ] **Step 4: Write test — buffer is capped at transcriptBufferSize**

```typescript
  it("caps buffer at transcriptBufferSize, dropping oldest entries", async () => {
    const { hub } = makeFixture({ transcriptBufferSize: 3 });
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));

    // Send 5 entries — only last 3 should be kept
    for (let i = 1; i <= 5; i++) {
      await hub.handleMessage(bridge as any, JSON.stringify({
        type: "transcript-entry", entry: { type: "message", role: "user", content: `msg-${i}` },
      }));
    }

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session", sessionId: "s1" }));

    const msgs = allSentOfType(browser, "transcript-entry");
    expect(msgs).toHaveLength(3);
    expect((msgs[0].entry as any).content).toBe("msg-3");
    expect((msgs[1].entry as any).content).toBe("msg-4");
    expect((msgs[2].entry as any).content).toBe("msg-5");
  });
```

- [ ] **Step 5: Write test — buffer is cleaned up when session is removed**

```typescript
  it("cleans up buffer when bridge disconnects and session is removed", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));

    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "transcript-entry", entry: { type: "message", role: "user", content: "old" },
    }));

    hub.removeBridge(bridge as any);

    // Re-register same session with new bridge
    const bridge2 = bridgeWs();
    hub.addBridge(bridge2 as any);
    await hub.handleMessage(bridge2 as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));

    // Browser watches — should get empty buffer (old entries were cleaned up)
    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session", sessionId: "s1" }));

    const msgs = allSentOfType(browser, "transcript-entry");
    expect(msgs).toHaveLength(0);
  });
```

- [ ] **Step 6: Write test — canvas-push is NOT buffered**

```typescript
  it("does not buffer canvas-push messages", async () => {
    const { hub } = makeFixture();
    const bridge = bridgeWs();
    hub.addBridge(bridge as any);
    await hub.handleMessage(bridge as any, JSON.stringify({ type: "register", sessionId: "s1", label: "app" }));

    await hub.handleMessage(bridge as any, JSON.stringify({
      type: "canvas-push", image: "abc123", label: "test-image",
    }));

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;
    await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session", sessionId: "s1" }));

    const pushMsgs = allSentOfType(browser, "canvas-push");
    expect(pushMsgs).toHaveLength(0);
  });
```

- [ ] **Step 7: Write test — switching sessions replays the new session's buffer**

```typescript
  it("replays correct buffer when browser switches sessions", async () => {
    const { hub } = makeFixture();
    const bridge1 = bridgeWs();
    const bridge2 = bridgeWs();
    hub.addBridge(bridge1 as any);
    hub.addBridge(bridge2 as any);
    await hub.handleMessage(bridge1 as any, JSON.stringify({ type: "register", sessionId: "s1", label: "session-1" }));
    await hub.handleMessage(bridge2 as any, JSON.stringify({ type: "register", sessionId: "s2", label: "session-2" }));

    await hub.handleMessage(bridge1 as any, JSON.stringify({
      type: "transcript-entry", entry: { type: "message", role: "user", content: "from-s1" },
    }));
    await hub.handleMessage(bridge2 as any, JSON.stringify({
      type: "transcript-entry", entry: { type: "message", role: "user", content: "from-s2" },
    }));

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;

    // Watch s1
    await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session", sessionId: "s1" }));
    let msgs = allSentOfType(browser, "transcript-entry");
    expect(msgs).toHaveLength(1);
    expect((msgs[0].entry as any).content).toBe("from-s1");

    // Switch to s2
    browser.sent.length = 0;
    await hub.handleMessage(browser as any, JSON.stringify({ type: "watch-session", sessionId: "s2" }));
    msgs = allSentOfType(browser, "transcript-entry");
    expect(msgs).toHaveLength(1);
    expect((msgs[0].entry as any).content).toBe("from-s2");
  });
```

- [ ] **Step 8: Run tests to verify they all fail**

Run: `bun test tests/server/websocket.test.ts`
Expected: All 7 new tests fail (buffer not implemented yet). Existing tests pass.

- [ ] **Step 9: Commit failing tests**

```bash
git add tests/server/websocket.test.ts
git commit -m "test(websocket): add failing tests for transcript buffering"
```

---

### Task 3: Implement transcript buffering in WebSocketHub

**Files:**
- Modify: `server/websocket.ts:28-34` (add sessionBuffers field)
- Modify: `server/websocket.ts:109-128` (watch-session handler + bridge routing)
- Modify: `server/websocket.ts:73-85` (removeBridge cleanup)
- Modify: `server/websocket.ts:131-162` (handleRegister cleanup)

- [ ] **Step 1: Add the sessionBuffers map to WebSocketHub**

In `server/websocket.ts`, add a new private field after `browserWatchSession`:

```typescript
private readonly sessionBuffers = new Map<string, string[]>();
```

This maps `sessionId` to an array of serialized JSON payloads (strings). Storing pre-serialized strings avoids double-serialization on replay.

- [ ] **Step 2: Define which message types are buffered**

Add a constant inside the class or at module level, after the `BRIDGE_ROUTED_TYPES` usage. To keep it close to where it's used, add it as a class-level constant. Place it right after the field declarations:

```typescript
private static readonly BUFFERED_TYPES = new Set(["transcript-entry", "response", "transcript-status"]);
```

Note: `canvas-push` is intentionally excluded — images are large and ephemeral.

- [ ] **Step 3: Buffer messages in the bridge routing block**

Replace the bridge routing block in `handleMessage` (the `BRIDGE_ROUTED_TYPES` section, lines 117-128) with:

```typescript
    const BRIDGE_ROUTED_TYPES = ["transcript-entry", "response", "canvas-push", "transcript-status"];
    if (ws.data.kind === "bridge" && BRIDGE_ROUTED_TYPES.includes(msg.type)) {
      const sessionId = ws.data.sessionId;
      if (!sessionId) return;
      const payload = JSON.stringify({ ...msg, sessionId });

      // Buffer transcript-related messages for replay on watch-session
      if (WebSocketHub.BUFFERED_TYPES.has(msg.type)) {
        let buffer = this.sessionBuffers.get(sessionId);
        if (!buffer) {
          buffer = [];
          this.sessionBuffers.set(sessionId, buffer);
        }
        buffer.push(payload);
        if (buffer.length > this.config.transcriptBufferSize) {
          buffer.splice(0, buffer.length - this.config.transcriptBufferSize);
        }
      }

      for (const [browserId, browser] of this.browsers) {
        if (this.browserWatchSession.get(browserId) === sessionId) {
          safeSend(browser, payload);
        }
      }
      return;
    }
```

- [ ] **Step 4: Replay buffer on watch-session**

Replace the `watch-session` handler (lines 109-115) with:

```typescript
    if (ws.data.kind === "browser" && msg.type === "watch-session") {
      const sid = msg.sessionId;
      if (typeof sid === "string") {
        this.browserWatchSession.set(ws.data.id, sid);

        // Replay buffered transcript entries for this session
        const buffer = this.sessionBuffers.get(sid);
        if (buffer) {
          for (const payload of buffer) {
            safeSend(ws, payload);
          }
        }
      }
      return;
    }
```

- [ ] **Step 5: Clean up buffer in removeBridge**

In `removeBridge`, add buffer cleanup after `this.registry.remove(sessionId)`:

```typescript
  removeBridge(ws: Ws): void {
    this.pendingBridges.delete(ws.data.id);
    const sessionId = ws.data.sessionId;
    if (sessionId) {
      // Only clean up if this connection is still the canonical one
      if (this.sessionToBridgeId.get(sessionId) === ws.data.id) {
        this.bridges.delete(sessionId);
        this.sessionToBridgeId.delete(sessionId);
        this.registry.remove(sessionId);
        this.sessionBuffers.delete(sessionId);
        this.broadcastSessions();
      }
    }
  }
```

- [ ] **Step 6: Clean up buffer in handleRegister when re-registering**

In `handleRegister`, when a bridge re-registers with a different session or evicts another bridge, also clean up the old session's buffer. Add `this.sessionBuffers.delete(...)` alongside each `this.registry.remove(...)` call:

```typescript
  private handleRegister(ws: Ws, msg: WsMessage): void {
    const sessionId = msg.sessionId;
    const label = msg.label;
    if (typeof sessionId !== "string" || sessionId.length === 0) return;
    if (typeof label !== "string" || label.length === 0) return;

    // If this bridge previously registered a different session, clean up
    if (ws.data.sessionId && ws.data.sessionId !== sessionId) {
      this.bridges.delete(ws.data.sessionId);
      this.sessionToBridgeId.delete(ws.data.sessionId);
      this.registry.remove(ws.data.sessionId);
      this.sessionBuffers.delete(ws.data.sessionId);
    }

    // If another bridge holds this sessionId, evict it
    const existingBridgeId = this.sessionToBridgeId.get(sessionId);
    if (existingBridgeId && existingBridgeId !== ws.data.id) {
      const existingBridge = this.bridges.get(sessionId);
      if (existingBridge) {
        existingBridge.data.sessionId = undefined;
        try { existingBridge.close(); } catch {}
      }
      this.bridges.delete(sessionId);
      this.sessionToBridgeId.delete(sessionId);
      this.registry.remove(sessionId);
      this.sessionBuffers.delete(sessionId);
    }

    ws.data.sessionId = sessionId;
    this.bridges.set(sessionId, ws);
    this.sessionToBridgeId.set(sessionId, ws.data.id);
    this.registry.add(sessionId, label);
    this.broadcastSessions();
  }
```

- [ ] **Step 7: Run all tests**

Run: `bun test tests/server/websocket.test.ts`
Expected: All tests pass including the 7 new buffering tests.

- [ ] **Step 8: Run the full test suite**

Run: `bun test tests/server/ tests/bridge/`
Expected: All tests pass (except the pre-existing integration test that can't find `bun` in PATH).

- [ ] **Step 9: Commit**

```bash
git add server/websocket.ts server/config.ts
git commit -m "feat(server): buffer transcript entries and replay on watch-session"
```

---

### Task 4: Clear transcript tabs on session switch (client)

The client already calls `responseTab?.clear()` and `transcriptTab?.clear()` on session switch (in the `sessionSelect` change handler, `client/app.ts:398-399`). This means replayed entries won't duplicate with existing entries — the tabs are wiped before the new `watch-session` message is sent. No client code changes needed.

- [ ] **Step 1: Verify the existing client behavior**

Read `client/app.ts` lines 392-400 and confirm:
1. `responseTab?.clear()` is called on session change
2. `transcriptTab?.clear()` is called on session change
3. `watch-session` is sent after the clear

This ordering is correct — clear first, then request the new session's data (which triggers buffer replay on the server).

- [ ] **Step 2: Rebuild client (no changes, just ensure it's current)**

Run: `bun build client/app.ts --outdir dist/client --minify --target browser && cp client/index.html client/style.css dist/client/`
Expected: Build succeeds.

---

### Task 5: Manual integration test

- [ ] **Step 1: Restart the trayce server**

```bash
kill $(cat /tmp/trayce/state.json | python3 -c "import sys,json; print(json.load(sys.stdin)['pid'])") 2>/dev/null
sleep 1
nohup bun run server/index.ts > /tmp/trayce/server.log 2>&1 &
sleep 2
cat /tmp/trayce/state.json
```

- [ ] **Step 2: Start a Claude Code session with trayce bridge**

In a separate terminal:
```bash
claude --dangerously-load-development-channels server:trayce
```

Ask Claude a question that generates some transcript activity (tool calls, text responses).

- [ ] **Step 3: Open the browser AFTER activity has occurred**

Open the URL from `state.json` in the browser. Select the session. Verify:
1. The Transcript tab shows historical entries (messages, tool calls) from before the browser connected
2. The Response tab shows historical responses
3. New live entries continue to appear after the buffer replay
4. Switching away and back to the session replays again correctly
