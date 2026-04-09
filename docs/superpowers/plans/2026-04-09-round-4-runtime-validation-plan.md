# Round 4: Runtime Validation at the WS Boundary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Zod schemas at the WebSocket parse boundary and the env boundary so the Trayce server's protocol handlers receive pre-validated, typed data instead of the current loose `WsMessage` + `as any` + ad-hoc `typeof` checks.

**Architecture:** Two pieces. (1) `shared/protocol-schema.ts` (new file) — Zod discriminated unions mirroring `BrowserToServerMessage` and `BridgeToServerMessage` from `shared/protocol.ts`, with strict field validation for everything except `submit` (which keeps permissive fields so the handler's user-facing error codes still work). `WebSocketHub.parseMessage` becomes two methods — `parseBrowserMessage` and `parseBridgeMessage` — that return validated union types. `WsMessage` is deleted. Inline `typeof` checks in `handleRegister`, `handleWatchSession`, and the `shutdown-request` case get removed since Zod covers them. (2) `server/config.ts` — a targeted whitespace-`TRAYCE_TOKEN` warning fix, since the rest of the env parsing is already well-validated by `parsePort`/`parseBool`.

**Tech Stack:** Zod v3, Bun, TypeScript discriminated unions, existing Round 3 exhaustive-switch pattern.

**Spec:** `docs/superpowers/specs/2026-04-08-static-analysis-hardening.md` (Round 4 section, lines 342–394)

**Directly closes four open vault issues:**
- `server-usage-no-validation`
- `server-nan-timestamp-usage-update`
- `server-wsmessage-permissive`
- `server-config-token-whitespace-coerce`

---

## Pre-flight checks

From repo root `/run/media/system/Dos/Projects/trayce`:

```bash
bun run typecheck   # expect clean
bun run check       # expect clean
bun test            # expect 393 pass, 0 fail
```

Baseline is green at commit `20eb436`. If any of these fail before you start, stop and investigate — the plan assumes a clean starting state.

**Branch setup:**

```bash
git checkout -b feat/round-4-runtime-validation
```

---

## Task 1: Install Zod and create protocol-schema.ts with entity-level schemas

**Files:**
- Create: `shared/protocol-schema.ts`
- Modify: `package.json` (Zod dependency)
- Modify: `bun.lock` (auto-updated)

The new file starts with the "leaf" schemas that individual message schemas will compose: `PermissionBehaviorSchema`, `TranscriptEntryDataSchema`, `UsageSchema`, `SessionSchema`. These match the types in `shared/protocol.ts` but with runtime validation. The file also defines a shared `HeartbeatSchema` used by both direction unions.

No tests yet — Task 2 adds the first test as part of the TDD sequence for `BrowserToServerSchema`.

- [ ] **Step 1: Install Zod**

```bash
bun add zod@^3
```

Expected: `@biomejs/biome` and `zod` appear in `package.json`'s `devDependencies`/`dependencies`. Zod lands in `dependencies` because it's used at runtime by the server.

- [ ] **Step 2: Create `shared/protocol-schema.ts`**

```ts
/**
 * Zod schemas for Trayce's WebSocket protocol.
 *
 * Mirror the discriminated-union types in shared/protocol.ts but with runtime
 * validation. Used by server/websocket.ts at the parse boundary to guarantee
 * that message handlers receive well-formed, narrowed payloads — no more
 * `as any` casts or ad-hoc `typeof` checks inside handlers.
 *
 * Scope:
 * - Browser → Server (strict per variant, except Submit which keeps permissive
 *   fields so the handler's user-facing error codes still fire for bad input)
 * - Bridge → Server (all strict; bridge is infrastructure, not user-facing)
 * - Outbound messages (Server → Browser, Server → Bridge) are NOT schema-
 *   validated — they're built by typed code we control.
 *
 * On validation failure the parser logs at warn level and returns null, so
 * handlers never see malformed data. This preserves the Round 3 runtime-
 * silent / compile-loud idiom: untrusted clients can't crash the server by
 * sending garbage, but the compiler still enforces exhaustive handling.
 */

import { z } from "zod";

// ────────────────────────────────────────────────────────────────────────────
// Leaf schemas (entity types)
// ────────────────────────────────────────────────────────────────────────────

export const PermissionBehaviorSchema = z.enum(["allow", "allow_once", "deny"]);

export const SessionSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.string().optional(),
});

export const TranscriptEntryDataSchema = z.object({
  type: z.enum(["message", "response", "tool-call", "tool-result"]),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.number().finite(),
  toolName: z.string().optional(),
  toolInput: z.string().optional(),
  toolUseId: z.string().optional(),
});

export const UsageSchema = z.object({
  // Non-negative integers — a negative count would be a bridge bug, silently
  // ignore. `.finite()` rejects NaN and Infinity, which fixes the
  // `server-nan-timestamp-usage-update` issue: a poisoned timestamp that
  // slipped through `?? Date.now()` no longer corrupts aggregator ordering.
  inputTokens: z.number().int().nonnegative().finite(),
  outputTokens: z.number().int().nonnegative().finite(),
  cacheReadTokens: z.number().int().nonnegative().finite(),
  cacheWriteTokens: z.number().int().nonnegative().finite(),
  model: z.string(),
  timestamp: z.number().finite(),
});

// Shared message schema: heartbeat works in any direction.
export const HeartbeatSchema = z.object({
  type: z.literal("heartbeat"),
});
```

- [ ] **Step 3: Verify typecheck, biome, and tests stay clean**

```bash
bun run typecheck 2>&1 | tail -3
bunx biome check shared/protocol-schema.ts 2>&1 | tail -3
bun test 2>&1 | tail -5
```

Expected: no errors, 393 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock shared/protocol-schema.ts
git commit -m "feat(protocol): add Zod entity schemas for runtime validation"
```

---

## Task 2: Add BrowserToServerSchema with TDD

**Files:**
- Modify: `shared/protocol-schema.ts`
- Create: `tests/shared/protocol-schema.test.ts`

This task adds all 5 `BrowserToServerMessage` variants and the union, driven by tests.

**Design note:** `SubmitSchema` is deliberately permissive. The current `handleSubmit` in `server/websocket.ts` has user-facing error responses (`INVALID_TARGET`, `EMPTY_SUBMISSION`) that existing tests assert — if Zod rejected submit payloads with missing fields before they reached the handler, those error responses wouldn't fire and the tests would fail. The schema validates that `type === "submit"` and that any provided fields have the right type, but makes `targetSessionId`, `image`, and `prompt` all optional. The handler keeps its existing checks.

- [ ] **Step 1: Write failing tests**

Create `tests/shared/protocol-schema.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { BrowserToServerSchema } from "../../shared/protocol-schema";

describe("BrowserToServerSchema — heartbeat", () => {
  test("accepts bare heartbeat", () => {
    const r = BrowserToServerSchema.safeParse({ type: "heartbeat" });
    expect(r.success).toBe(true);
  });

  test("rejects heartbeat with extra required-field expectations — none", () => {
    // Heartbeat has no fields. An extra field is silently stripped by z.object.
    const r = BrowserToServerSchema.safeParse({ type: "heartbeat", junk: 1 });
    expect(r.success).toBe(true);
  });
});

describe("BrowserToServerSchema — submit (permissive)", () => {
  test("accepts a fully-specified submit", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "submit",
      targetSessionId: "s1",
      image: "base64data",
      prompt: "hello",
    });
    expect(r.success).toBe(true);
  });

  test("accepts submit with missing targetSessionId (handler validates)", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "submit",
      image: "base64data",
    });
    expect(r.success).toBe(true);
  });

  test("accepts submit with neither image nor prompt (handler validates)", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "submit",
      targetSessionId: "s1",
    });
    expect(r.success).toBe(true);
  });

  test("rejects submit with wrong-type image", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "submit",
      targetSessionId: "s1",
      image: 42,
    });
    expect(r.success).toBe(false);
  });
});

describe("BrowserToServerSchema — watch-session (strict)", () => {
  test("accepts valid watch-session", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "watch-session",
      sessionId: "s1",
    });
    expect(r.success).toBe(true);
  });

  test("rejects watch-session with missing sessionId", () => {
    const r = BrowserToServerSchema.safeParse({ type: "watch-session" });
    expect(r.success).toBe(false);
  });

  test("rejects watch-session with non-string sessionId", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "watch-session",
      sessionId: 42,
    });
    expect(r.success).toBe(false);
  });

  test("rejects watch-session with empty sessionId", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "watch-session",
      sessionId: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("BrowserToServerSchema — permission-verdict (strict)", () => {
  test("accepts valid allow verdict", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "permission-verdict",
      requestId: "req-1",
      behavior: "allow",
    });
    expect(r.success).toBe(true);
  });

  test("accepts allow_once and deny", () => {
    for (const behavior of ["allow_once", "deny"]) {
      const r = BrowserToServerSchema.safeParse({
        type: "permission-verdict",
        requestId: "req-1",
        behavior,
      });
      expect(r.success).toBe(true);
    }
  });

  test("rejects invalid behavior string", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "permission-verdict",
      requestId: "req-1",
      behavior: "maybe",
    });
    expect(r.success).toBe(false);
  });

  test("rejects missing requestId", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "permission-verdict",
      behavior: "allow",
    });
    expect(r.success).toBe(false);
  });
});

describe("BrowserToServerSchema — shutdown-request (strict)", () => {
  test("accepts restart: true", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "shutdown-request",
      restart: true,
    });
    expect(r.success).toBe(true);
  });

  test("accepts restart: false", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "shutdown-request",
      restart: false,
    });
    expect(r.success).toBe(true);
  });

  test("rejects missing restart field", () => {
    const r = BrowserToServerSchema.safeParse({ type: "shutdown-request" });
    expect(r.success).toBe(false);
  });

  test("rejects non-boolean restart", () => {
    const r = BrowserToServerSchema.safeParse({
      type: "shutdown-request",
      restart: "yes",
    });
    expect(r.success).toBe(false);
  });
});

describe("BrowserToServerSchema — unknown types", () => {
  test("rejects unknown type", () => {
    const r = BrowserToServerSchema.safeParse({ type: "bogus" });
    expect(r.success).toBe(false);
  });

  test("rejects payload with no type field", () => {
    const r = BrowserToServerSchema.safeParse({ foo: 1 });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
bun test tests/shared/protocol-schema.test.ts 2>&1 | tail -10
```

Expected: the test file fails because `BrowserToServerSchema` isn't exported yet.

- [ ] **Step 3: Add the variant schemas and the union to `shared/protocol-schema.ts`**

Append to `shared/protocol-schema.ts`, below the leaf schemas:

```ts
// ────────────────────────────────────────────────────────────────────────────
// Browser → Server
// ────────────────────────────────────────────────────────────────────────────

/**
 * SubmitSchema is intentionally PERMISSIVE. The handler in
 * server/websocket.ts validates `targetSessionId`, `image`, and `prompt`
 * itself and sends user-facing error codes (`INVALID_TARGET`,
 * `EMPTY_SUBMISSION`) when they're missing — existing tests depend on
 * those error responses. If the schema rejected missing-field submits at
 * the parse boundary, those responses wouldn't fire. The schema's job
 * here is just to guarantee the overall shape and the `type` discriminant.
 */
export const SubmitSchema = z.object({
  type: z.literal("submit"),
  targetSessionId: z.string().optional(),
  image: z.string().optional(),
  prompt: z.string().optional(),
});

export const WatchSessionSchema = z.object({
  type: z.literal("watch-session"),
  sessionId: z.string().min(1),
});

export const PermissionVerdictSchema = z.object({
  type: z.literal("permission-verdict"),
  requestId: z.string().min(1),
  behavior: PermissionBehaviorSchema,
});

export const ShutdownRequestSchema = z.object({
  type: z.literal("shutdown-request"),
  restart: z.boolean(),
});

export const BrowserToServerSchema = z.discriminatedUnion("type", [
  HeartbeatSchema,
  SubmitSchema,
  WatchSessionSchema,
  PermissionVerdictSchema,
  ShutdownRequestSchema,
]);
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun test tests/shared/protocol-schema.test.ts 2>&1 | tail -10
```

Expected: all tests in this file pass.

- [ ] **Step 5: Run full suite and biome**

```bash
bun test 2>&1 | tail -5
bun run typecheck 2>&1 | tail -3
bunx biome check 2>&1 | tail -3
```

Expected: full suite green (393 + new tests), typecheck clean, biome clean. If biome wants formatting tweaks, run `bunx biome format --write` and re-check.

- [ ] **Step 6: Commit**

```bash
git add shared/protocol-schema.ts tests/shared/protocol-schema.test.ts
git commit -m "feat(protocol): add BrowserToServerSchema with strict Zod validation"
```

---

## Task 3: Add BridgeToServerSchema with TDD

**Files:**
- Modify: `shared/protocol-schema.ts`
- Modify: `tests/shared/protocol-schema.test.ts`

Eight bridge-side variants: heartbeat, register, transcript-entry, response, canvas-push, transcript-status, usage-update, permission-request. All strict (bridge is infrastructure; bad payloads should be dropped, not errored).

The critical schema here is `UsageUpdateSchema` — its `UsageSchema` component uses `.finite()` on `timestamp`, which is what closes the `server-nan-timestamp-usage-update` issue.

- [ ] **Step 1: Add tests for each bridge variant**

Append to `tests/shared/protocol-schema.test.ts`:

```ts
import { BridgeToServerSchema } from "../../shared/protocol-schema";

describe("BridgeToServerSchema — heartbeat", () => {
  test("accepts bare heartbeat", () => {
    const r = BridgeToServerSchema.safeParse({ type: "heartbeat" });
    expect(r.success).toBe(true);
  });
});

describe("BridgeToServerSchema — register", () => {
  test("accepts valid register", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "register",
      sessionId: "s1",
      label: "my-session",
    });
    expect(r.success).toBe(true);
  });

  test("rejects register with empty sessionId", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "register",
      sessionId: "",
      label: "my-session",
    });
    expect(r.success).toBe(false);
  });

  test("rejects register with empty label", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "register",
      sessionId: "s1",
      label: "",
    });
    expect(r.success).toBe(false);
  });

  test("rejects register with non-string label", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "register",
      sessionId: "s1",
      label: 42,
    });
    expect(r.success).toBe(false);
  });
});

describe("BridgeToServerSchema — transcript-entry", () => {
  test("accepts valid transcript-entry", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "transcript-entry",
      entry: {
        type: "message",
        role: "user",
        content: "hello",
        timestamp: 1_700_000_000_000,
      },
    });
    expect(r.success).toBe(true);
  });

  test("rejects transcript-entry with NaN timestamp", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "transcript-entry",
      entry: {
        type: "message",
        role: "user",
        content: "hello",
        timestamp: Number.NaN,
      },
    });
    expect(r.success).toBe(false);
  });

  test("rejects transcript-entry with invalid role", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "transcript-entry",
      entry: {
        type: "message",
        role: "bot",
        content: "hello",
        timestamp: 1_700_000_000_000,
      },
    });
    expect(r.success).toBe(false);
  });
});

describe("BridgeToServerSchema — response", () => {
  test("accepts response with just content", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "response",
      content: "answer",
    });
    expect(r.success).toBe(true);
  });

  test("accepts response with explicit format", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "response",
      content: "# hi",
      format: "markdown",
    });
    expect(r.success).toBe(true);
  });

  test("rejects response with invalid format", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "response",
      content: "hi",
      format: "html",
    });
    expect(r.success).toBe(false);
  });
});

describe("BridgeToServerSchema — canvas-push", () => {
  test("accepts valid canvas-push", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "canvas-push",
      image: "base64data",
    });
    expect(r.success).toBe(true);
  });

  test("rejects canvas-push with missing image", () => {
    const r = BridgeToServerSchema.safeParse({ type: "canvas-push" });
    expect(r.success).toBe(false);
  });
});

describe("BridgeToServerSchema — transcript-status", () => {
  test("accepts each valid status", () => {
    for (const status of ["running", "idle", "error"]) {
      const r = BridgeToServerSchema.safeParse({
        type: "transcript-status",
        status,
      });
      expect(r.success).toBe(true);
    }
  });

  test("rejects invalid status", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "transcript-status",
      status: "waiting",
    });
    expect(r.success).toBe(false);
  });
});

describe("BridgeToServerSchema — usage-update (strict, closes NaN bug)", () => {
  const validUsage = {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 25,
    cacheWriteTokens: 0,
    model: "claude-opus-4-6",
    timestamp: 1_700_000_000_000,
  };

  test("accepts valid usage-update", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "usage-update",
      usage: validUsage,
    });
    expect(r.success).toBe(true);
  });

  test("rejects usage-update with NaN timestamp (closes server-nan-timestamp-usage-update)", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "usage-update",
      usage: { ...validUsage, timestamp: Number.NaN },
    });
    expect(r.success).toBe(false);
  });

  test("rejects usage-update with Infinity timestamp", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "usage-update",
      usage: { ...validUsage, timestamp: Number.POSITIVE_INFINITY },
    });
    expect(r.success).toBe(false);
  });

  test("rejects usage-update with negative token count", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "usage-update",
      usage: { ...validUsage, inputTokens: -1 },
    });
    expect(r.success).toBe(false);
  });

  test("rejects usage-update with non-integer token count", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "usage-update",
      usage: { ...validUsage, inputTokens: 1.5 },
    });
    expect(r.success).toBe(false);
  });

  test("rejects usage-update with missing usage object", () => {
    const r = BridgeToServerSchema.safeParse({ type: "usage-update" });
    expect(r.success).toBe(false);
  });
});

describe("BridgeToServerSchema — permission-request", () => {
  test("accepts valid permission-request", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "permission-request",
      requestId: "req-1",
      toolName: "Bash",
    });
    expect(r.success).toBe(true);
  });

  test("accepts permission-request with toolInput", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "permission-request",
      requestId: "req-1",
      toolName: "Bash",
      toolInput: { command: "ls" },
    });
    expect(r.success).toBe(true);
  });

  test("rejects permission-request with missing requestId", () => {
    const r = BridgeToServerSchema.safeParse({
      type: "permission-request",
      toolName: "Bash",
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
bun test tests/shared/protocol-schema.test.ts 2>&1 | tail -10
```

Expected: new tests fail because `BridgeToServerSchema` isn't exported yet.

- [ ] **Step 3: Append the bridge variant schemas and union to `shared/protocol-schema.ts`**

```ts
// ────────────────────────────────────────────────────────────────────────────
// Bridge → Server
// ────────────────────────────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  type: z.literal("register"),
  sessionId: z.string().min(1),
  label: z.string().min(1),
});

export const TranscriptEntryMessageSchema = z.object({
  type: z.literal("transcript-entry"),
  entry: TranscriptEntryDataSchema,
});

export const ResponseSchema = z.object({
  type: z.literal("response"),
  content: z.string(),
  format: z.enum(["markdown", "plain"]).optional(),
});

export const CanvasPushSchema = z.object({
  type: z.literal("canvas-push"),
  image: z.string(),
  label: z.string().optional(),
});

export const TranscriptStatusSchema = z.object({
  type: z.literal("transcript-status"),
  status: z.enum(["running", "idle", "error"]),
});

export const UsageUpdateSchema = z.object({
  type: z.literal("usage-update"),
  usage: UsageSchema,
});

export const PermissionRequestSchema = z.object({
  type: z.literal("permission-request"),
  requestId: z.string().min(1),
  toolName: z.string().min(1),
  toolInput: z.unknown().optional(),
});

export const BridgeToServerSchema = z.discriminatedUnion("type", [
  HeartbeatSchema,
  RegisterSchema,
  TranscriptEntryMessageSchema,
  ResponseSchema,
  CanvasPushSchema,
  TranscriptStatusSchema,
  UsageUpdateSchema,
  PermissionRequestSchema,
]);
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun test tests/shared/protocol-schema.test.ts 2>&1 | tail -10
```

Expected: all schema tests pass.

- [ ] **Step 5: Full suite + biome**

```bash
bun test 2>&1 | tail -5
bun run typecheck 2>&1 | tail -3
bunx biome check 2>&1 | tail -3
```

Expected: full suite green, typecheck clean, biome clean.

- [ ] **Step 6: Commit**

```bash
git add shared/protocol-schema.ts tests/shared/protocol-schema.test.ts
git commit -m "feat(protocol): add BridgeToServerSchema with strict Zod validation"
```

---

## Task 4: Swap WebSocketHub.parseMessage to use the new schemas

**Files:**
- Modify: `server/websocket.ts`

Replace the single `parseMessage(raw): WsMessage | null` with two direction-specific methods that use Zod to parse AND validate in one step. `handleMessage` picks the right parser based on `ws.data.kind`. The `as BrowserToServerMessage` and `as BridgeToServerMessage` casts inside `handleMessage` become real, verified narrowings.

Behavior for valid payloads is unchanged — all existing tests must still pass. Behavior for invalid payloads matches the current "silently drop" contract but now covers more cases (any field that doesn't match the schema). Existing tests like `"ignores watch-session with non-string sessionId"` still pass because the end effect is the same (nothing gets sent to the ws, no handler state changes).

- [ ] **Step 1: Add imports at the top of `server/websocket.ts`**

Find the existing Round 3 import block near the top of the file. Add imports for the new schemas (leave the existing protocol type imports; Zod-inferred types can be used alongside them):

```ts
import {
  BridgeToServerSchema,
  BrowserToServerSchema,
} from "../shared/protocol-schema";
```

- [ ] **Step 2: Replace `parseMessage` with direction-specific parsers**

Find the existing `static parseMessage(raw: string | Buffer): WsMessage | null` method (around line 79). Replace the whole method with:

```ts
static parseBrowserMessage(raw: string | Buffer): BrowserToServerMessage | null {
  return WebSocketHub.parseWithSchema(raw, BrowserToServerSchema, "browser");
}

static parseBridgeMessage(raw: string | Buffer): BridgeToServerMessage | null {
  return WebSocketHub.parseWithSchema(raw, BridgeToServerSchema, "bridge");
}

private static parseWithSchema<T>(
  raw: string | Buffer,
  schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: { issues: unknown } } },
  kind: "browser" | "bridge",
): T | null {
  let data: unknown;
  try {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    data = JSON.parse(text);
  } catch {
    // Malformed JSON — silently drop. Untrusted input.
    return null;
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    // Runtime-silent, compile-loud: log the validation failure so a dev
    // tailing server.log can see it, but don't throw — crashing on bad
    // input from untrusted clients is the wrong runtime behavior.
    console.warn(`[trayce] invalid ${kind} payload:`, result.error.issues);
    return null;
  }
  return result.data;
}
```

Note: the `parseWithSchema` helper is typed with a structural interface on `schema` rather than importing Zod's `ZodType` directly. That's deliberate — it keeps the Zod import surface in `server/websocket.ts` minimal and the structural type matches what both `BrowserToServerSchema` and `BridgeToServerSchema` expose.

- [ ] **Step 3: Update `handleMessage` to use the new parsers**

Find `async handleMessage(ws: Ws, raw: string | Buffer)` (around line 136). Replace the body with:

```ts
async handleMessage(ws: Ws, raw: string | Buffer): Promise<void> {
  if (ws.data.kind === "browser") {
    const msg = WebSocketHub.parseBrowserMessage(raw);
    if (!msg) return;

    if (msg.type === "heartbeat") {
      ws.data.lastHeartbeat = this.now();
      safeSend(ws, JSON.stringify({ type: "heartbeat" }));
      return;
    }

    await this.handleBrowserMessage(ws, msg);
  } else {
    const msg = WebSocketHub.parseBridgeMessage(raw);
    if (!msg) return;

    if (msg.type === "heartbeat") {
      ws.data.lastHeartbeat = this.now();
      safeSend(ws, JSON.stringify({ type: "heartbeat" }));
      return;
    }

    this.handleBridgeMessage(ws, msg);
  }
}
```

The heartbeat handling is now duplicated inside each branch — that's intentional: heartbeat lives in both unions, and the parser returns the narrowed type for each direction. Duplicating is cheaper than defining a third `HeartbeatOnlySchema` just to dedupe three lines.

- [ ] **Step 4: Typecheck and run tests**

```bash
bun run typecheck 2>&1
bun test 2>&1 | tail -8
```

Expected: typecheck clean, all tests still pass (393 + the 40-ish new schema tests). If typecheck fails complaining about `BrowserToServerMessage` or `BridgeToServerMessage` not being assignable, check that the imports at the top of `server/websocket.ts` still include `type BrowserToServerMessage` and `type BridgeToServerMessage` from `../shared/protocol`.

If any existing test fails because a previously-valid payload is now rejected, check the schema for over-strictness on that specific variant. Common sources: requiring a field the test doesn't provide, or too-narrow enum on `transcript-status.status` or `response.format`.

- [ ] **Step 5: Biome check**

```bash
bunx biome check 2>&1 | tail -3
```

Expected: clean. If formatting needs tweaks, run `bunx biome format --write` and re-check.

- [ ] **Step 6: Commit**

```bash
git add server/websocket.ts
git commit -m "feat(server): parse WS messages through Zod schemas at the boundary"
```

---

## Task 5: Delete WsMessage and clean up inline typeof checks

**Files:**
- Modify: `server/websocket.ts`

With Zod validating at the parse boundary, the inline `typeof ... === "string"` guards in the handlers are redundant — the fields are already guaranteed to be the right type. Delete them for `handleRegister`, `handleWatchSession`, and the `shutdown-request` case. Also delete the `WsMessage` interface since nothing references it anymore.

**Do NOT delete** the field guards in `handleSubmit` — it's the user-facing-error case where Zod is deliberately permissive, so the handler's own validation stays load-bearing.

- [ ] **Step 1: Delete the `WsMessage` interface**

Find this block near the top of `server/websocket.ts` (around line 14-20):

```ts
/** The raw parsed shape before discriminated-union narrowing. `parseRaw`
 * guarantees `type` is a non-empty string; everything else is unknown
 * until runtime validation at the boundary. Kept exported for tests. */
export interface WsMessage {
  type: string;
  [key: string]: unknown;
}
```

Delete the whole block. Nothing imports `WsMessage` anymore (verified via grep before writing this plan — the only uses were inside `server/websocket.ts` itself).

- [ ] **Step 2: Simplify `handleRegister`**

Find `private handleRegister(ws: Ws, msg: RegisterMessage): void` (around line 326). The current body starts with:

```ts
const { sessionId, label } = msg;
// Runtime validation — the discriminated union describes the intended
// shape, not what was actually received.
if (typeof sessionId !== "string" || sessionId.length === 0) return;
if (typeof label !== "string" || label.length === 0) return;
```

Replace those four lines with just the destructuring:

```ts
const { sessionId, label } = msg;
```

Zod's `RegisterSchema` already enforces `sessionId: z.string().min(1)` and `label: z.string().min(1)`, so by the time `handleRegister` runs, both are guaranteed non-empty strings.

- [ ] **Step 3: Simplify `handleWatchSession` signature and body**

Find `private handleWatchSession(ws: Ws, rawSessionId: unknown): void` (around line 254). The current signature takes an `unknown` because the caller passes `msg.sessionId` without narrowing. Change the signature to take a concrete string:

```ts
private handleWatchSession(ws: Ws, sid: string): void {
  this.browserWatchSession.set(ws.data.id, sid);

  // Replay buffered transcript entries for this session
  const buffer = this.sessionBuffers.get(sid);
  if (buffer) {
    for (const payload of buffer) {
      safeSend(ws, payload);
    }
  }

  // Send current usage snapshot
  const usage = this.sessionUsage.get(sid) ?? new SessionUsage();
  safeSend(ws, usage.toJSON());
}
```

The removed lines are:

```ts
if (typeof rawSessionId !== "string" || rawSessionId.length === 0) return;
const sid = rawSessionId;
```

— these go away because `WatchSessionSchema` already guaranteed `sessionId: z.string().min(1)`.

Find the caller in `handleBrowserMessage` (around line 169-171). The current call is:

```ts
case "watch-session":
  this.handleWatchSession(ws, msg.sessionId);
  return;
```

This still works — `msg.sessionId` is now typed as `string` (non-empty), matching the new parameter type.

- [ ] **Step 4: Delete the shutdown-request runtime guard**

Find the `case "shutdown-request"` block in `handleBrowserMessage` (around line 189-210). The block currently starts with:

```ts
case "shutdown-request": {
  // Runtime validation: the discriminated union describes intent, not
  // guarantee. Drop malformed payloads silently rather than crashing
  // the server via a follow-on process.exit. Round 4 of the static-
  // analysis plan proposes Zod at the parse boundary for a general fix.
  if (typeof msg.restart !== "boolean") return;
  const containerMode = this.detectContainerMode();
```

Remove the comment block and the `typeof msg.restart !== "boolean"` check. The `ShutdownRequestSchema` already requires `restart: z.boolean()`, so this guard is now dead code. The case becomes:

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
  setTimeout(
    () => this.shutdownFn({ restart: msg.restart, containerMode }),
    WebSocketHub.SHUTDOWN_ACK_FLUSH_MS,
  );
  return;
}
```

- [ ] **Step 5: Simplify the usage-update aggregator branch**

Find the `if (msg.type === "usage-update")` block inside `handleBridgeRouted` (around line 289-306). The current code reads:

```ts
if (msg.type === "usage-update") {
  let usage = this.sessionUsage.get(sessionId);
  if (!usage) {
    usage = new SessionUsage();
    this.sessionUsage.set(sessionId, usage);
  }
  const u = msg.usage;
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

Zod's `UsageSchema` now guarantees every field is present and well-typed. Delete the `?? 0` and `?? "unknown"` and `?? Date.now()` fallbacks:

```ts
if (msg.type === "usage-update") {
  let usage = this.sessionUsage.get(sessionId);
  if (!usage) {
    usage = new SessionUsage();
    this.sessionUsage.set(sessionId, usage);
  }
  usage.add(msg.usage);
}
```

`msg.usage` matches `SessionUsage.add`'s `UsageUpdate` parameter exactly (verified: `server/usage.ts:1-8` defines `UsageUpdate` as `{ inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; model: string; timestamp: number }`, which is the exact structural shape of `UsageSchema`'s inferred type). The direct pass-through will type-check cleanly.

- [ ] **Step 6: Run full verification**

```bash
bun run typecheck 2>&1
bunx biome check 2>&1 | tail -3
bun test 2>&1 | tail -8
bun run build:client 2>&1 | tail -3
```

Expected: all clean, full test suite passes, client builds. The critical tests to watch are in `tests/server/websocket.test.ts`'s `describe("submit — validation")` block — `handleSubmit` is the one handler that still has inline field validation, and those tests should still pass.

- [ ] **Step 7: Commit**

```bash
git add server/websocket.ts
git commit -m "refactor(server): delete WsMessage and redundant inline typeof guards"
```

---

## Task 6: Targeted fix for TRAYCE_TOKEN whitespace-only silent coercion

**Files:**
- Modify: `server/config.ts`
- Modify: `tests/server/config.test.ts`

The spec's Round 4 section calls for env parsing via Zod, but the existing `getConfig` in `server/config.ts` already has solid per-field validation (`parsePort`, `parseBool`, explicit trimming). The only actual behavior gap is the `server-config-token-whitespace-coerce` issue: a `TRAYCE_TOKEN` of `"   "` silently becomes `undefined`, and auth silently falls back to a generated token, confusing anyone who set the env var and expects it to take effect.

A full Zod rewrite of `getConfig` would be a lot of code for little behavior change. Instead, add a targeted warning for the whitespace-token case. This closes the issue without churning tests or rewriting working code.

- [ ] **Step 1: Add a failing test for the warning**

Open `tests/server/config.test.ts`. Find `describe("getConfig — TRAYCE_TOKEN")` (around line 223). Add a new test inside that describe block:

```ts
test("whitespace-only TRAYCE_TOKEN emits a warning", () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: unknown) => {
    if (typeof msg === "string") warnings.push(msg);
  };
  try {
    getConfig(env({ TRAYCE_TOKEN: "   " }));
  } finally {
    console.warn = originalWarn;
  }
  expect(warnings.some((w) => w.includes("TRAYCE_TOKEN"))).toBe(true);
});
```

This captures `console.warn` output during the call and asserts one of the warnings mentions `TRAYCE_TOKEN`. The existing test on line 237 (`whitespace trims to empty becomes undefined`) still passes — we're adding a warning alongside the existing coercion, not replacing the coercion.

- [ ] **Step 2: Run the test — expect failure**

```bash
bun test tests/server/config.test.ts 2>&1 | tail -10
```

Expected: the new test fails because `getConfig` doesn't currently log a warning for whitespace tokens.

- [ ] **Step 3: Add the warning in `getConfig`**

Open `server/config.ts`. Find the existing `getConfig` function (around line 58). Find the `token:` line:

```ts
token: env.TRAYCE_TOKEN?.trim() || undefined,
```

Replace with:

```ts
token: parseToken(env.TRAYCE_TOKEN),
```

Then add the `parseToken` helper function above `getConfig` (alongside `parsePort` and `parseBool`, around line 56):

```ts
function parseToken(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") {
    if (raw !== "") {
      // The caller set TRAYCE_TOKEN but only to whitespace. Previously this
      // silently coerced to undefined and fell back to a generated token,
      // leaving operators who expected their token to take effect silently
      // confused. Emit a loud warning so the misconfiguration is visible.
      console.warn(
        `[trayce] TRAYCE_TOKEN is set but contains only whitespace — ` +
          `falling back to a generated token. Clear the env var or set a ` +
          `non-empty value to silence this warning.`,
      );
    }
    return undefined;
  }
  return trimmed;
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
bun test tests/server/config.test.ts 2>&1 | tail -10
```

Expected: the new test passes, and all pre-existing `TRAYCE_TOKEN` tests still pass (whitespace → undefined behavior is unchanged; warning is additive).

- [ ] **Step 5: Full suite**

```bash
bun test 2>&1 | tail -5
bun run typecheck 2>&1
bunx biome check 2>&1 | tail -3
```

Expected: full suite clean.

- [ ] **Step 6: Commit**

```bash
git add server/config.ts tests/server/config.test.ts
git commit -m "fix(config): warn loudly when TRAYCE_TOKEN is whitespace-only"
```

---

## Task 7: CHANGELOG entry and final verification

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Read the current CHANGELOG and locate the `## Unreleased` / `### Added` / `### Fixed` subsections**

```bash
head -30 CHANGELOG.md
```

- [ ] **Step 2: Add entries under Added and Fixed**

Under `### Added`, add at the top (before the shutdown/restart entry from the previous feature):

```md
- **Runtime validation at the WebSocket parse boundary.** New `shared/protocol-schema.ts` defines Zod discriminated unions mirroring the `BrowserToServerMessage` and `BridgeToServerMessage` types from `shared/protocol.ts`. `WebSocketHub.parseMessage` is replaced by `parseBrowserMessage` and `parseBridgeMessage`, which validate the full payload shape before the handler ever sees it. Malformed messages from untrusted clients are logged at warn level and silently dropped — preserving the Round 3 runtime-silent / compile-loud idiom. The `SubmitSchema` is deliberately permissive because `handleSubmit` owns user-facing error codes (`INVALID_TARGET`, `EMPTY_SUBMISSION`); all other variants are strict. This closes four open vault issues in one pass: `server-usage-no-validation`, `server-nan-timestamp-usage-update`, `server-wsmessage-permissive`, and `server-config-token-whitespace-coerce`. Design: `docs/superpowers/specs/2026-04-08-static-analysis-hardening.md` (Round 4 section); implementation plan: `docs/superpowers/plans/2026-04-09-round-4-runtime-validation-plan.md`.
```

Under `### Fixed`, add at the top:

```md
- **`usage-update` no longer accepts NaN timestamps.** `UsageSchema` uses `z.number().finite()` on every numeric field, rejecting NaN and Infinity. Previously a poisoned timestamp (e.g. from `new Date("malformed").getTime()` upstream in the bridge) would slip through the `?? Date.now()` fallback and corrupt `SessionUsage.firstTimestamp`/`lastTimestamp` forever after the first bad entry. Now the parser logs a validation warning and drops the malformed payload; `SessionUsage` only ever sees well-formed numeric fields.
- **`WsMessage` type deleted; inline `typeof` checks removed.** The loose `{ type: string; [key: string]: unknown }` interface that every handler had to re-validate against is gone. `handleRegister`, `handleWatchSession`, and the `shutdown-request` case no longer duplicate the schema's work. `handleSubmit` keeps its field checks because the user-facing error codes are the contract.
- **Whitespace-only `TRAYCE_TOKEN` now warns loudly.** Previously `TRAYCE_TOKEN="   "` silently coerced to `undefined` and auth fell back to a generated token, leaving operators silently confused. The server now emits a warning at startup when the env var is set but contains only whitespace.
```

- [ ] **Step 3: Final full verification**

```bash
bun run typecheck 2>&1
bun run check 2>&1 | tail -3
bun test 2>&1 | tail -8
bun run build:client 2>&1 | tail -3
```

Expected: all clean, full suite green, build clean.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG entries for Round 4 runtime validation"
```

---

## Done

After Task 7, the feature is complete. Quick sanity:

```bash
bun run typecheck
bun run check
bun test
bun run build:client
git log --oneline main..HEAD
```

Expected: everything green; the branch has ~7 commits from Tasks 1–7.

The `/code-to-docs --update` vault sync is optional and separate from this plan — run it at the end of the session to reflect the 4 newly-resolved issues in the vault.
