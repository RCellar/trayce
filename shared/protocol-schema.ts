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
  // timestamp is required by the protocol type but is only consumed by the
  // browser renderer — the server relays entry objects verbatim. Making it
  // optional here preserves compatibility with older bridge versions and
  // simplifies test fixtures.
  timestamp: z.number().finite().optional(),
  toolName: z.string().optional(),
  toolInput: z.string().optional(),
  toolUseId: z.string().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
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

// ────────────────────────────────────────────────────────────────────────────
// Bridge → Server
// ────────────────────────────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  type: z.literal("register"),
  sessionId: z.string().min(1),
  label: z.string().min(1),
  sessionStartedAt: z.number().optional(),
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
