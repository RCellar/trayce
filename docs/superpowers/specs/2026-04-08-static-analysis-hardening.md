# Static Analysis Hardening

**Date:** 2026-04-08
**Status:** Round 1, Round 2, and Round 3 complete
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

## Round 2 — Aggressive nullability flags (COMPLETE)

Landed in the same commit cadence as Round 1. See git log.

### Flags enabled

Added to `tsconfig.json`:

- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`

### Actual scope vs. prediction

The spec's original prediction (based on a measurement at commit 0b3e228) was ~200 errors concentrated in `client/app.ts` as the "heavy" file, recommending that Round 2 be combined with the `client-god-module` refactor to avoid doing the same work twice.

**The prediction was wrong on both counts.** Fresh measurement at the start of Round 2 showed:

- **216 errors across 28 files** (not 19)
- **`client/app.ts` had only 15 errors** — not the bulk. The heavy files were `client/layers.ts` (21), `client/compositor.ts` (21), and `client/markdown.ts` (20), all well-scoped modules with no structural concerns.
- **Test files accounted for ~70 errors** (not mentioned in the original estimate), concentrated in `tests/bridge/transcript-watcher.test.ts` (18), `tests/server/websocket.test.ts` (17), and `tests/client/layers.test.ts` (9).

### Actual strategy: decoupled from god-module refactor

Because app.ts's share of the errors was small and the errors were formulaic (six `brushes.pen`/`brushes.pencil`/etc. keyboard-shortcut lookups plus a handful of local guards), mechanical fixes took ~3 minutes of focused work. **The god-module refactor is still worth doing for maintainability, but static-analysis pressure no longer provides any of its motivation.** Round 2 and the app.ts refactor are fully independent.

### Error distribution by root cause

| Count | Code | Pattern |
|---|---|---|
| 93 | TS2532 | `Object is possibly undefined` — mostly array/map index access inside loops |
| 60 | TS18048 | Typed local possibly undefined — usually after destructuring or `Map.get` |
| 33 | TS2345 | Argument `T \| undefined` not assignable — often `arr[arr.length - 1]` |
| 24 | TS2322 | Assignment mismatch — `brushes.pen` (Record lookup), etc. |
| 5 | TS2412 / TS2375 | `exactOptionalPropertyTypes` — `?`-optional fields assigned `undefined` explicitly |
| 1 | TS2769 | Overload mismatch on `path.moveTo(match[1])` |

### Type signature changes (the cleanest fixes)

- **`server/config.ts`** — `Config.token: string | undefined` instead of `token?: string`; added `token: undefined` to `DEFAULTS`. With `exactOptionalPropertyTypes`, `?` means "absent or the declared type" — it does NOT mean "nullable." Explicit `string | undefined` is the correct expression when a value needs to be present-but-possibly-undefined.
- **`server/websocket.ts`** — same treatment for `WsData.sessionId`.
- **`bridge/transcript-watcher.ts`** — same treatment for the `onUsage` private field.
- **`client/toolbar.ts`** — dropped `Record<string, string>` annotation on `ICONS`. With `noUncheckedIndexedAccess`, `Record<K, V>` access returns `V | undefined`, but a bare object literal with known keys keeps dot-access as `string`. Losing the type annotation was a net gain.
- **`client/layers.ts`** — `rasterizeLayer` uses `delete layer.transform` instead of `layer.transform = undefined`. Same runtime semantic, but `exactOptionalPropertyTypes` treats them differently.

### Real bug surfaced in `client/sessions-ui.ts`

`update()` fell through to `this.selectedId = sessions[0].id` in the else branch with no empty-array guard. Would have thrown on any fresh state where no sessions were registered. Now uses `sessions[0]?.id ?? ""`. Similar pattern was also fixed in the app.ts session bootstrap at line 809.

### Mechanical guard patterns

- **Array-indexed loops** (`for (let i = 0; i < arr.length; i++)`) — pull `const x = arr[i]; if (!x) continue;` rather than assertion-everywhere. Applied in `layers.ts`, `compositor.ts`, `layers-ui.ts`, `export.ts`.
- **Known-length tuple destructure** (`Array.from(map.values())` after a size check) — replaced with `const [a, b] = ...; if (!a || !b) return;`. Applied in `touch.ts`.
- **Invariant-safe `!` assertion** — where a loop or length check just proved non-null and the extra guard would be ceremony, `!` with the invariant documented. Applied in `stroke.ts`, `markdown.ts`, `tools/lasso.ts`, `tools/shapes.ts`, `client/pricing.ts`, and the 6 brush-shortcut lookups in `app.ts`.
- **Aggregator pattern fix** — `server/usage.ts` and `client/usage-tab.ts` had the `this.models[key] = new; this.models[key].field++;` idiom three times in a row, which confused the narrower. Rewrote to pull into a local `entry` variable so the compiler narrows once.

### Tests

~70 errors in test files closed with `!` assertions on array accesses (`entries[0]!.content`, `browser.sent[0]!`, `lm.layers[1]!.name`). Test invariants fail loudly when wrong, so defensive guarding was unwarranted. Bulk-replaced per file via `replace_all`.

One `exactOptionalPropertyTypes` fix in `tests/client/history.test.ts` uses a conditional spread for optional `checkpointSize` instead of passing `undefined` explicitly.

### Verification

- `bunx tsc --noEmit` — clean
- `bun test` — 388 pass, 0 fail, 731 expect() calls, 8.34s
- `bun run build:client` — clean (737 modules, 0.56 MB, 47ms)

### Lesson learned for future rounds

**Always re-measure before planning.** The spec was written with a snapshot from an earlier commit, and the recommended strategy (defer app.ts, combine with refactor) was built on assumptions that no longer held by the time Round 2 started. The re-measurement took 30 seconds and changed the entire plan. Future rounds should start with `bunx tsc --noEmit | wc -l` and a per-file breakdown, not with the previous round's predictions.

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

## Round 3 — Biome + discriminated union for WebSocket protocol (COMPLETE)

Landed across three commits following Round 2.

### Biome (step 1, commits 2120052 + d6ab825)

Installed `@biomejs/biome` as a dev dependency. `biome.json` configured to match the existing project style (2-space indent, double quotes, 100-col line width). Rule overrides on top of `recommended`:

| Rule | Setting | Why |
|---|---|---|
| `suspicious/noExplicitAny` | off | Heavily used in tests with `as any` for mock WS types; 277 warnings otherwise, all noise. |
| `suspicious/noControlCharactersInRegex` | off | `client/markdown.ts` uses `\x00` as an intentional placeholder delimiter in its inline-code pass. |
| `style/noNonNullAssertion` | off | Round 2 deliberately added `!` assertions as the correct fix for test invariants. 167 hits otherwise, all noise. |
| `style/noDescendingSpecificity` | off | CSS noise; not worth the churn. |
| `assist/source/organizeImports` | on | Applied in the lint pass. |

`docs-vault/` is excluded from Biome's reach (it's gitignored anyway).

Auto-fixes applied across 10 files via `biome lint --write --unsafe`:
- `useTemplate` — string concatenation → template literals in `theme.ts`, `pricing.ts`, `usage-tab.ts`, and tests
- `useOptionalChain` — `!x || !x.foo` → `!x?.foo` in `tools/image.ts`, `layers.ts`, `transcript-watcher.ts`
- `useParseIntRadix` — missing radix in `server/http.ts`
- `noUnusedVariables` — one variable missed by `tsc`'s `noUnusedLocals`
- `useIterableCallbackReturn` — in `bridge/transcript-watcher.ts`

Manual fixes for the remaining 7 errors:
- **`client/index.html`: dead `<dialog id="new-doc-dialog">` block removed.** Biome flagged 4 buttons for missing `type="button"`. Investigation showed the entire dialog was orphaned: Round 1's dead-code sweep had deleted the JS reference, and a resolution `<select>` in the top bar superseded it. Biome caught what human review had missed.
- `client/index.html`: `<button id="submit-btn">` got explicit `type="button"`.
- `client/index.html`: inline theme-restore script's `forEach` → `for-of`.
- `client/floating-panel.ts`: `updateTabs()` `forEach` → `for-of` (the `classList.toggle` return value was being silently discarded).

Format pass (`biome format --write`) landed as a separate commit covering 52 files, purely mechanical, so the diff stays reviewable.

Scripts added to `package.json`:
- `bun run lint` → `biome lint`
- `bun run format` → `biome format --write`
- `bun run check` → `biome check` (lint + format + assist combined)

### WebSocket protocol discriminated union (step 2)

Created `shared/protocol.ts` — a new top-level directory alongside `server/`, `bridge/`, `client/` containing type-only definitions that all three processes consume via `import type`. Because `import type` is erased at build time, no runtime code actually crosses bundle roots; each process's bundle still stands alone. `tsconfig.json` updated to include `shared/**/*.ts`.

The protocol defines four message-direction unions:
- `BrowserToServerMessage` — `heartbeat | submit | watch-session | permission-verdict`
- `BridgeToServerMessage` — `heartbeat | register | transcript-entry | response | canvas-push | transcript-status | usage-update | permission-request`
- `ServerToBrowserMessage` — the server-originated set plus `SessionScoped<BridgeRoutedMessage>` for bridge messages forwarded to browsers with a `sessionId` tag
- `ServerToBridgeMessage` — `heartbeat | submission | permission-verdict`

Plus supporting entity types (`Session`, `Usage`, `UsageSnapshotData`, `TranscriptEntryData`, `PermissionBehavior`).

`server/websocket.ts` is the main consumer. `handleMessage` was refactored from a cascade of `if (kind === "X" && type === "Y")` branches into a top-level dispatch:

```ts
async handleMessage(ws, raw) {
  const msg = parseMessage(raw);
  if (!msg) return;
  if (msg.type === "heartbeat") { ...; return; }

  if (ws.data.kind === "browser") {
    await this.handleBrowserMessage(ws, msg as BrowserToServerMessage);
  } else {
    this.handleBridgeMessage(ws, msg as BridgeToServerMessage);
  }
}
```

Each of `handleBrowserMessage` and `handleBridgeMessage` is a `switch (msg.type)` over its union, with every variant as an explicit case. The default branch uses the exhaustiveness pattern:

```ts
default: {
  // Compile-time exhaustiveness: a new variant added to the union
  // without a case here becomes a type error (msg narrows to never).
  // Runtime: silently drop — messages come from untrusted clients.
  const _exhaustive: never = msg;
  void _exhaustive;
}
```

**Verified the exhaustiveness check actually fires** by temporarily adding a `FoobarMessage` variant to `BrowserToServerMessage` — `tsc` immediately refused to build with `error TS2322: Type 'FoobarMessage' is not assignable to type 'never'` pointing at the browser switch's default case. Reverted.

### Important design choice: runtime-silent, compile-loud

The original implementation used `assertNever(msg)` in the default branch, which throws. That broke 5 existing tests that deliberately send cross-kind messages (browser sending `register`, bridge sending `submit`, unknown types) to verify graceful drop behavior. The fix was to keep the compile-time guarantee (`const _exhaustive: never = msg`) but replace the throw with `void _exhaustive`. Messages come from untrusted clients; crashing the server hub on a malformed payload is the wrong runtime behavior. The compile-time guarantee is still preserved because TypeScript still enforces the `never` assignment.

**Lesson:** the exhaustiveness pattern has two layers — compile and runtime — and you can decouple them. The common idiom of using an `assertNever(x): never { throw ... }` helper conflates them. For untrusted inputs, keep the compile layer and skip the runtime throw.

### Scope choice: server-only refactor

The spec had suggested refactoring all three modules to use the shared types. In practice, the exhaustiveness check only pays off where a central dispatcher exists, and that's `server/websocket.ts`. The bridge has no such dispatcher — its message handling is linear. The client's `Connection.handleMessage` is small and its message handling is scattered across `app.ts` callbacks; retrofitting it would have been high-churn, low-value work.

**The bridge and client can adopt `shared/protocol.ts` incrementally via `import type` when a future feature benefits from the typing.** Nothing in this refactor blocks that; the types are stable and stand alone.

### Verification

- `bunx tsc --noEmit` — clean
- `bunx biome check` — clean (lint + format + assist)
- `bun test` — 388 pass, 0 fail
- `bun run build:client` — clean

### What was skipped

- **Zod / runtime validation.** The types describe intent, not guarantee. Runtime validation (checking `typeof msg.sessionId === "string"` etc.) remains the existing ad-hoc pattern inside each handler. Worth revisiting only if input-validation bugs become a pattern.
- **Pre-commit hook / CI gate.** Out of scope for Round 3; reserved for Round 4 if someone wants it.

### Original Round 3 plan (for reference)

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

## Round 4 — Runtime validation at the WS boundary (PENDING)

### Motivation

Round 3 gave us compile-time guarantees that every server handler addresses every message variant. But the types describe INTENT, not runtime REALITY — a bridge or browser can still send `{ type: "submit", targetSessionId: 42 }` and the handler will hit its ad-hoc `typeof === "string"` check and return without explanation. Recurring issues in the analysis vault point to validation gaps:

- `server-usage-no-validation` + `server-nan-timestamp-usage-update` — `usage-update` payload cast with `as any`; NaN timestamps slip through the nullish-coalescing guard and poison `firstTimestamp`/`lastTimestamp` aggregation forever
- `server-wsmessage-permissive` — `WsMessage` is structurally `{ type: string; [key: string]: unknown }`, so every field access inside handlers has to re-validate with inline assertions
- `server-config-token-whitespace-coerce` — whitespace-only `TRAYCE_TOKEN` silently coerces to `undefined`; a schema validator at the env boundary would surface this with a clear error

### Design

Add Zod (or Valibot — lighter) at the WebSocket parse boundary and the env boundary, NOT everywhere. Narrow scope:

1. **`shared/protocol-schema.ts`** (new file) — Zod schemas mirroring the discriminated unions in `shared/protocol.ts`. One schema per union (`BrowserToServerSchema`, `BridgeToServerSchema`), each a `z.discriminatedUnion("type", [...])` so the schema's type narrows match the TypeScript union's.
2. **`server/websocket.ts`** — `parseMessage` returns `BrowserToServerMessage | BridgeToServerMessage | null` instead of `WsMessage | null`. The runtime validation happens once at parse time; handlers receive already-narrowed, already-validated data. Inline `typeof === "string"` checks inside handlers can be deleted.
3. **`server/config.ts`** — `getConfig` uses a Zod schema to parse `TRAYCE_*` env vars with explicit error messages for malformed values. Whitespace-only `TRAYCE_TOKEN` becomes a loud warning instead of a silent coercion.
4. **`WsMessage` type deleted.** `shared/protocol.ts` is the only source of truth for inbound shapes.

### Keep the runtime-silent, compile-loud idiom

The Round 3 lesson applies here too. When Zod validation fails at the parse boundary, log the failure (`console.warn("[trayce] invalid payload:", error.issues)`) and drop the message — don't throw. Messages come from untrusted clients. The schemas give us:
- A single authoritative source describing the wire format
- Free runtime validation with structured error reports
- Schema-derived TypeScript types (via `z.infer<typeof Schema>`) that stay in sync with the runtime checks — no possibility of drift between the type and the validator

### Tradeoffs

- **Bundle size (server)**: Zod is ~15KB minified. Server is Node/Bun so size is irrelevant; client isn't touched by this work.
- **Valibot vs Zod**: Valibot is smaller (~3KB), tree-shakeable, has a similar API. For a server-only dependency Zod's ecosystem + TypeScript inference quality wins. Only consider Valibot if the client ever needs runtime validation too.
- **Bridge cost**: Bridge currently doesn't validate anything it receives from the server (the `submission` message is trusted). Worth adding schemas for `ServerToBridgeMessage` too for symmetry, but lower priority — the server is a trusted sender.
- **Test impact**: Tests that send malformed payloads deliberately (to verify graceful drop) will still work — Zod validation failure is a silent drop by design.

### Scope

**Include:**
- `BrowserToServerMessage` + `BridgeToServerMessage` schemas at parse time
- `Config` env schema with helpful error messages
- Delete `WsMessage` and all the inline `typeof` checks it necessitated

**Exclude:**
- Schemas for outbound messages (`ServerToBrowserMessage`, `ServerToBridgeMessage`) — those are built by typed code we control, not untrusted input
- Client-side schemas — client is a trusted consumer of server messages
- Bridge-side schemas for `ServerToBridgeMessage` — lower priority, add only if a bug surfaces

### Fixes this will directly enable

- `server-usage-no-validation` → **resolved** by schema requiring `timestamp: z.number().finite()`
- `server-nan-timestamp-usage-update` → **resolved** (same)
- `server-wsmessage-permissive` → **resolved** (`WsMessage` deleted)
- `server-config-token-whitespace-coerce` → **resolved** by env schema with `.refine()` or custom `parse`

Four open issues close with one round of work. Worth it.

## Round 5 — CI gate + pre-commit hook (PENDING)

### Motivation

Rounds 1–4 produce a lot of static guarantees (strict tsconfig, Biome, discriminated unions, runtime validation at boundaries). None of them matter if a commit bypasses the checks. Without enforcement, these rules drift into aspiration the first time someone `git commit`s without running `bun run check` locally.

### Design

Two layers:

**Layer 1 — pre-commit hook (local, per-developer).**

Use the native git hooks mechanism, not husky or lint-staged. Bun is fast enough that running the full check suite on every commit is tolerable (<15s typically). Ship a hook script in `scripts/pre-commit.sh` and a one-line `bun run install-hooks` script that copies or symlinks it into `.git/hooks/pre-commit`. Don't touch `.git/hooks` automatically on `bun install` — opt-in only, to stay polite to contributors who have their own git workflow.

Hook runs:
```bash
#!/bin/sh
set -e
bun run typecheck
bun run check
bun test
```

`set -e` aborts the commit on any failure. Failures print the tool's normal output so developers can fix in place.

**Layer 2 — GitHub Actions CI gate (server-side, authoritative).**

Single workflow file at `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run check
      - run: bun test
      - run: bun run build:client
```

No matrix, no caching gymnastics, no nested jobs. One check that runs everything. If it fails, PR gets a red X. Simple.

Branch protection rule on `main` requiring the `check` status: applied manually in GitHub repo settings (not committed to the repo since it's a GitHub-side config).

### What NOT to do

- **No husky.** Native git hooks work fine. Husky adds a dependency, a postinstall step, and a config file for something that's 4 lines of shell.
- **No lint-staged.** The staged-files optimization matters when each tool takes minutes; Biome and tsc both run on the full tree in seconds. Don't optimize what isn't slow.
- **No branch-matrix caching dance.** `bun install --frozen-lockfile` is ~2s; not worth the complexity.
- **No separate lint/test/typecheck jobs.** Splitting them adds parallelism but also three sets of GitHub status checks to track, three sets of bun install, and three places to debug a hung runner. One job, one status, one green/red.

### Tradeoffs

- **Hook opts-in, CI opts-out**: developers can skip the local hook (`git commit --no-verify`) but can't skip CI. That's the right balance — local hooks are a convenience, CI is the authority.
- **Slow pre-commit on large commits**: if the full check suite ever exceeds ~20s, switch to running only `typecheck` + `check` in the hook and leaving tests for CI. The hook's job is catching "did I break the build"; tests catch "did I break behavior" and can tolerate running on push.
- **`bun test --coverage` in CI**: worth adding as a second step once the gate is stable. Uncovered files are often disconnected modules (the `client-persistence-disconnected` issue would have been caught by coverage). Don't fail CI on coverage regression — just surface the delta.

### Files added

- `.github/workflows/ci.yml`
- `scripts/pre-commit.sh`
- New `install-hooks` script in `package.json` that symlinks `scripts/pre-commit.sh` → `.git/hooks/pre-commit`
- One paragraph in `CLAUDE.md` or `README.md` pointing at the hook as an optional quality-of-life setup

### Order of operations

Do Round 5 AFTER Round 4. If we set up CI before runtime validation lands, the first Round 4 commit has to update both the code and the CI expectations at once, which complicates the merge. Land validation, confirm it's stable, then lock the gate.

## Round 6 and beyond (IDEAS, NOT COMMITTED)

- `bun test --coverage` surfaced as a CI artifact (not a gate)
- Semgrep or similar for security-flavored rules (token in URL, innerHTML usage, etc.) — only if the signal-to-noise ratio holds up
- Type-only adoption of `shared/protocol.ts` in `client/connection.ts` and `bridge/index.ts` when a future feature benefits
- Pre-commit hook opt-in via a `setup-dev.sh` script that also installs the MCP channel config for Claude Code

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
