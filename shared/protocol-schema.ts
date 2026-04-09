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
