# Static Analysis Hardening

**Date:** 2026-04-08
**Status:** Round 1 complete, Round 2 and Round 3 pending
**Context:** Evaluation of linting/static analysis strategies for Trayce. The project had `strict: true` in `tsconfig.json` but no additional compiler flags, no linter, no `typecheck` script, and no CI gate for type errors. Server and bridge code compiles via `bun run` which strips types at runtime, so type errors ship unnoticed until a test hits the affected code path.

## Goal

Progressively tighten TypeScript and add a linter/formatter, in rounds sized so each lands cleanly with tests passing. Each round is a self-contained PR.

## Round 1 — Conservative tsconfig baseline (COMPLETE)

Landed in this commit. See git log for the exact diff.

### Flags enabled

Added to `tsconfig.json` on top of `strict: true`:

- `noImplicitReturns`
- `noUnusedLocals`
- `noUnusedParameters`
- `noFallthroughCasesInSwitch`
- `forceConsistentCasingInFileNames`

### Script added

```json
"typecheck": "tsc --noEmit"
```

Run with `bun run typecheck`.

### Bugs surfaced and fixed

Four real bugs were caught that had nothing to do with the new flags — they were latent `strict` errors that had never been checked because no one ran `tsc --noEmit`.

1. **`server/index.ts`** — `maxPayloadLength` was passed at the root of `Bun.serve` options where Bun ignores it. Moved into the `websocket: {}` config where it's actually read. The `TRAYCE_MAX_WS_PAYLOAD_BYTES` env var was silently doing nothing until this fix.
2. **`client/compositor.ts:46`** — `renderer.gl` presence check would type-error (and crash at runtime) if PixiJS picked the WebGPU backend. Replaced with a renderer-agnostic check. Note: the project still assumes WebGL semantics elsewhere; forcing `preference: 'webgl'` at `app.init()` is worth considering if WebGPU rendering turns out to break anything.
3. **`client/compositor.ts:95`** — `BLEND_MAP` was typed `Record<BlendMode, string>`, so `sprite.blendMode = BLEND_MAP[...]` silently passed a plain string to Pixi's stricter `BLEND_MODES` enum. Retyped to `Record<BlendMode, BLEND_MODES>`.
4. **`client/app.ts:177`** — `canvasManager.resize()` was called from the side-panel toggle callback but the method didn't exist. Any attempt to open/close the side panel would throw. Added `resize()` on `CanvasManager` that calls `app.queueResize()` and re-applies viewport centering.

### Dead code removed

18 unused-locals/imports cleaned up across client and tests — notably `transformSnapshot` in `app.ts` which was a write-only stub with a "not yet integrated for undo" comment, and write-only fields in `sessions-ui.ts` and `shortcuts.ts`.

### Verification

- `bunx tsc --noEmit` — clean
- `bun test` — 388 pass, 0 fail
- `bun run build:client` — clean (737 modules, 0.56 MB)

## Round 2 — Aggressive nullability flags (PENDING)

### Flags to enable

Add to `tsconfig.json`:

- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`

### Expected scope

Enabling these two flags on the Round 1 baseline produced **~200 additional errors** across 19 files when measured on commit 0b3e228. Approximate distribution at that commit:

| Count | Code | Source |
|---|---|---|
| ~150 | TS2532 / TS18048 | `noUncheckedIndexedAccess` — array/map access returns `T \| undefined` |
| ~40 | TS2345 | Argument `T \| undefined` not assignable to `T` |
| ~20 | TS2322 | Assignment `T \| undefined` not assignable, or `exactOptional` mismatch |
| ~5 | TS2412 / TS2375 | `exactOptionalPropertyTypes` — optional fields declared without `\| undefined` |

The actual count at the time of work will differ. Re-run `bunx tsc --noEmit` after enabling the flags to get a fresh count before planning.

### Affected files

Concentrated in `client/`: `app.ts`, `compositor.ts`, `layers.ts`, `layers-ui.ts`, `markdown.ts`, `stroke.ts`, `theme.ts`, `toolbar.ts`, `touch.ts`, `tools/lasso.ts`, `tools/shapes.ts`, `tools/text.ts`, plus smaller hits in `export.ts`, `pricing.ts`, `sessions-ui.ts`, `usage-tab.ts`, and a single error in `bridge/transcript-watcher.ts`.

Server code and tests are almost entirely clean.

### Strategy — do this alongside the app.ts god-module refactor

`client/app.ts` is ~966 lines of module-level mutable state (tracked as the `client-god-module` issue in the analysis vault). Most of the `noUncheckedIndexedAccess` errors in `app.ts` come from that same centralized state being accessed without guards — `brushes[toolId]`, `this.layerManager.layers[i]`, etc. Adding `!` assertions or `if (x) return` guards mechanically now and then refactoring later means doing the same work twice and potentially introducing guards in places that the refactor will restructure away.

**Recommended approach:**

1. Do not touch `app.ts` with mechanical null-guards. Instead, combine Round 2 with a structured refactor of `app.ts` into smaller modules. The refactor naturally forces better-typed seams (state owned by classes rather than module-level `let` bindings), which resolves most of the `noUncheckedIndexedAccess` errors through design rather than ceremony.
2. For the non-`app.ts` files — `compositor.ts`, `layers.ts`, `markdown.ts`, `stroke.ts`, `theme.ts`, `toolbar.ts`, `touch.ts`, `tools/*`, `pricing.ts`, `usage-tab.ts` — apply targeted null-guards file by file. These modules are smaller, well-scoped, and unlikely to be restructured soon.
3. `bridge/transcript-watcher.ts` — a single `exactOptionalPropertyTypes` error on the optional `onUsage` callback. Trivial fix: change the type to explicitly allow `undefined`.

### Fix patterns to prefer

When adding guards for `noUncheckedIndexedAccess`:

- **Loop over `Map.entries()` instead of indexing by key** — Map iterators yield `[K, V]` (not `V | undefined`), so `for (const [id, sprite] of this.sprites)` is preferable to `this.sprites.get(id)!` inside a loop you already know the keys for.
- **Use `for...of` over arrays with destructuring** — `for (const layer of layers)` is safer than `for (let i = 0; i < layers.length; i++) { const layer = layers[i] }`.
- **Early-return on the `undefined` branch rather than `!`-assert** — `const brush = brushes[id]; if (!brush) return;` instead of `brushes[id]!`.
- **Prefer `??` with a sensible default over non-null assertion** when a fallback is truly safe.
- **When `!` is unavoidable**, add a comment explaining the invariant — e.g. "layer index was validated above."

For `exactOptionalPropertyTypes`:

- The common fix is to explicitly include `| undefined` on optional properties (e.g. `onUsage?: (usage: UsageData) => void | undefined`) or to avoid assigning `undefined` explicitly — let the property stay absent instead.

### Verification

Same as Round 1:

```bash
bun run typecheck  # must pass
bun test           # must pass (388 tests at time of writing)
bun run build:client  # must build
```

Also worth smoke-testing manually: open the client in a browser, draw a few strokes with each brush, toggle the side panel, import an image, submit a sketch, verify no console errors. Null-guard work is exactly the kind of thing where a mechanical fix can change control flow in subtle ways.

### Deliverable

A single PR containing:
1. The two new tsconfig flags
2. Null-guard fixes in the non-`app.ts` files listed above
3. `bridge/transcript-watcher.ts` fix
4. A note in the PR that `app.ts` errors are deferred to the god-module refactor

OR two PRs:
1. Non-`app.ts` Round 2 work with the flags enabled and a per-file `// @ts-expect-error` or `any`-cast on `app.ts` to keep the build green
2. The `app.ts` refactor, which removes the temporary suppressions as it goes

The single-PR path is cleaner if the god-module refactor happens in the same session. The two-PR path is cleaner if the refactor will take multiple sessions.

## Round 3 — Biome + discriminated union for WebSocket protocol (PENDING)

### Install Biome

```bash
bun add -d --exact @biomejs/biome
bunx biome init
```

Replace the non-existent Prettier setup and the absence of any linter with a single tool. Enable, beyond Biome's recommended preset:

- `noFloatingPromises` (async WebSocket code routinely drops promises)
- `noUnusedImports` (catches disconnected modules like `persistence.ts` was)
- `noExplicitAny`, `noNonNullAssertion` — tighten surgically
- `useConst`, `noVar`, `useTemplate` — standard cleanup

Add scripts:

```json
"lint": "biome check .",
"lint:fix": "biome check --write .",
"format": "biome format --write ."
```

Add `lint` to the pre-commit gate alongside `typecheck` and `test`.

### Discriminated union for the WebSocket message protocol

The `WebSocketHub` routes inbound messages by a `type` discriminator string. Messages are currently typed loosely, which is the root cause of the "message not handled in X path" bugs the vault history shows: `canvas-push-not-buffered`, `submit-ack-no-bridge`, `rate-limit-bridge`, and similar.

Model the protocol as discriminated unions in a shared `protocol.ts` consumed by server, bridge, and client:

```ts
// shared/protocol.ts
export type BrowserToServer =
  | { type: "register"; sessionId: string; label: string }
  | { type: "submit"; pngBase64: string; prompt?: string }
  | { type: "heartbeat" }
  | ...;

export type ServerToBrowser =
  | { type: "sessions"; sessions: Session[] }
  | { type: "ack"; submissionId: string }
  | { type: "error"; message: string }
  | ...;

// etc. for BridgeToServer, ServerToBridge
```

Then in `handleMessage`, use exhaustive `switch` with an `assertNever` helper:

```ts
switch (msg.type) {
  case "register": ...; break;
  case "submit": ...; break;
  // ... all cases
  default: {
    const _exhaustive: never = msg;
    throw new Error(`Unhandled message type: ${(_exhaustive as any).type}`);
  }
}
```

Combined with `noFallthroughCasesInSwitch`, the compiler will force every new message type to be handled everywhere it needs to be. This is likely the single highest-value change in the whole static-analysis effort — it converts an entire class of recurring bugs into compile errors.

### Shared protocol strategy

The three processes don't share a module graph — `server/`, `bridge/`, `client/` are all separate bundle roots. Options:

1. **Duplicate the types** in each module (`server/protocol.ts`, `bridge/protocol.ts`, `client/protocol.ts`) with a lint rule or test that asserts they stay in sync. Ugly but simple.
2. **Put them in a top-level `shared/` directory** and have each bundle root `import type` them. This works because `import type` only pulls types, not runtime code, so the three processes don't actually bundle shared JS. This is the cleaner option.
3. **Generate the types from a schema** (e.g. Zod). Adds a dependency and a build step. Overkill unless you want runtime validation at the WebSocket boundary too — which is a fair case to make, but a bigger decision.

Recommendation: start with option 2 (`shared/protocol.ts`, type-only imports). Revisit Zod if runtime validation becomes a need.

## Round 4 and beyond (IDEAS, NOT COMMITTED)

- Pre-commit hook running `typecheck + lint + test` (via `bun run` — no husky/lint-staged needed)
- GitHub Actions CI gate for the above
- `bun test --coverage` as a quality signal (uncovered files are often disconnected modules)
- Semgrep or similar for security-flavored rules (token in URL, innerHTML usage, etc.) — only if the signal-to-noise ratio holds up

## Open questions for the Round 2 session

1. Is the `app.ts` refactor happening in the same session, or separately? This determines the PR shape.
2. Are any of the `TRAYCE_MAX_WS_PAYLOAD_BYTES`-style latent-bug fixes worth backporting if Trayce has external users, or is the project still solo?
3. Does the Round 3 shared-protocol directory belong at the repo root or under an existing directory? Current layout puts server/bridge/client at root, so `shared/` alongside them is consistent.

## Files to reference

- `tsconfig.json` — where the flags go
- `package.json` — scripts section
- `client/app.ts` — the god module; most Round 2 errors live here
- `server/websocket.ts` — where the Round 3 discriminated union pays off most
- The analysis vault at `docs-vault/Modules/Client.md` — for the `client-god-module` issue context
