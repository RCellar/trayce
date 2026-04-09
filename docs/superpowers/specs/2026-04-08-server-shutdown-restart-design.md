# Server Shutdown/Restart From the Web UI

**Date:** 2026-04-08
**Status:** Design — not yet implemented
**Author:** Brainstormed collaboratively

## Context

Trayce runs as a long-lived Bun HTTP/WebSocket server (`server/`) managed by `scripts/start.sh` (daemonized) or by a container orchestrator (`compose.yml` / `Dockerfile`). The only way to restart the server today is `bash scripts/stop.sh && bash scripts/start.sh` from a terminal. For iterative development — editing server or bridge code, then wanting to test the change — that context switch is friction.

Goal: a single control in the web UI that shuts down or restarts the server. On restart, the browser's existing WebSocket reconnect-with-backoff loop picks up the new server seamlessly, so the user never leaves the canvas tab.

## Goals

1. Web-initiated **restart** that is transparent to the browser: the user sees a brief "restarting…" toast and their connection resumes within a few seconds, with the same session state and submissions.
2. Web-initiated **shutdown** for ending a work session without a terminal.
3. Fast-path **shift-click = restart, no confirmation** for power users iterating quickly.
4. Honest container-mode behavior: in a container, restart means `process.exit(0)` and the orchestrator handles the rest.
5. Full integration with the Round 3 discriminated-union protocol so both new message variants are compile-time enforced in the exhaustive switches.

## Non-goals

- Authentication or authorization beyond the existing token gate. Anyone who can connect to the WS can already submit, watch sessions, etc.; adding shutdown does not meaningfully expand that. Out of scope for this feature.
- A full "server admin panel." This is one button, one popover, two actions.
- Restart-without-token-preservation. The whole point of the seamless flow is that the browser reconnects without user intervention. Rotating tokens on every restart defeats the use case.
- Supporting restart in bare-metal deployments where `scripts/start.sh` is not usable. If `start.sh` fails, the server still exits and the user must manually restart.

## Protocol additions (`shared/protocol.ts`)

Three new message types, added to the existing discriminated unions.

### `ShutdownRequestMessage` — browser → server

```ts
export interface ShutdownRequestMessage {
  type: "shutdown-request";
  restart: boolean; // false = clean exit, true = spawn replacement before exit
}
```

Joins `BrowserToServerMessage`. The `restart` field is boolean rather than a second message variant because the server-side dispatch difference is just "also spawn a child before exiting" — not two distinct handlers.

### `ServerExitingMessage` — server → browser

```ts
export interface ServerExitingMessage {
  type: "server-exiting";
  restart: boolean;       // echoes the request so the browser knows what to expect
  containerMode: boolean; // true → orchestrator will handle restart
}
```

Joins `ServerToBrowserMessage`. Sent immediately after the server accepts a shutdown request, before the actual process exit. Best-effort: if the socket closes before flush, the browser falls through to its normal disconnect path and reconnect loop, which still handles the restart case correctly.

### `ServerInfoMessage` — server → browser

```ts
export interface ServerInfoMessage {
  type: "server-info";
  containerMode: boolean;
  // Room to grow: version, uptime, etc. as future fields
}
```

Joins `ServerToBrowserMessage`. Sent once per browser connection at the time of `addBrowser()` (alongside the existing initial `sessions` broadcast). Gives the client the container-mode flag ahead of time so the popover tooltip copy can adapt without waiting for a shutdown attempt to find out. Dedicated message rather than a field on `SessionsMessage` for architectural clarity: container mode is a server property, not a session property, and piggybacking would conflate the two.

## Server implementation

### Dispatch (`server/websocket.ts`)

`WebSocketHub`'s constructor gains a `shutdownFn` parameter. The hub does not own process lifecycle; `server/index.ts` does. The hub just knows how to invoke it.

```ts
constructor(
  private readonly registry: SessionRegistry,
  private readonly submissions: SubmissionStore,
  private readonly config: Config,
  private readonly shutdownFn: (opts: { restart: boolean; containerMode: boolean }) => void,
  private readonly now: () => number = Date.now,
) {}
```

New case in `handleBrowserMessage`'s exhaustive switch:

```ts
case "shutdown-request": {
  const containerMode = this.detectContainerMode();
  safeSend(ws, JSON.stringify({
    type: "server-exiting",
    restart: msg.restart,
    containerMode,
  } satisfies ServerExitingMessage));
  // Give the socket ~50ms to flush the ack before we start tearing down.
  setTimeout(() => this.shutdownFn({ restart: msg.restart, containerMode }), 50);
  return;
}
```

Adding this case is load-bearing for the Round 3 exhaustiveness guarantee: if we add `ShutdownRequestMessage` to the union without handling it here, `tsc` refuses to build.

`addBrowser` gains one extra send to deliver `ServerInfoMessage`:

```ts
addBrowser(ws: Ws): void {
  this.browsers.set(ws.data.id, ws);
  this.rateBuckets.set(ws.data.id, []);
  safeSend(ws, JSON.stringify({
    type: "server-info",
    containerMode: this.detectContainerMode(),
  } satisfies ServerInfoMessage));
  this.sendSessions(ws);
}
```

Container mode detection (private method, memoized on first call):

```ts
private _containerMode: boolean | null = null;
private detectContainerMode(): boolean {
  if (this._containerMode !== null) return this._containerMode;
  this._containerMode = existsSync("/.dockerenv") || Bun.env.TRAYCE_CONTAINER === "1";
  return this._containerMode;
}
```

### Process lifecycle (`server/index.ts`)

New function alongside the existing `shutdown(signal)` handler for SIGTERM/SIGINT. The two paths are separate because the WS-initiated flow can also spawn a replacement.

```ts
async function initiateShutdown({ restart, containerMode }: { restart: boolean; containerMode: boolean }) {
  console.log(`[trayce] ${restart ? "restart" : "shutdown"} requested via WS`);
  clearInterval(heartbeatTimer);
  clearInterval(cleanupTimer);
  server.stop(true);                              // releases port 9740
  try { await unlink(config.stateFile); } catch {}
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
  // Container mode or shutdown: just exit. If the container has a restart
  // policy, the orchestrator relaunches us; otherwise the container stops.
  process.exit(0);
}
```

`initiateShutdown` is passed to `WebSocketHub` at construction time.

### `scripts/start.sh` compatibility check

`start.sh` currently:
1. Reads `/tmp/trayce/state.json` to see if a server is already running
2. If running and responsive, returns `{"status": "reused", ...}`
3. Otherwise starts a new `bun run server/index.ts` in the background

When called from inside the dying server, `initiateShutdown` has already unlinked `state.json` before the spawn, so step 1 sees no existing server and step 3 runs. Need to verify during implementation that `start.sh`'s backgrounding pattern (nohup / &) fully detaches the new `bun` process from the short-lived bash subprocess we spawned — if not, when our parent exits and the bash dies, the bun child dies with it. Fix in `start.sh` if needed as part of this work.

## Client implementation

### Top bar button (`client/index.html` + `client/style.css`)

New button element in the top bar, immediately after the existing connection status indicator:

```html
<header id="top-bar">
  <div class="left">...</div>
  <div class="right">
    <span id="connection-status" class="status">...</span>
    <button type="button" id="server-power-btn" class="power-btn" title="Server controls">⏻</button>
    <!-- existing session selector, submit button, etc. -->
  </div>
</header>
```

CSS: monochrome power glyph, hover state, disabled state when `connection` is null or not connected, `.active` state when the popover is open. Small — <20 lines of CSS.

### Power button popover (`client/app.ts`)

A new small state machine, not a reusable component. Mirrors the existing popover pattern in `theme.ts` (click-outside dismiss, escape-key dismiss, single popover at a time). Not extracted into a shared component for this iteration; if we add a third popover in the future we can refactor then.

```ts
const powerBtn = document.getElementById("server-power-btn") as HTMLButtonElement;
let powerPopover: HTMLElement | null = null;
let containerMode = false; // set by server-info message

powerBtn.addEventListener("click", (e) => {
  if (!connection?.isConnected) return;
  if (e.shiftKey) {
    // Fast path: skip popover, skip confirm, restart immediately.
    sendShutdownRequest(true);
    return;
  }
  if (powerPopover) { closePowerPopover(); return; }
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
  restartBtn.addEventListener("click", () => { closePowerPopover(); sendShutdownRequest(true); });

  const shutdownBtn = document.createElement("button");
  shutdownBtn.type = "button";
  shutdownBtn.className = "popover-btn shutdown";
  shutdownBtn.textContent = "Shutdown";
  shutdownBtn.title = containerMode
    ? "Exit this process; container will stop unless restart policy is set"
    : "Stop the server; you'll need to start it again from a terminal";
  shutdownBtn.addEventListener("click", () => { closePowerPopover(); sendShutdownRequest(false); });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "popover-btn cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", closePowerPopover);

  powerPopover.append(restartBtn, shutdownBtn, cancelBtn);

  // Position below the button, right-aligned
  const rect = powerBtn.getBoundingClientRect();
  powerPopover.style.top = `${rect.bottom + 4}px`;
  powerPopover.style.right = `${window.innerWidth - rect.right}px`;

  document.body.appendChild(powerPopover);
  powerBtn.classList.add("active");

  // Click-outside and escape-key dismiss, same pattern as theme.ts
  requestAnimationFrame(() => {
    const dismissClick = (e: MouseEvent) => {
      if (powerPopover && !powerPopover.contains(e.target as Node) && e.target !== powerBtn) {
        closePowerPopover();
      }
    };
    const dismissEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePowerPopover();
    };
    document.addEventListener("click", dismissClick);
    document.addEventListener("keydown", dismissEsc);
    // Stored on the element so closePowerPopover can clean them up
    (powerPopover as any)._dismissClick = dismissClick;
    (powerPopover as any)._dismissEsc = dismissEsc;
  });
}

function closePowerPopover(): void {
  if (!powerPopover) return;
  document.removeEventListener("click", (powerPopover as any)._dismissClick);
  document.removeEventListener("keydown", (powerPopover as any)._dismissEsc);
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

### Handling incoming messages (`client/connection.ts` + `client/app.ts`)

`Connection.handleMessage` currently routes via a generic callback. Two new branches in the app's message handler:

```ts
case "server-info":
  containerMode = msg.containerMode;
  break;

case "server-exiting": {
  const action = msg.restart ? "restarting" : "shutting down";
  const where = msg.containerMode ? " (orchestrator will handle restart)" : "";
  showToast(`Server ${action}${where}…`);
  submitBtn.disabled = true;
  powerBtn.disabled = true;
  break;
}
```

The browser's existing exponential-backoff reconnect loop in `connection.ts` handles the recovery automatically:

- **Restart path:** WS closes → reconnect attempts at 1s, 2s, 4s, … until the new server is up (typically 2-3s). Token is preserved via the env var the parent passed to the child. The next reconnect attempt succeeds with no user action. Once connected, a fresh `sessions` and `server-info` broadcast arrive, and the client re-enables submit and the power button.
- **Shutdown path:** WS closes → reconnect attempts forever, never succeed. Browser stays in "Disconnected" state. User must manually `bash scripts/start.sh` and reload the page to get the new token.

The submit button and power button are re-enabled automatically when the `connection` module reports a successful reconnect — add that to the existing `handleConnectionStatus` callback.

## Container mode

Detection: `existsSync("/.dockerenv") || Bun.env.TRAYCE_CONTAINER === "1"`. The `TRAYCE_CONTAINER` env var is an opt-in escape hatch for contexts where `/.dockerenv` isn't present (rootless podman, some CI runners). The `Dockerfile` should set `ENV TRAYCE_CONTAINER=1` to remove any ambiguity.

In container mode:
- `initiateShutdown` never spawns `scripts/start.sh` (the script is for bare-metal daemonization).
- Both restart and shutdown reduce to `process.exit(0)`.
- The client popover's tooltip copy explains what will actually happen: "orchestrator will restart if configured" vs. "container will stop unless restart policy is set".
- The actual outcome depends on the orchestrator's restart policy. We don't try to detect or override it.

## Tests (`tests/server/websocket.test.ts`)

New `describe` block with a shutdown spy passed to the hub constructor. No test actually exits the process or spawns a subprocess — those are boundary effects.

1. **Browser sends `shutdown-request` with `restart: true`** → spy called with `{ restart: true, containerMode: <boolean> }`. Browser receives `server-exiting` message with `restart: true` before the spy fires.
2. **Browser sends `shutdown-request` with `restart: false`** → spy called with `{ restart: false, ... }`. Browser receives `server-exiting` with `restart: false`.
3. **Bridge sends `shutdown-request`** → spy NOT called; no `server-exiting` sent. Documents that bridges cannot initiate shutdown (the type is only in `BrowserToServerMessage`, so the bridge's cast to `BridgeToServerMessage` falls through the runtime-silent default in `handleBridgeMessage`).
4. **New browser connection** → receives `server-info` message in addition to the existing `sessions` broadcast.

All other existing tests must continue to pass. The hub constructor change requires adding a dummy `shutdownFn` spy to every existing test's `makeHub()` helper.

## Edge cases and explicit decisions

| Situation | Behavior | Rationale |
|---|---|---|
| Browser clicks power button while already disconnected | Click is a no-op; button visually grayed out | `!connection?.isConnected` guard in click handler |
| User clicks Restart twice in quick succession | Second click is ignored; first click disables the button | `powerBtn.disabled = true` in `sendShutdownRequest` |
| `scripts/start.sh` fails (missing, permission denied, etc.) | Old server still exits cleanly; browser reconnect loop runs forever against nothing | Degraded case; user must manually restart from terminal |
| Spawned child inherits parent's env including stale stuff | Intentional — we explicitly override `TRAYCE_TOKEN` and leave the rest | `env: { ...process.env, TRAYCE_TOKEN: token }` is explicit |
| Bridge reconnect after restart | Works automatically via existing bridge-no-state-reread fix (vault issue, resolved earlier) | Bridge re-reads `state.json` on each reconnect attempt |
| Server `server.stop(true)` doesn't release port before child binds | `server.stop(true)` blocks until all connections are closed and the socket is released, so the port should be free by the time `Bun.spawn` runs on the next line. **Verify during implementation** — if there's a race, add a small `await new Promise(r => setTimeout(r, 100))` between stop and spawn. | Bun's `stop(true)` contract, with a cheap fallback if needed |
| `server-exiting` ack doesn't flush before WS close | Browser falls through to normal disconnect → reconnect path; no toast, but functional | Best-effort ack, documented as such |
| Multiple browsers connected, one triggers restart | All browsers receive `server-exiting` broadcast? No — only the triggering browser gets it as a point-to-point response | Other browsers learn about the restart via the WS close event + reconnect |
| Container mode with `restart: false` and no restart policy | Container stops. Same as `docker compose stop` externally. | Honest outcome of `process.exit(0)` |
| Container mode with `restart: true` and `restart: always` policy | Container briefly cycles; comes back with a new token (unless `TRAYCE_TOKEN` is in the compose env, which it should be for stable reconnect) | Document in the compose.yml comments: persist `TRAYCE_TOKEN` if you want seamless browser reconnect across orchestrator restarts |

## Files touched

| File | Change |
|---|---|
| `shared/protocol.ts` | Add `ShutdownRequestMessage`, `ServerExitingMessage`, `ServerInfoMessage`; add to respective unions |
| `server/websocket.ts` | Constructor takes `shutdownFn`; new `shutdown-request` case in `handleBrowserMessage`; `addBrowser` sends `server-info`; `detectContainerMode` helper |
| `server/index.ts` | `initiateShutdown` function; passed to hub; container-mode detection (duplicated on both sides is fine, or extracted to a shared helper) |
| `scripts/start.sh` | Verify / fix detachment so spawned `bun` outlives the calling bash |
| `client/connection.ts` | Route `server-info` and `server-exiting` to app callback |
| `client/app.ts` | Power button wiring, popover state machine, `sendShutdownRequest`, message handlers for `server-info` and `server-exiting`, re-enable buttons on reconnect |
| `client/index.html` | Power button element in top bar |
| `client/style.css` | `.power-btn`, `.server-power-popover`, `.popover-btn` styles |
| `tests/server/websocket.test.ts` | 4 new tests; update `makeHub` helper to take shutdown spy |

Estimated change footprint: ~250 lines added, ~30 modified.

## Out of scope (explicitly)

- **Restart with server code changes**: the spawned child runs the same `server/index.ts` that was modified on disk. That IS the point — iterative development. But no build step or `bun install` is triggered, so dependency changes require a terminal round-trip.
- **Live module reload**: no `bun --hot` or HMR. Full process replacement only.
- **Admin panel**: version, uptime, metrics, logs. The `ServerInfoMessage` has room to grow but this iteration is just `containerMode`.
- **Per-bridge shutdown** or "restart just this session": out of scope; this is about the whole server process.
- **Confirm dialog variants**: no "remember my choice", no delay timer. The popover IS the confirmation.
