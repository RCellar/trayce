# App God Module Refactor

**Date:** 2026-04-09
**Scope:** Surgical extraction of three self-contained responsibility clusters from `client/app.ts` (1218 lines) into dedicated modules.

## Problem

`app.ts` is a god module holding ~7 distinct responsibility clusters tied together through ~20 module-level `let` variables. The file is difficult to navigate and reason about.

## Approach

Surgical: extract the three most self-contained clusters as classes that receive dependencies via constructor-injected getters. No shared state object or architectural overhaul — just move code that already has clear boundaries.

**Result:** app.ts drops from ~1218 to ~750 lines. It remains the wiring/bootstrap file but no longer contains domain logic that belongs elsewhere.

## Extractions

### 1. `client/transform.ts` — TransformHandler (~220 lines)

**Current location:** app.ts lines 340–575

**What moves:**
- `HandleId` and `DragMode` types
- `HANDLE_RADIUS_SCREEN` constant
- `transformDrag` state
- Functions: `getHandleAtPoint`, `hitTestTransformBounds`, `updateTransformOverlay`, `handleTransformInput`, `applyResize`

**Interface:**

```ts
export class TransformHandler {
  private drag: DragMode | null = null;

  constructor(private deps: {
    layerManager: () => LayerManager | null;
    compositor: () => Compositor | null;
    canvasManager: () => CanvasManager | null;
  }) {}

  handleInput(transform: LayerTransform, docX: number, docY: number, event: "start" | "move" | "end"): void;
  updateOverlay(): void;
}
```

Private methods: `getHandleAtPoint`, `hitTestTransformBounds`, `applyResize`.

**app.ts changes:**
- Import and instantiate after canvas init with getter deps
- Replace `handleTransformInput(...)` → `transformHandler.handleInput(...)`
- Replace `updateTransformOverlay()` → `transformHandler.updateOverlay()`
- Delete all moved code

### 2. `client/permission-prompts.ts` — PermissionPromptManager (~150 lines)

**Current location:** app.ts lines 616–767

**What moves:**
- `pendingPermissions` map
- Functions: `dismissPermissionPrompt`, `dismissAllPermissions`, `showPermissionPrompt`

**Interface:**

```ts
export class PermissionPromptManager {
  private pending = new Map<string, { el: HTMLElement; timer: ReturnType<typeof setTimeout> }>();

  constructor(private deps: {
    connection: () => Connection | null;
    container: HTMLElement;
  }) {}

  show(msg: { requestId: string; toolName: string; description: string; inputPreview: string }): void;
  dismissAll(reason: string): void;
  dismiss(requestId: string, reason: string): void;
}
```

`show` takes a plain object — the fields are already extracted from `ServerMessage` at the call site in `handleServerMessage`.

**app.ts changes:**
- Import and instantiate with `connection` getter and `#toast-container` element
- Replace `showPermissionPrompt(msg)` → `permissionPrompts.show(msg)`
- Replace `dismissAllPermissions(...)` → `permissionPrompts.dismissAll(...)`
- Delete all moved code

### 3. `client/power-popover.ts` — PowerPopover (~100 lines)

**Current location:** app.ts lines 1008–1108

**What moves:**
- `powerPopover` state variable
- Functions: `openPowerPopover`, `closePowerPopover`, `sendShutdownRequest`
- The `powerBtn.addEventListener("click", ...)` handler

**Interface:**

```ts
export class PowerPopover {
  private popover: HTMLElement | null = null;

  constructor(private deps: {
    powerBtn: HTMLButtonElement;
    connection: () => Connection | null;
    containerMode: () => boolean;
  }) {}
  // Constructor attaches the click handler to powerBtn.
  // No public methods needed — fully self-managing.
}
```

Private methods: `handleClick`, `open`, `close`, `sendShutdown`.

**Cleanup:** The current code stores dismiss handlers on the DOM element via unsafe casts (`powerPopover as unknown as { _dismissClick: ... }`). The class makes these clean instance fields.

**app.ts changes:**
- Import and instantiate with `powerBtn`, `connection` getter, and `containerMode` getter
- `powerBtn` DOM query stays in app.ts (still used by `handleConnectionStatus` for `disabled` state)
- Delete `powerPopover` variable, all four functions, and the click listener

## What stays in app.ts (~750 lines)

- Module-level state declarations and DOM element queries
- `initUIComponents()` — toolbar, image tool, floating panel, side panel, tabs, theme wiring
- `initResolutionSelector()` — resolution dropdown
- `initCanvas()` — CanvasManager, LayerManager, Compositor, InputHandler, History, LayersUI setup
- `handleInput()` — drawing input dispatch (delegates to TransformHandler when appropriate)
- `initConnection()` — token handling, Connection instantiation
- `handleConnectionStatus()` — status display updates
- `handleServerMessage()` — message routing (now thinner, delegates to PermissionPromptManager)
- `handleCanvasPush()` / `handleImageImport()` — image layer creation from pushed/imported images
- `updateSessionSelect()` — session dropdown management
- Submit handler, keyboard shortcuts, zoom handler
- Boot sequence (4 init calls)

## Dependency pattern

All three classes use the same pattern: constructor receives a `deps` object with getter functions for late-bound state (`() => LayerManager | null`). This is necessary because the managers are `null` at module load time and only populated during `initCanvas()` / `initConnection()`. The getters resolve lazily at call time.

## Testing

Existing tests in `tests/client/` are unaffected — they test `layers`, `stroke`, `connection`, `history`, and `persistence`, none of which are touched by this refactor.

New unit tests are not required for this round. The extracted classes contain the same logic with the same behavior; this is a move-only refactor. If tests are added later, the class interfaces make them straightforward to write with mock deps.

## Out of scope

- Introducing a shared `AppContext` object
- Extracting keyboard shortcuts, session management, or submit flow
- Refactoring `initUIComponents` or `initCanvas`
- Changing any runtime behavior
