# Changelog

All notable changes to Trayce are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project does not yet tag versioned releases, so changes land under `Unreleased` until a release is cut.

## Unreleased

### Added

- **`bun run typecheck`** script running `tsc --noEmit`. Server and bridge code runs through `bun run` which strips types at runtime, so type errors previously shipped unnoticed until a test happened to hit the affected code path. This closes that gap.
- **`client/canvas.ts` — `CanvasManager.resize()`** method that calls `app.queueResize()` and re-applies viewport centering. Used by the side-panel toggle callback.
- **Stricter `tsconfig.json`** on top of `strict: true`: `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

### Fixed

- **`TRAYCE_MAX_WS_PAYLOAD_BYTES` is now actually enforced.** `maxPayloadLength` was passed at the root of `Bun.serve` options where Bun silently ignored it; moved into the `websocket: {}` config block. The env var was a no-op until this fix. Users who were relying on the implicit 16 MB default are unaffected; users who set the env var expecting it to take effect will now see it enforced.
- **Side-panel toggle no longer crashes the canvas.** `client/app.ts` called `canvasManager.resize()` from the side-panel open/close callback, but the method did not exist. Any attempt to toggle the panel would throw.
- **WebGPU renderer no longer crashes the compositor.** `client/compositor.ts` guarded the sprite-update loop with `if (!this.app.renderer.gl) return;`. `renderer.gl` does not exist on PixiJS's WebGPU backend, so the guard itself would throw on browsers that picked WebGPU. Replaced with a renderer-agnostic presence check. The code still assumes WebGL semantics elsewhere; forcing `preference: 'webgl'` at `Application.init()` is a future hardening step.
- **`sprite.blendMode` is now type-checked.** `client/compositor.ts` typed `BLEND_MAP` as `Record<BlendMode, string>`, which silently passed plain strings to PixiJS's stricter `BLEND_MODES` enum. Retyped to `Record<BlendMode, BLEND_MODES>`.
- **`client/sessions-ui.ts` no longer crashes on empty session lists.** `update()` used to call `sessions[0].id` in the else branch with no empty-array guard, throwing on any fresh state where no sessions were registered. Now handles empty gracefully. A sibling crash in the `client/app.ts` session bootstrap at the same pattern was also fixed.
- **Bugs caught and fixed during the Round 2 null-guard sweep** in `client/compositor.ts`, `client/layers.ts`, `client/layers-ui.ts`, `client/export.ts`, `client/touch.ts`, `client/tools/lasso.ts`, `client/markdown.ts`, `client/stroke.ts`, `client/theme.ts`, `client/toolbar.ts`, `client/usage-tab.ts`, `server/usage.ts`, `server/websocket.ts`, `server/config.ts`, and `bridge/transcript-watcher.ts`.

### Removed

- **Dead code surfaced by `noUnusedLocals`/`noUnusedParameters`** in `client/app.ts`: unused `Command` type import, unused `dialog` DOM lookup, unread `brushSettingsUI`/`colorPicker` module bindings (instances still constructed), `transformSnapshot` undo stub that was write-only with a "not yet integrated" comment, unused `dot` variable in the connection status handler.
- **Write-only fields** in `client/sessions-ui.ts` (`sessions`) and `client/shortcuts.ts` (`isPanning`).
- **Unused `private container` constructor field** in `client/color-picker.ts` — promoted to a plain parameter since it was only used in the constructor body.
- **Unused `BLEND_OPTIONS` constant and `BlendMode` import** in `client/layers-ui.ts`.
- **Unused test imports and helpers** in `tests/bridge/transcript-watcher.test.ts`, `tests/client/layers.test.ts`, `tests/client/side-panel.test.ts`, `tests/server/bridge-routing.test.ts`, `tests/server/sessions.test.ts`, `tests/server/submissions.test.ts`, `tests/server/websocket.test.ts`.

### Changed

- **`Config.token`, `WsData.sessionId`, `TranscriptWatcher.onUsage`** changed from `?`-optional to explicit `T | undefined`. With `exactOptionalPropertyTypes`, `?` does not permit assigning `undefined` explicitly; `T | undefined` is the correct shape for "present-but-possibly-undefined."
- **`client/toolbar.ts`** — dropped the `Record<string, string>` annotation on `ICONS` so that dot-access keeps its known-string type under `noUncheckedIndexedAccess`.

### Documentation

- **`docs/superpowers/specs/2026-04-08-static-analysis-hardening.md`** — three-round plan for progressively tightening TypeScript and adding a linter (Biome) and a discriminated-union WebSocket protocol. Round 1 and Round 2 are complete; Round 3 is pending.
- **`CLAUDE.md`** — container build note (podman-based), `state.json` as the discovery mechanism for bridges and tooling, transcript-watcher session-lock gotcha from commit `9c74196`.
