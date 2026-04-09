# Server Shutdown/Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a power button to the Trayce web UI that lets the user shutdown or restart the server without leaving the browser. Restart is seamless (browser reconnects with the same token); shutdown cleanly stops the process.

**Architecture:** Three new protocol messages in `shared/protocol.ts` integrated into the Round 3 discriminated unions. Server-side: `WebSocketHub` accepts a `shutdownFn` callback; `server/index.ts` owns process lifecycle and spawns a detached `scripts/start.sh` child with `TRAYCE_TOKEN` preserved. Client-side: a power button in the top bar opens a popover (Restart / Shutdown / Cancel) mirroring the `theme.ts` popover pattern; Shift-click fast-paths to restart.

**Tech Stack:** TypeScript + Bun, PixiJS (unrelated here), existing discriminated-union protocol (`shared/protocol.ts`), existing shell scripts (`scripts/start.sh` — already correctly detaches via `nohup ... & disown`, verified, no changes needed).

**Spec:** `docs/superpowers/specs/2026-04-08-server-shutdown-restart-design.md`

---

## Pre-flight checks

Before starting any task, from the repo root (`trayce`):

```bash
bun run typecheck   # expect clean
bun run check       # expect clean
bun test            # expect 388 pass, 0 fail
```

Baseline is green on commit `f4f354a`. If any of these fail before you start, stop and investigate — the plan assumes a clean starting state.

---

## Task 1: Add protocol types for shutdown/restart messages

**Files:**
- Modify: `shared/protocol.ts`

The protocol file already defines discriminated unions keyed on `type`, consumed by `server/websocket.ts` via `import type`. Adding a new variant to `BrowserToServerMessage` without handling it in `handleBrowserMessage`'s switch will cause `tsc` to fail — that's intentional and will be fixed in Task 3. The `ServerToBrowserMessage` additions won't cause a compile failure because the client uses a loose `ServerMessage` type (not the union).

- [ ] **Step 1: Add the three new interfaces and extend the unions**

Edit `shared/protocol.ts`. Find the `// Browser → Server` section and add `ShutdownRequestMessage` plus extend the union:

```ts
export interface ShutdownRequestMessage {
  type: "shutdown-request";
  restart: boolean; // false = clean exit, true = spawn replacement before exit
}

export type BrowserToServerMessage =
  | HeartbeatMessage
  | SubmitMessage
  | WatchSessionMessage
  | PermissionVerdictMessage
  | ShutdownRequestMessage;
```

Find the `// Server → Browser` section and add `ServerExitingMessage` and `ServerInfoMessage`, and extend the union:

```ts
export interface ServerExitingMessage {
  type: "server-exiting";
  restart: boolean;       // echoes the request so the browser knows what to expect
  containerMode: boolean; // true → orchestrator will handle restart
}

export interface ServerInfoMessage {
  type: "server-info";
  containerMode: boolean;
  // Room to grow: version, uptime, etc. as future fields
}

export type ServerToBrowserMessage =
  | HeartbeatMessage
  | SessionsMessage
  | AckMessage
  | ErrorMessage
  | UsageSnapshotMessage
  | ServerInfoMessage
  | ServerExitingMessage
  | SessionScoped<BridgeRoutedMessage>;
```

- [ ] **Step 2: Run typecheck — expect exactly one error in `server/websocket.ts`**

Run: `bun run typecheck 2>&1`

Expected output should contain one error like:

```
server/websocket.ts(NNN,NN): error TS2345: Argument of type 'ShutdownRequestMessage' is not assignable to parameter of type 'never'.
```

This is the exhaustiveness check from the Round 3 refactor firing. If you see no errors, the union wasn't extended correctly. If you see many errors, something else is broken — stop and investigate.

- [ ] **Step 3: Commit**

```bash
git add shared/protocol.ts
git commit -m "feat(protocol): add shutdown-request, server-exiting, server-info types"
```

The commit intentionally leaves typecheck broken. Task 3 resolves it by adding the case to the switch. This is load-bearing — the whole point of Round 3's discriminated union is that adding a new variant without handling it is a compile error.

---

## Task 2: WebSocketHub constructor accepts a shutdownFn callback

**Files:**
- Modify: `server/websocket.ts`
- Modify: `server/index.ts`
- Modify: `tests/server/websocket.test.ts`
- Modify: `tests/server/bridge-routing.test.ts`
- Modify: `tests/server/integration.test.ts` (if it constructs a hub)
- Modify: any other test file that calls `new WebSocketHub(...)`

This task purely updates the constructor signature. No new behavior yet. Typecheck will still fail from Task 1 after this task — that's fine.

- [ ] **Step 1: Update the hub constructor signature**

In `server/websocket.ts`, find the `WebSocketHub` class constructor:

```ts
constructor(
  private readonly registry: SessionRegistry,
  private readonly submissions: SubmissionStore,
  private readonly config: Config,
  private readonly now: () => number = Date.now,
) {}
```

Replace with:

```ts
constructor(
  private readonly registry: SessionRegistry,
  private readonly submissions: SubmissionStore,
  private readonly config: Config,
  private readonly shutdownFn: (opts: { restart: boolean; containerMode: boolean }) => void,
  private readonly now: () => number = Date.now,
) {}
```

The new `shutdownFn` parameter is 4th (required), `now` is pushed to 5th (still optional with default).

- [ ] **Step 2: Update `server/index.ts` to pass a stub shutdownFn**

Find the line `const hub = new WebSocketHub(registry, submissions, config);` and replace with:

```ts
// Placeholder — Task 7 replaces this with initiateShutdown
const hub = new WebSocketHub(registry, submissions, config, () => {
  process.exit(0);
});
```

This lets the server at least compile and run. Task 7 replaces the body with the real spawn-and-exit logic.

- [ ] **Step 3: Update all test call sites to pass a no-op shutdown spy**

Find every `new WebSocketHub(...)` and `makeHub(...)` helper in tests. Update each to pass a no-op function as the 4th argument. Known sites (grep if unsure):

**`tests/server/websocket.test.ts`:**

Line ~75, inside the `makeFixture` or equivalent helper (the call is `new WebSocketHub(registry, store, config, () => nowRef.value)`):

```ts
const hub = new WebSocketHub(registry, store, config, () => {}, () => nowRef.value);
```

Line ~477 (the `tinyStore` test):

```ts
const hub = new WebSocketHub(registry, tinyStore, BASE_CONFIG, () => {});
```

**`tests/server/bridge-routing.test.ts`:**

Line ~51-55, inside `makeHub`:

```ts
function makeHub(configOverrides: Partial<Config> = {}): WebSocketHub {
  const registry = new SessionRegistry();
  const store = new SubmissionStore(TEST_DIR, 20 * 1024 * 1024);
  const config = { ...BASE_CONFIG, ...configOverrides };
  return new WebSocketHub(registry, store, config, () => {});
}
```

**Other test files:** Run `grep -rn 'new WebSocketHub' tests/` to find any remaining call sites and give each a `() => {}` 4th argument.

- [ ] **Step 4: Run typecheck — expect only the one error from Task 1**

```bash
bun run typecheck 2>&1 | grep 'error TS'
```

Expected: exactly one error in `server/websocket.ts` about `ShutdownRequestMessage` not being assignable to `never`. If you see errors in test files, a call site was missed. Fix and re-run.

- [ ] **Step 5: Run tests to make sure nothing else regressed**

```bash
bun test 2>&1 | tail -8
```

Expected: 388 pass, 0 fail. (The typecheck error doesn't block `bun test` because `bun test` doesn't invoke `tsc`.)

- [ ] **Step 6: Commit**

```bash
git add server/websocket.ts server/index.ts tests/
git commit -m "refactor(server): WebSocketHub constructor takes shutdownFn callback"
```

---

## Task 3: Handle shutdown-request in WebSocketHub (restart=true case)

**Files:**
- Modify: `server/websocket.ts`
- Test: `tests/server/websocket.test.ts`

This is where the exhaustive-switch error from Task 1 gets resolved. TDD: write the test first, watch it fail, implement the case, watch it pass.

- [ ] **Step 1: Write a failing test for shutdown-request with restart=true**

In `tests/server/websocket.test.ts`, find a good location near the bottom (after the existing describe blocks) and add:

```ts
describe("shutdown-request", () => {
  it("calls shutdownFn with restart=true and sends server-exiting ack", async () => {
    const registry = new SessionRegistry();
    const store = new SubmissionStore(TEST_DIR, 20 * 1024 * 1024);
    const shutdownCalls: Array<{ restart: boolean; containerMode: boolean }> = [];
    const hub = new WebSocketHub(
      registry,
      store,
      BASE_CONFIG,
      (opts) => {
        shutdownCalls.push(opts);
      },
    );

    const browser = browserWs();
    hub.addBrowser(browser as any);
    browser.sent.length = 0;

    await hub.handleMessage(
      browser as any,
      JSON.stringify({ type: "shutdown-request", restart: true }),
    );

    // Browser should receive server-exiting ack immediately (before the timeout fires)
    const ackMessages = browser.sent
      .map((s) => JSON.parse(s) as Record<string, unknown>)
      .filter((m) => m.type === "server-exiting");
    expect(ackMessages).toHaveLength(1);
    expect(ackMessages[0]!.restart).toBe(true);
    expect(typeof ackMessages[0]!.containerMode).toBe("boolean");

    // shutdownFn is called asynchronously via setTimeout(..., 50)
    await new Promise((r) => setTimeout(r, 100));
    expect(shutdownCalls).toHaveLength(1);
    expect(shutdownCalls[0]!.restart).toBe(true);
  });
});
```

Note: `TEST_DIR`, `BASE_CONFIG`, `browserWs`, `bridgeWs`, and `MockWs` are existing helpers at the top of `tests/server/websocket.test.ts` (verified at lines 38, 42, 58, 61). No imports or adaptations needed — just reuse them.

- [ ] **Step 2: Run the test — expect failure (typecheck blocks it)**

```bash
bun test tests/server/websocket.test.ts 2>&1 | tail -10
```

Expected: the test file fails to compile because `handleBrowserMessage` doesn't handle `shutdown-request` (the Task 1 error). Bun may print the TypeScript error or fail with a runtime error. Either is acceptable — the point is that the test can't pass yet.

- [ ] **Step 3: Add the `shutdown-request` case to the browser switch**

In `server/websocket.ts`, find `handleBrowserMessage`. Add a case before the `default:` branch:

```ts
case "shutdown-request": {
  const containerMode = this.detectContainerMode();
  safeSend(
    ws,
    JSON.stringify({
      type: "server-exiting",
      restart: msg.restart,
      containerMode,
    }),
  );
  // Give the socket a beat to flush the ack before tearing down.
  setTimeout(() => this.shutdownFn({ restart: msg.restart, containerMode }), 50);
  return;
}
```

- [ ] **Step 4: Add the memoized `detectContainerMode` helper**

Still in `server/websocket.ts`, add these two members to the `WebSocketHub` class (near the top of the class body, after the other private fields):

```ts
private _containerMode: boolean | null = null;
private detectContainerMode(): boolean {
  if (this._containerMode !== null) return this._containerMode;
  this._containerMode = existsSync("/.dockerenv") || Bun.env.TRAYCE_CONTAINER === "1";
  return this._containerMode;
}
```

Add the import at the top of the file:

```ts
import { existsSync } from "node:fs";
```

- [ ] **Step 5: Run typecheck — expect clean**

```bash
bun run typecheck 2>&1
```

Expected: no errors. The exhaustive check in `handleBrowserMessage` is now satisfied.

- [ ] **Step 6: Run the new test — expect pass**

```bash
bun test tests/server/websocket.test.ts 2>&1 | tail -10
```

Expected: 1 more test than before, 0 fail.

- [ ] **Step 7: Run full test suite**

```bash
bun test 2>&1 | tail -8
```

Expected: 389 pass, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add server/websocket.ts tests/server/websocket.test.ts
git commit -m "feat(server): handle shutdown-request with restart=true"
```

---

## Task 4: Test shutdown-request with restart=false

**Files:**
- Test: `tests/server/websocket.test.ts`

No new implementation — the case handler from Task 3 already covers both boolean values. This task is just adding coverage for the shutdown variant.

- [ ] **Step 1: Write the test**

Inside the existing `describe("shutdown-request")` block from Task 3, add:

```ts
it("calls shutdownFn with restart=false for clean shutdown", async () => {
  const registry = new SessionRegistry();
  const store = new SubmissionStore(TEST_DIR, 20 * 1024 * 1024);
  const shutdownCalls: Array<{ restart: boolean; containerMode: boolean }> = [];
  const hub = new WebSocketHub(
    registry,
    store,
    BASE_CONFIG,
    (opts) => {
      shutdownCalls.push(opts);
    },
  );

  const browser = browserWs();
  hub.addBrowser(browser as any);
  browser.sent.length = 0;

  await hub.handleMessage(
    browser as any,
    JSON.stringify({ type: "shutdown-request", restart: false }),
  );

  const ackMessages = browser.sent
    .map((s) => JSON.parse(s) as Record<string, unknown>)
    .filter((m) => m.type === "server-exiting");
  expect(ackMessages).toHaveLength(1);
  expect(ackMessages[0]!.restart).toBe(false);

  await new Promise((r) => setTimeout(r, 100));
  expect(shutdownCalls).toHaveLength(1);
  expect(shutdownCalls[0]!.restart).toBe(false);
});
```

- [ ] **Step 2: Run the test — expect pass immediately**

```bash
bun test tests/server/websocket.test.ts 2>&1 | tail -8
```

Expected: 390 pass, 0 fail. (Test passes without new implementation because Task 3's case handler is generic over the `restart` field.)

- [ ] **Step 3: Commit**

```bash
git add tests/server/websocket.test.ts
git commit -m "test(server): cover shutdown-request with restart=false"
```

---

## Task 5: Test that bridges cannot initiate shutdown

**Files:**
- Test: `tests/server/websocket.test.ts`

Documents the security boundary: `ShutdownRequestMessage` is only in `BrowserToServerMessage`, so a bridge sending one falls through the runtime-silent exhaustive default in `handleBridgeMessage`.

- [ ] **Step 1: Write the test**

In the `describe("shutdown-request")` block:

```ts
it("silently ignores shutdown-request from bridges", async () => {
  const registry = new SessionRegistry();
  const store = new SubmissionStore(TEST_DIR, 20 * 1024 * 1024);
  const shutdownCalls: Array<{ restart: boolean; containerMode: boolean }> = [];
  const hub = new WebSocketHub(
    registry,
    store,
    BASE_CONFIG,
    (opts) => {
      shutdownCalls.push(opts);
    },
  );

  const bridge = bridgeWs();
  hub.addBridge(bridge as any);
  bridge.sent.length = 0;

  await hub.handleMessage(
    bridge as any,
    JSON.stringify({ type: "shutdown-request", restart: true }),
  );

  // No ack sent
  const ackMessages = bridge.sent
    .map((s) => JSON.parse(s) as Record<string, unknown>)
    .filter((m) => m.type === "server-exiting");
  expect(ackMessages).toHaveLength(0);

  // Shutdown callback not called
  await new Promise((r) => setTimeout(r, 100));
  expect(shutdownCalls).toHaveLength(0);
});
```

Note: `bridgeWs()` is defined at `tests/server/websocket.test.ts:42` (verified). Just call it.

- [ ] **Step 2: Run the test — expect pass**

```bash
bun test tests/server/websocket.test.ts 2>&1 | tail -8
```

Expected: 391 pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add tests/server/websocket.test.ts
git commit -m "test(server): verify bridges cannot initiate shutdown-request"
```

---

## Task 6: Server sends server-info on browser connect

**Files:**
- Modify: `server/websocket.ts`
- Test: `tests/server/websocket.test.ts`

New browser connections should receive a `server-info` message so the client knows container mode ahead of time.

- [ ] **Step 1: Write the test**

Add a new describe block (separate from the shutdown-request one):

```ts
describe("server-info on connect", () => {
  it("sends server-info to new browsers alongside sessions", async () => {
    const registry = new SessionRegistry();
    const store = new SubmissionStore(TEST_DIR, 20 * 1024 * 1024);
    const hub = new WebSocketHub(registry, store, BASE_CONFIG, () => {});

    const browser = browserWs();
    hub.addBrowser(browser as any);

    const infoMessages = browser.sent
      .map((s) => JSON.parse(s) as Record<string, unknown>)
      .filter((m) => m.type === "server-info");
    expect(infoMessages).toHaveLength(1);
    expect(typeof infoMessages[0]!.containerMode).toBe("boolean");
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
bun test tests/server/websocket.test.ts 2>&1 | tail -10
```

Expected: the new test fails because `addBrowser` doesn't send a `server-info` message yet.

- [ ] **Step 3: Update `addBrowser` to send server-info**

In `server/websocket.ts`, find the `addBrowser` method:

```ts
addBrowser(ws: Ws): void {
  this.browsers.set(ws.data.id, ws);
  this.rateBuckets.set(ws.data.id, []);
  this.sendSessions(ws);
}
```

Replace with:

```ts
addBrowser(ws: Ws): void {
  this.browsers.set(ws.data.id, ws);
  this.rateBuckets.set(ws.data.id, []);
  safeSend(
    ws,
    JSON.stringify({
      type: "server-info",
      containerMode: this.detectContainerMode(),
    }),
  );
  this.sendSessions(ws);
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
bun test tests/server/websocket.test.ts 2>&1 | tail -8
```

Expected: 392 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add server/websocket.ts tests/server/websocket.test.ts
git commit -m "feat(server): send server-info to new browser connections"
```

---

## Task 7: Implement initiateShutdown in server/index.ts

**Files:**
- Modify: `server/index.ts`

Replaces the Task 2 placeholder with the real shutdown + spawn logic. No unit test — the function calls `process.exit(0)` and spawns a subprocess, which can't be safely exercised in the test harness. Manual verification at the end of this task.

- [ ] **Step 1: Add imports**

At the top of `server/index.ts` (verified: only `node:fs/promises` is currently imported for `mkdir`, `unlink`, `writeFile`), add the `existsSync` import from the sync `node:fs` module:

```ts
import { existsSync } from "node:fs";
```

- [ ] **Step 2: Write the `initiateShutdown` function**

Find the placeholder `const hub = new WebSocketHub(registry, submissions, config, () => { process.exit(0); });` line. Above it, add:

```ts
function detectContainerMode(): boolean {
  return existsSync("/.dockerenv") || Bun.env.TRAYCE_CONTAINER === "1";
}

async function initiateShutdown({
  restart,
  containerMode,
}: { restart: boolean; containerMode: boolean }): Promise<void> {
  console.log(`[trayce] ${restart ? "restart" : "shutdown"} requested via WS`);
  clearInterval(heartbeatTimer);
  clearInterval(cleanupTimer);
  server.stop(true); // releases port 9740
  try {
    await unlink(config.stateFile);
  } catch {}
  submissions.removeAll();

  if (restart && !containerMode) {
    // Spawn a fully detached child with the current token so the browser's
    // reconnect-with-backoff picks up the new server seamlessly.
    Bun.spawn(["bash", "scripts/start.sh"], {
      cwd: process.cwd(),
      env: { ...process.env, TRAYCE_TOKEN: token },
      stdio: ["ignore", "ignore", "ignore"],
    });
  }
  // Container mode or plain shutdown: just exit. If the container has a
  // restart policy, the orchestrator relaunches us; otherwise the container
  // stops.
  process.exit(0);
}
```

**Important:** `initiateShutdown` must be defined AFTER `heartbeatTimer`, `cleanupTimer`, `server`, `submissions`, `config`, and `token` are in scope. In the current `server/index.ts`, the order is:

1. `config` and `token` assigned at the top
2. `submissions` and `hub` constructed
3. `server` assigned from `Bun.serve(...)`
4. `heartbeatTimer` and `cleanupTimer` assigned later

You need to either:
(a) Move `initiateShutdown` to after all the timer/server assignments, or
(b) Use a function declaration (hoisted) but only invoke it after the assignments exist — which is already the case since the hub only invokes it in response to a runtime message, long after startup.

Option (b) works because function declarations are hoisted. Place `initiateShutdown` anywhere in the file that's convenient. The existing `shutdown(signal)` function at the bottom of the file is a good sibling — put `initiateShutdown` next to it.

- [ ] **Step 3: Wire `initiateShutdown` into the hub**

Change:

```ts
const hub = new WebSocketHub(registry, submissions, config, () => {
  process.exit(0);
});
```

To:

```ts
const hub = new WebSocketHub(registry, submissions, config, (opts) =>
  void initiateShutdown(opts),
);
```

The `void` cast is because `initiateShutdown` is async but the hub's `shutdownFn` signature is synchronous. This is fine — we fire-and-forget the async work and let it run to `process.exit`.

- [ ] **Step 4: Run typecheck and tests**

```bash
bun run typecheck 2>&1
bun test 2>&1 | tail -8
```

Expected: typecheck clean, 392 pass 0 fail.

- [ ] **Step 5: Manual smoke test — restart path**

In one terminal:

```bash
bash scripts/start.sh
# Note the URL and token from the output
```

In another terminal, use `websocat` or a quick Bun script to send the message. With websocat:

```bash
TOKEN=$(jq -r .token /tmp/trayce/state.json)
echo '{"type":"shutdown-request","restart":true}' | websocat -n1 "ws://localhost:9740/canvas?token=$TOKEN"
```

Then in the first terminal (or a third one):

```bash
sleep 3
cat /tmp/trayce/state.json
```

Expected: `state.json` exists with a DIFFERENT PID than before the restart. The token should be the SAME (preserved via env var). The server log at `/tmp/trayce/server.log` should show the old process logging "[trayce] restart requested via WS" followed by the new process's startup banner.

If the token is different, `TRAYCE_TOKEN` isn't being picked up — check `server/config.ts` line 66 (should read `env.TRAYCE_TOKEN?.trim() || undefined`). If the PID is the same, the spawn didn't take — check `scripts/start.sh` and the `Bun.spawn` options.

- [ ] **Step 6: Manual smoke test — shutdown path**

```bash
bash scripts/start.sh
TOKEN=$(jq -r .token /tmp/trayce/state.json)
echo '{"type":"shutdown-request","restart":false}' | websocat -n1 "ws://localhost:9740/canvas?token=$TOKEN"
sleep 2
ls /tmp/trayce/state.json 2>&1
```

Expected: `ls: cannot access '/tmp/trayce/state.json': No such file or directory` — the server exited and cleaned up its state file. No new server was spawned.

- [ ] **Step 7: Commit**

```bash
git add server/index.ts
git commit -m "feat(server): implement initiateShutdown with restart spawn and container-aware exit"
```

---

## Task 8: Add power button element and styles

**Files:**
- Modify: `client/index.html`
- Modify: `client/style.css`

Pure markup + CSS. No behavior yet — the click handler comes in Task 9.

- [ ] **Step 1: Add the button element to the top bar**

In `client/index.html`, find the `<header id="top-bar">` section and its right-side `<div>` containing the connection status indicator. Add the power button immediately after the connection status indicator:

```html
<button type="button" id="server-power-btn" class="power-btn" title="Server controls" disabled>⏻</button>
```

The `disabled` attribute starts the button in a disabled state; it's enabled programmatically when the connection comes up (Task 10).

- [ ] **Step 2: Add styles for the button and popover**

In `client/style.css`, add at the end of the file:

```css
/* Server power button */
.power-btn {
  background: transparent;
  border: 1px solid var(--border, #444);
  color: var(--fg, #ccc);
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  margin-left: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.power-btn:hover:not(:disabled) {
  background: var(--accent-dim, rgba(255, 255, 255, 0.08));
  color: var(--accent, #4a9eff);
}
.power-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.power-btn.active {
  background: var(--accent-dim, rgba(74, 158, 255, 0.2));
  color: var(--accent, #4a9eff);
}

/* Server power popover */
.server-power-popover {
  position: fixed;
  background: var(--bg-elevated, #2a2a2a);
  border: 1px solid var(--border, #444);
  border-radius: 6px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  min-width: 140px;
}
.server-power-popover .popover-btn {
  background: transparent;
  border: none;
  color: var(--fg, #ccc);
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}
.server-power-popover .popover-btn:hover {
  background: var(--accent-dim, rgba(255, 255, 255, 0.08));
}
.server-power-popover .popover-btn.restart {
  color: var(--accent, #4a9eff);
}
.server-power-popover .popover-btn.shutdown {
  color: #e55;
}
.server-power-popover .popover-btn.cancel {
  color: var(--fg-dim, #888);
  border-top: 1px solid var(--border, #444);
  margin-top: 2px;
  padding-top: 10px;
}
```

- [ ] **Step 3: Rebuild the client to verify the HTML is picked up**

```bash
bun run build:client 2>&1 | tail -5
```

Expected: clean build, same module count (~737). The new button is tiny enough not to measurably affect bundle size.

- [ ] **Step 4: Run biome check**

```bash
bun run check 2>&1 | tail -5
```

Expected: clean. (Biome lints CSS too; the existing config disables `noDescendingSpecificity` so CSS noise is suppressed.)

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/style.css
git commit -m "feat(client): add power button element and popover styles"
```

---

## Task 9: Power button click handler and popover state machine

**Files:**
- Modify: `client/app.ts`

Wires the power button's click behavior: plain click opens the popover, shift-click fast-paths to restart. The popover is implemented inline in `app.ts` following the `theme.ts` pattern. No unit tests — UI interaction code in vanilla DOM is tested by running the app.

- [ ] **Step 1: Add a module-level state variable for container mode**

In `client/app.ts`, near the other module-level `let` declarations (around line 60-70), add:

```ts
let containerMode = false; // Set by server-info message on connect
```

- [ ] **Step 2: Add a module-level reference for the power popover**

Near the other DOM references at the top of the file (where `submitBtn`, `sessionSelect`, etc. are declared):

```ts
const powerBtn = document.getElementById("server-power-btn") as HTMLButtonElement;
let powerPopover: HTMLElement | null = null;
```

- [ ] **Step 3: Add the click handler and popover functions**

Find a reasonable place in the file (after the `updateLayerInfo` function is a good spot) and add:

```ts
// -- Server power button --

powerBtn.addEventListener("click", (e) => {
  if (!connection?.isConnected) return;
  if (e.shiftKey) {
    // Fast path: skip popover, skip confirmation, restart immediately.
    sendShutdownRequest(true);
    return;
  }
  if (powerPopover) {
    closePowerPopover();
    return;
  }
  openPowerPopover();
});

function openPowerPopover(): void {
  powerPopover = document.createElement("div");
  powerPopover.className = "server-power-popover";

  const restartBtn = document.createElement("button");
  restartBtn.type = "button";
  restartBtn.className = "popover-btn restart";
  restartBtn.textContent = "Restart";
  restartBtn.title = containerMode
    ? "Exit this process; orchestrator will restart if configured"
    : "Restart the server; this browser will reconnect automatically";
  restartBtn.addEventListener("click", () => {
    closePowerPopover();
    sendShutdownRequest(true);
  });

  const shutdownBtn = document.createElement("button");
  shutdownBtn.type = "button";
  shutdownBtn.className = "popover-btn shutdown";
  shutdownBtn.textContent = "Shutdown";
  shutdownBtn.title = containerMode
    ? "Exit this process; container will stop unless restart policy is set"
    : "Stop the server; you'll need to start it again from a terminal";
  shutdownBtn.addEventListener("click", () => {
    closePowerPopover();
    sendShutdownRequest(false);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "popover-btn cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", closePowerPopover);

  powerPopover.append(restartBtn, shutdownBtn, cancelBtn);

  // Position below the button, right-aligned with it
  const rect = powerBtn.getBoundingClientRect();
  powerPopover.style.top = `${rect.bottom + 4}px`;
  powerPopover.style.right = `${window.innerWidth - rect.right}px`;

  document.body.appendChild(powerPopover);
  powerBtn.classList.add("active");

  // Click-outside and escape-key dismiss, deferred by one frame so the
  // opening click doesn't immediately close it
  requestAnimationFrame(() => {
    const dismissClick = (ev: MouseEvent) => {
      if (
        powerPopover &&
        !powerPopover.contains(ev.target as Node) &&
        ev.target !== powerBtn
      ) {
        closePowerPopover();
      }
    };
    const dismissEsc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") closePowerPopover();
    };
    document.addEventListener("click", dismissClick);
    document.addEventListener("keydown", dismissEsc);
    // Store handlers on the popover element so closePowerPopover can find them
    (powerPopover as unknown as { _dismissClick: typeof dismissClick })._dismissClick = dismissClick;
    (powerPopover as unknown as { _dismissEsc: typeof dismissEsc })._dismissEsc = dismissEsc;
  });
}

function closePowerPopover(): void {
  if (!powerPopover) return;
  const handlers = powerPopover as unknown as {
    _dismissClick?: (e: MouseEvent) => void;
    _dismissEsc?: (e: KeyboardEvent) => void;
  };
  if (handlers._dismissClick) document.removeEventListener("click", handlers._dismissClick);
  if (handlers._dismissEsc) document.removeEventListener("keydown", handlers._dismissEsc);
  powerPopover.remove();
  powerPopover = null;
  powerBtn.classList.remove("active");
}

function sendShutdownRequest(restart: boolean): void {
  if (!connection?.isConnected) return;
  connection.send({ type: "shutdown-request", restart });
  showToast(restart ? "Server restarting…" : "Server shutting down…");
  powerBtn.disabled = true;
}
```

- [ ] **Step 4: Run typecheck, biome, and tests**

```bash
bun run typecheck 2>&1
bun run check 2>&1 | tail -5
bun test 2>&1 | tail -8
```

Expected: all clean, 392 pass 0 fail.

- [ ] **Step 5: Rebuild the client**

```bash
bun run build:client 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add client/app.ts
git commit -m "feat(client): power button click handler and popover state machine"
```

---

## Task 10: Client-side message handlers for server-info and server-exiting

**Files:**
- Modify: `client/app.ts`

Routes the two new server → browser messages into the app. Also re-enables the power button on successful reconnection so the user can iterate.

- [ ] **Step 1: Add cases to `handleServerMessage`**

In `client/app.ts`, find `function handleServerMessage(msg: ServerMessage): void` (around line 646) and locate the `switch (msg.type)` inside. Add two new cases near the existing cases (order doesn't matter, but keeping them alphabetical or near related handlers is nice):

```ts
case "server-info":
  if (typeof msg.containerMode === "boolean") {
    containerMode = msg.containerMode;
  }
  break;

case "server-exiting": {
  const restart = Boolean(msg.restart);
  const inContainer = Boolean(msg.containerMode);
  const action = restart ? "restarting" : "shutting down";
  const where = inContainer ? " (orchestrator will handle restart)" : "";
  showToast(`Server ${action}${where}…`);
  submitBtn.disabled = true;
  powerBtn.disabled = true;
  break;
}
```

The runtime `typeof` and `Boolean()` checks are because `ServerMessage` is still the loose client-side type (`{ type: string; [key: string]: unknown }`) from `client/connection.ts`. This is acceptable — see the Round 4 future-work spec.

- [ ] **Step 2: Update `handleConnectionStatus` to re-enable the power button on reconnect**

Find `function handleConnectionStatus` (around line 596) and the line that manages submit button disabled state:

```ts
submitBtn.disabled = status !== "connected" || !selectedSessionId;
```

Add a line immediately after to also manage the power button:

```ts
powerBtn.disabled = status !== "connected";
```

This handles three scenarios automatically:
1. Initial page load: WS not yet connected → button disabled, then enabled once the `connected` status fires.
2. User triggers restart: `sendShutdownRequest` disables the button; the WS close event triggers `reconnecting` status (button stays disabled); when the new server accepts the reconnection, `connected` fires and the button re-enables.
3. User triggers shutdown: WS close fires, status goes `reconnecting` indefinitely, button stays disabled until the user manually restarts the server.

- [ ] **Step 3: Run typecheck, biome, and tests**

```bash
bun run typecheck 2>&1
bun run check 2>&1 | tail -5
bun test 2>&1 | tail -8
```

Expected: all clean.

- [ ] **Step 4: Rebuild the client**

```bash
bun run build:client 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add client/app.ts
git commit -m "feat(client): handle server-info and server-exiting messages"
```

---

## Task 11: Manual end-to-end verification

**Files:** None

No code changes. This task is a scripted manual test to verify the whole feature works live, end-to-end, in the browser. Do this with the trayce server running in the background.

- [ ] **Step 1: Start a fresh server**

```bash
bash scripts/stop.sh 2>/dev/null || true
bash scripts/start.sh
```

Note the URL from the output. Open it in a browser.

- [ ] **Step 2: Verify the power button is visible and enabled**

Visual check: the top bar shows a `⏻` power icon to the right of the connection status indicator. The icon is not grayed out. Hovering over it shows "Server controls".

- [ ] **Step 3: Test the popover — click and cancel**

Click the power button. A popover with three buttons (Restart, Shutdown, Cancel) appears below the button. Click Cancel. The popover closes and the power button no longer has its "active" highlight.

- [ ] **Step 4: Test click-outside dismiss**

Click the power button to open the popover again. Click anywhere else on the page outside the popover. The popover closes.

- [ ] **Step 5: Test escape-key dismiss**

Click the power button to open the popover. Press Escape. The popover closes.

- [ ] **Step 6: Test restart (the main event)**

1. Draw something on the canvas.
2. Note the server PID: `jq .pid /tmp/trayce/state.json`
3. Click the power button → click Restart.
4. Observe: toast "Server restarting…", power button grays out, connection status indicator shows "Reconnecting…".
5. Wait 3-5 seconds. The connection status should return to "Connected" and the power button should re-enable.
6. Check the server PID again: `jq .pid /tmp/trayce/state.json` — should be DIFFERENT from step 2.
7. Check the token: `jq .token /tmp/trayce/state.json` — should be the SAME as before the restart (preserved via env var).
8. The canvas content should still be present (it's browser-side state, unaffected by server restart). Draw a second stroke to verify the new connection is working. Submit to verify the session still routes properly.

**If the reconnect fails** (connection status stays "Reconnecting…" forever): the spawned server didn't come up or is using a different token. Check `/tmp/trayce/server.log` and compare the new token in `/tmp/trayce/state.json` with what the browser is trying to send (visible in the URL bar).

- [ ] **Step 7: Test shift-click fast-path for restart**

1. Note the PID: `jq .pid /tmp/trayce/state.json`
2. Shift-click the power button (no popover should appear).
3. Observe: toast appears immediately, button disables, reconnect cycle runs as in step 6.
4. Verify the PID changed.

- [ ] **Step 8: Test shutdown**

1. Click the power button → click Shutdown.
2. Observe: toast "Server shutting down…", power button grays out, connection status goes to "Reconnecting…" then stays there indefinitely.
3. Check: `ls /tmp/trayce/state.json` — file should not exist.
4. The browser's reconnect loop keeps trying but never succeeds.
5. Manually restart from terminal: `bash scripts/start.sh`. Note the new token in the URL output.
6. The browser needs to be reloaded with the new token URL to reconnect (since shutdown doesn't preserve the token). This is expected behavior.

- [ ] **Step 9: Test container-mode tooltip copy (optional, only if you can run in a container)**

```bash
TRAYCE_CONTAINER=1 bash scripts/start.sh
```

Open the URL. Click the power button. Hover over the Restart button and verify the tooltip says something like "Exit this process; orchestrator will restart if configured" instead of the bare-metal version.

- [ ] **Step 10: Final automated check**

```bash
bun run typecheck
bun run check
bun test
```

Expected: all clean, 392 pass 0 fail.

- [ ] **Step 11: Stop the test server**

```bash
bash scripts/stop.sh
```

- [ ] **Step 12: No commit**

This is a verification task, no code changed. If anything in steps 1-10 failed, go back to the relevant earlier task and fix.

---

## Task 12: Update CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add an entry under Unreleased / Added**

In `CHANGELOG.md`, find the `## Unreleased` → `### Added` section. Add at the top:

```md
- **Web-initiated server shutdown and restart.** A new power button in the top bar (right of the connection status indicator) opens a small popover with Restart, Shutdown, and Cancel actions. Restart spawns a detached `scripts/start.sh` child with `TRAYCE_TOKEN` preserved, so the browser's existing reconnect-with-backoff loop picks up the new server within a few seconds with no user action. Shutdown cleanly exits the server; the browser then stays in "Disconnected" state until the user manually restarts from a terminal. Shift-click on the power button is a fast path to restart with no confirmation dialog, for power users iterating on server/bridge code. Three new protocol messages wire this through the Round 3 discriminated unions: `ShutdownRequestMessage` (browser → server), `ServerExitingMessage` (server → browser ack), and `ServerInfoMessage` (sent on connect, carries `containerMode` so the popover tooltip copy adapts honestly when Trayce is running under a container orchestrator). Design: `docs/superpowers/specs/2026-04-08-server-shutdown-restart-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG entry for server shutdown/restart feature"
```

---

## Done

After Task 12, the feature is complete. Quick sanity:

```bash
bun run typecheck
bun run check
bun test
bun run build:client
git log --oneline -15
```

Expected: all clean; git log shows ~11 commits from this plan (Tasks 1-10 + Task 12, Task 11 has no commit).

The vault update (`/code-to-docs --update`) is optional and separate from this plan — run it when you want the docs-vault to reflect the new feature.
