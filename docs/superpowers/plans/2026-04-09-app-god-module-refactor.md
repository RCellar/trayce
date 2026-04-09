# App God Module Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract three self-contained responsibility clusters from `client/app.ts` into dedicated modules, reducing it from ~1218 to ~750 lines.

**Architecture:** Each extraction becomes a class with constructor-injected getter dependencies. No shared state object — the classes resolve late-bound state lazily at call time. app.ts remains the wiring/bootstrap file.

**Tech Stack:** TypeScript, Bun test runner, PixiJS (compositor/canvas types)

---

### Task 1: Create feature branch and scaffold

**Files:**
- No file changes — branch setup only

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b refactor/app-god-module
```

Already done as part of plan creation — skip if on this branch.

- [ ] **Step 2: Verify tests pass on the base**

```bash
bun test
```

Expected: All tests pass. This is our baseline — any failure after extraction is a regression.

---

### Task 2: Extract TransformHandler → `client/transform.ts`

**Files:**
- Create: `client/transform.ts`
- Modify: `client/app.ts` (remove lines 341–575, update `initCanvas` render loop, update `handleInput`)

- [ ] **Step 1: Create `client/transform.ts`**

Write the complete `TransformHandler` class. The code is a direct move from app.ts lines 341–575 with the following changes:
- Types `HandleId` and `DragMode` become module-private (not exported)
- `transformDrag` becomes `this.drag`
- `HANDLE_RADIUS_SCREEN` becomes a private readonly field
- Free functions become private methods
- `updateTransformOverlay` becomes `updateOverlay` (public)
- `handleTransformInput` becomes `handleInput` (public)
- All reads of `compositor`, `canvasManager`, `layerManager` go through `this.deps.compositor()` etc.

```ts
import type { CanvasManager } from "./canvas";
import type { Compositor } from "./compositor";
import type { LayerManager, LayerTransform } from "./layers";

type HandleId = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";
type DragMode =
  | { type: "move"; offsetX: number; offsetY: number }
  | {
      type: "resize";
      handle: HandleId;
      anchorX: number;
      anchorY: number;
      startW: number;
      startH: number;
    };

export interface TransformDeps {
  layerManager: () => LayerManager | null;
  compositor: () => Compositor | null;
  canvasManager: () => CanvasManager | null;
}

export class TransformHandler {
  private drag: DragMode | null = null;
  private readonly HANDLE_RADIUS_SCREEN = 6;

  constructor(private deps: TransformDeps) {}

  /** Called from the main input handler when the active layer has a transform. */
  handleInput(
    t: LayerTransform,
    docX: number,
    docY: number,
    event: "start" | "move" | "end",
  ): void {
    const { compositor, layerManager } = this.resolved();

    if (event === "start") {
      const zoom = this.deps.canvasManager()!.viewport.zoom;

      const handle = this.getHandleAtPoint(t, docX, docY, zoom);
      if (handle) {
        const ax = handle.includes("e") ? t.x : handle.includes("w") ? t.x + t.width : t.x;
        const ay = handle.includes("s") ? t.y : handle.includes("n") ? t.y + t.height : t.y;
        this.drag = {
          type: "resize",
          handle,
          anchorX: ax,
          anchorY: ay,
          startW: t.width,
          startH: t.height,
        };
        return;
      }

      if (this.hitTestTransformBounds(t, docX, docY)) {
        this.drag = { type: "move", offsetX: docX - t.x, offsetY: docY - t.y };
        return;
      }

      this.drag = null;
    }

    if (event === "move" && this.drag) {
      if (this.drag.type === "move") {
        t.x = docX - this.drag.offsetX;
        t.y = docY - this.drag.offsetY;
      } else {
        this.applyResize(t, this.drag, docX, docY);
      }
      compositor?.markDirty();
      if (layerManager) layerManager.bumpRevision(layerManager.activeLayer.id);
      this.updateOverlay();
    }

    if (event === "end" && this.drag) {
      this.drag = null;
    }
  }

  /** Redraws the transform overlay (handles + bounding box). */
  updateOverlay(): void {
    const { compositor, canvasManager, layerManager } = this.resolved();
    if (!compositor || !canvasManager || !layerManager) {
      compositor?.clearOverlay();
      return;
    }
    const layer = layerManager.activeLayer;
    if (!layer.transform) {
      compositor.clearOverlay();
      return;
    }
    const stagePos = canvasManager.stage.position;
    compositor.drawTransformOverlay(
      stagePos.x,
      stagePos.y,
      canvasManager.viewport.zoom,
      layer.transform,
    );
  }

  private resolved() {
    return {
      layerManager: this.deps.layerManager(),
      compositor: this.deps.compositor(),
      canvasManager: this.deps.canvasManager(),
    };
  }

  private getHandleAtPoint(
    t: { x: number; y: number; width: number; height: number },
    docX: number,
    docY: number,
    zoom: number,
  ): HandleId | null {
    const r = this.HANDLE_RADIUS_SCREEN / zoom;
    const handles: Array<{ id: HandleId; hx: number; hy: number }> = [
      { id: "nw", hx: t.x, hy: t.y },
      { id: "n", hx: t.x + t.width / 2, hy: t.y },
      { id: "ne", hx: t.x + t.width, hy: t.y },
      { id: "w", hx: t.x, hy: t.y + t.height / 2 },
      { id: "e", hx: t.x + t.width, hy: t.y + t.height / 2 },
      { id: "sw", hx: t.x, hy: t.y + t.height },
      { id: "s", hx: t.x + t.width / 2, hy: t.y + t.height },
      { id: "se", hx: t.x + t.width, hy: t.y + t.height },
    ];
    for (const h of handles) {
      if (Math.abs(docX - h.hx) <= r && Math.abs(docY - h.hy) <= r) return h.id;
    }
    return null;
  }

  private hitTestTransformBounds(
    t: { x: number; y: number; width: number; height: number },
    docX: number,
    docY: number,
  ): boolean {
    return docX >= t.x && docX <= t.x + t.width && docY >= t.y && docY <= t.y + t.height;
  }

  private applyResize(
    t: LayerTransform,
    drag: Extract<DragMode, { type: "resize" }>,
    docX: number,
    docY: number,
  ): void {
    const MIN_SIZE = 10;
    const { handle, anchorX, anchorY, startW, startH } = drag;
    const aspect = startW / startH;

    let newX = t.x,
      newY = t.y,
      newW = t.width,
      newH = t.height;

    if (handle.includes("e")) {
      newW = Math.max(MIN_SIZE, docX - anchorX);
      newX = anchorX;
    } else if (handle.includes("w")) {
      newW = Math.max(MIN_SIZE, anchorX - docX);
      newX = anchorX - newW;
    }

    if (handle.includes("s")) {
      newH = Math.max(MIN_SIZE, docY - anchorY);
      newY = anchorY;
    } else if (handle.includes("n")) {
      newH = Math.max(MIN_SIZE, anchorY - docY);
      newY = anchorY - newH;
    }

    if (handle.length === 2) {
      if (newW / newH > aspect) {
        newW = newH * aspect;
      } else {
        newH = newW / aspect;
      }
      if (handle.includes("w")) newX = anchorX - newW;
      if (handle.includes("n")) newY = anchorY - newH;
    }

    t.x = Math.round(newX);
    t.y = Math.round(newY);
    t.width = Math.round(newW);
    t.height = Math.round(newH);
  }
}
```

- [ ] **Step 2: Update `client/app.ts` — remove transform code and wire in TransformHandler**

Add import at top of app.ts (after the existing imports):

```ts
import { TransformHandler } from "./transform";
```

Delete from app.ts:
- Lines 341–354: `HandleId` type, `DragMode` type, `transformDrag` variable
- Lines 357–575: `HANDLE_RADIUS_SCREEN`, `getHandleAtPoint`, `hitTestTransformBounds`, `updateTransformOverlay`, `handleTransformInput`, `applyResize`

Add a module-level variable in the state section (after `let imageTool`):

```ts
let transformHandler: TransformHandler | null = null;
```

In `initCanvas()`, after `history = new History(50 * 1024 * 1024);` (current line 260), add:

```ts
  transformHandler = new TransformHandler({
    layerManager: () => layerManager,
    compositor: () => compositor,
    canvasManager: () => canvasManager,
  });
```

In `initCanvas()`, update the render loop (current lines 335–338). Replace:

```ts
  canvasManager.app.ticker.add(() => {
    compositor?.update();
    updateTransformOverlay();
  });
```

With:

```ts
  canvasManager.app.ticker.add(() => {
    compositor?.update();
    transformHandler?.updateOverlay();
  });
```

In `handleInput()` (current line 423), replace:

```ts
    handleTransformInput(layer.transform, doc.x, doc.y, event);
```

With:

```ts
    transformHandler?.handleInput(layer.transform, doc.x, doc.y, event);
```

In `initCanvas()` → `LayersUI` callbacks, replace all `updateTransformOverlay()` calls (lines 282, 302, 310, 319) with `transformHandler?.updateOverlay()`.

In `handleImageImport()` (current line 853), replace:

```ts
  updateTransformOverlay();
```

With:

```ts
  transformHandler?.updateOverlay();
```

- [ ] **Step 3: Run tests**

```bash
bun test
```

Expected: All tests pass — same as baseline. No behavioral change.

- [ ] **Step 4: Build client to verify no type errors**

```bash
bun run build:client
```

Expected: Builds successfully with no errors.

- [ ] **Step 5: Commit**

```bash
git add client/transform.ts client/app.ts
git commit -m "refactor(client): extract TransformHandler from app.ts"
```

---

### Task 3: Extract PermissionPromptManager → `client/permission-prompts.ts`

**Files:**
- Create: `client/permission-prompts.ts`
- Modify: `client/app.ts` (remove lines 616–767, update `handleServerMessage`)

- [ ] **Step 1: Create `client/permission-prompts.ts`**

```ts
import type { Connection } from "./connection";

export interface PermissionMessage {
  requestId: string;
  toolName: string;
  description: string;
  inputPreview: string;
}

export class PermissionPromptManager {
  private pending = new Map<
    string,
    { el: HTMLElement; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private deps: {
      connection: () => Connection | null;
      container: HTMLElement;
    },
  ) {}

  /** Build and display a permission prompt. */
  show(msg: PermissionMessage): void {
    const { requestId, toolName, description, inputPreview } = msg;
    const container = this.deps.container;

    const prompt = document.createElement("div");
    prompt.className = "permission-prompt";

    const header = document.createElement("div");
    header.className = "perm-header";
    header.textContent = "Permission Request";

    const tool = document.createElement("div");
    tool.className = "perm-tool";
    tool.textContent = toolName;

    const desc = document.createElement("div");
    desc.className = "perm-desc";
    desc.textContent = description;

    const preview = document.createElement("div");
    preview.className = "perm-preview";
    preview.textContent = inputPreview;

    const actions = document.createElement("div");
    actions.className = "perm-actions";

    const resolve = (behavior: "allow" | "deny") => {
      const pending = this.pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
      }
      this.deps.connection()?.send({ type: "permission-verdict", requestId, behavior });
      prompt.classList.remove("show");
      setTimeout(() => prompt.remove(), 300);
    };

    const allowBtn = document.createElement("button");
    allowBtn.className = "perm-allow";
    allowBtn.textContent = "Allow";
    allowBtn.addEventListener("click", () => resolve("allow"));

    const denyBtn = document.createElement("button");
    denyBtn.className = "perm-deny";
    denyBtn.textContent = "Deny";
    denyBtn.addEventListener("click", () => resolve("deny"));

    actions.appendChild(allowBtn);
    actions.appendChild(denyBtn);

    prompt.appendChild(header);
    prompt.appendChild(tool);
    prompt.appendChild(desc);
    prompt.appendChild(preview);
    prompt.appendChild(actions);

    container.appendChild(prompt);
    prompt.offsetHeight; // force reflow
    prompt.classList.add("show");

    const timer = setTimeout(() => {
      this.dismiss(requestId, "Timed out");
    }, 60_000);
    this.pending.set(requestId, { el: prompt, timer });
  }

  /** Dismiss all pending prompts with a reason message. */
  dismissAll(reason: string): void {
    for (const id of [...this.pending.keys()]) {
      this.dismiss(id, reason);
    }
  }

  /** Dismiss a single prompt by request ID. */
  dismiss(requestId: string, reason: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);

    const el = pending.el;
    const actions = el.querySelector(".perm-actions");
    if (actions) {
      actions.textContent = "";
      const msg = document.createElement("span");
      msg.className = "perm-stale";
      msg.textContent = reason;
      actions.appendChild(msg);
    }
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    }, 1500);
  }
}
```

- [ ] **Step 2: Update `client/app.ts` — remove permission code and wire in PermissionPromptManager**

Add import at top of app.ts:

```ts
import { PermissionPromptManager } from "./permission-prompts";
```

Delete from app.ts:
- Lines 616–620: `pendingPermissions` map declaration
- Lines 622–649: `dismissPermissionPrompt`, `dismissAllPermissions`
- Lines 698–767: `showPermissionPrompt`

Add a module-level variable in the state section:

```ts
let permissionPrompts: PermissionPromptManager | null = null;
```

In `initConnection()`, after `connection = new Connection(...)` (current line 596), add:

```ts
  permissionPrompts = new PermissionPromptManager({
    connection: () => connection,
    container: document.getElementById("toast-container")!,
  });
```

In `handleServerMessage()`, replace the `"permission-request"` branch (current line 693–694):

```ts
  } else if (msg.type === "permission-request") {
    showPermissionPrompt(msg);
  }
```

With:

```ts
  } else if (msg.type === "permission-request") {
    permissionPrompts?.show({
      requestId: msg.requestId as string,
      toolName: msg.toolName as string,
      description: msg.description as string,
      inputPreview: msg.inputPreview as string,
    });
  }
```

Replace the two `dismissAllPermissions("Resolved elsewhere")` calls (in the `"response"` and `"transcript-entry"` branches) with:

```ts
    permissionPrompts?.dismissAll("Resolved elsewhere");
```

- [ ] **Step 3: Run tests**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 4: Build client**

```bash
bun run build:client
```

Expected: Builds successfully.

- [ ] **Step 5: Commit**

```bash
git add client/permission-prompts.ts client/app.ts
git commit -m "refactor(client): extract PermissionPromptManager from app.ts"
```

---

### Task 4: Extract PowerPopover → `client/power-popover.ts`

**Files:**
- Create: `client/power-popover.ts`
- Modify: `client/app.ts` (remove lines 1008–1108, remove `powerPopover` variable)

- [ ] **Step 1: Create `client/power-popover.ts`**

```ts
import type { Connection } from "./connection";

export class PowerPopover {
  private popover: HTMLElement | null = null;
  private dismissClick: ((e: MouseEvent) => void) | null = null;
  private dismissEsc: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private deps: {
      powerBtn: HTMLButtonElement;
      connection: () => Connection | null;
      containerMode: () => boolean;
    },
  ) {
    this.deps.powerBtn.addEventListener("click", (e) => this.handleClick(e));
  }

  private handleClick(e: MouseEvent): void {
    if (!this.deps.connection()?.isConnected) return;
    if (e.shiftKey) {
      this.sendShutdown(true);
      return;
    }
    if (this.popover) {
      this.close();
      return;
    }
    this.open();
  }

  private open(): void {
    const containerMode = this.deps.containerMode();
    const powerBtn = this.deps.powerBtn;

    this.popover = document.createElement("div");
    this.popover.className = "server-power-popover";

    const restartBtn = document.createElement("button");
    restartBtn.type = "button";
    restartBtn.className = "popover-btn restart";
    restartBtn.textContent = "Restart";
    restartBtn.title = containerMode
      ? "Exit this process; orchestrator will restart if configured"
      : "Restart the server; this browser will reconnect automatically";
    restartBtn.addEventListener("click", () => {
      this.close();
      this.sendShutdown(true);
    });

    const shutdownBtn = document.createElement("button");
    shutdownBtn.type = "button";
    shutdownBtn.className = "popover-btn shutdown";
    shutdownBtn.textContent = "Shutdown";
    shutdownBtn.title = containerMode
      ? "Exit this process; container will stop unless restart policy is set"
      : "Stop the server; you'll need to start it again from a terminal";
    shutdownBtn.addEventListener("click", () => {
      this.close();
      this.sendShutdown(false);
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "popover-btn cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this.close());

    this.popover.append(restartBtn, shutdownBtn, cancelBtn);

    const rect = powerBtn.getBoundingClientRect();
    this.popover.style.top = `${rect.bottom + 4}px`;
    this.popover.style.right = `${window.innerWidth - rect.right}px`;

    document.body.appendChild(this.popover);
    powerBtn.classList.add("active");

    requestAnimationFrame(() => {
      this.dismissClick = (ev: MouseEvent) => {
        if (this.popover && !this.popover.contains(ev.target as Node) && ev.target !== powerBtn) {
          this.close();
        }
      };
      this.dismissEsc = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") this.close();
      };
      document.addEventListener("click", this.dismissClick);
      document.addEventListener("keydown", this.dismissEsc);
    });
  }

  private close(): void {
    if (!this.popover) return;
    if (this.dismissClick) document.removeEventListener("click", this.dismissClick);
    if (this.dismissEsc) document.removeEventListener("keydown", this.dismissEsc);
    this.dismissClick = null;
    this.dismissEsc = null;
    this.popover.remove();
    this.popover = null;
    this.deps.powerBtn.classList.remove("active");
  }

  private sendShutdown(restart: boolean): void {
    const conn = this.deps.connection();
    if (!conn?.isConnected) return;
    conn.send({ type: "shutdown-request", restart });
    this.deps.powerBtn.disabled = true;
  }
}
```

- [ ] **Step 2: Update `client/app.ts` — remove power popover code and wire in PowerPopover**

Add import at top of app.ts:

```ts
import { PowerPopover } from "./power-popover";
```

Delete from app.ts:
- The `let powerPopover: HTMLElement | null = null;` variable (current line 88)
- Lines 1008–1108: The `powerBtn.addEventListener("click", ...)` handler, `openPowerPopover`, `closePowerPopover`, `sendShutdownRequest`

In `initConnection()` (or at the boot section at the bottom), after the connection is created, add:

```ts
  new PowerPopover({
    powerBtn,
    connection: () => connection,
    containerMode: () => containerMode,
  });
```

The best place is at the bottom of `initConnection()`, after `connection.connect()`, since that's when the connection is available.

- [ ] **Step 3: Run tests**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 4: Build client**

```bash
bun run build:client
```

Expected: Builds successfully.

- [ ] **Step 5: Commit**

```bash
git add client/power-popover.ts client/app.ts
git commit -m "refactor(client): extract PowerPopover from app.ts"
```

---

### Task 5: Final verification

**Files:**
- No changes — verification only

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 2: Build client**

```bash
bun run build:client
```

Expected: Builds successfully.

- [ ] **Step 3: Verify line count reduction**

```bash
wc -l client/app.ts client/transform.ts client/permission-prompts.ts client/power-popover.ts
```

Expected: `app.ts` is ~750 lines. The three new files total ~470 lines.

- [ ] **Step 4: Verify no leftover references**

```bash
grep -n "transformDrag\|HANDLE_RADIUS_SCREEN\|getHandleAtPoint\|hitTestTransformBounds\|applyResize\|handleTransformInput\|updateTransformOverlay" client/app.ts
grep -n "pendingPermissions\|dismissPermissionPrompt\|dismissAllPermissions\|showPermissionPrompt" client/app.ts
grep -n "openPowerPopover\|closePowerPopover\|sendShutdownRequest\|powerPopover" client/app.ts
```

Expected: No matches for any of these — all references have been replaced.
