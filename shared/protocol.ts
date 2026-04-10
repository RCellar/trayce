/**
 * Shared WebSocket protocol definitions for Trayce.
 *
 * Consumed by all three processes (server, bridge, client) via `import type`
 * only. No runtime code crosses module boundaries here — this file contains
 * only types. Each bundle root (server/, bridge/, client/) imports what it
 * needs and TypeScript erases the types at build time.
 *
 * Design: discriminated unions keyed on a `type` field. Combined with
 * `noFallthroughCasesInSwitch` and exhaustiveness checks via `assertNever`,
 * this forces every new message variant to be handled everywhere it matters,
 * converting a class of "forgot to handle X in Y path" bugs into compile
 * errors.
 *
 * Runtime caveat: these types describe the INTENDED shape of messages. They
 * do NOT validate incoming payloads at runtime — that remains the parser's
 * responsibility at the boundary. Inside a narrowed case, field types are
 * contract, not guarantee.
 */

// ────────────────────────────────────────────────────────────────────────────
// Shared entity types
// ────────────────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  label: string;
  status?: string;
  sessionStartedAt?: number | undefined;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  timestamp: number;
}

export interface UsageSnapshotData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requestCount: number;
  models: Record<string, { inputTokens: number; outputTokens: number; requests: number }>;
  firstTimestamp: number;
  lastTimestamp: number;
}

export type TranscriptEntryType = "message" | "response" | "tool-call" | "tool-result";
export type TranscriptRole = "user" | "assistant";

export interface TranscriptEntryData {
  type: TranscriptEntryType;
  role: TranscriptRole;
  content: string;
  /** All optional fields use `?: T | undefined` (not just `?: T`) to match
   * Zod's `.optional()` inference under `exactOptionalPropertyTypes: true`.
   * Only the client's transcript tab reads `timestamp`; the server relays
   * entry objects verbatim. */
  timestamp?: number | undefined;
  toolName?: string | undefined;
  toolInput?: string | undefined;
  toolUseId?: string | undefined;
}

export type PermissionBehavior = "allow" | "allow_once" | "deny";

// ────────────────────────────────────────────────────────────────────────────
// Shared — sent by either end
// ────────────────────────────────────────────────────────────────────────────

export interface HeartbeatMessage {
  type: "heartbeat";
}

// ────────────────────────────────────────────────────────────────────────────
// Browser → Server
// ────────────────────────────────────────────────────────────────────────────

export interface SubmitMessage {
  type: "submit";
  // `targetSessionId` is nominally required but typed as optional here
  // because `SubmitSchema` is deliberately permissive: `handleSubmit`
  // owns its own validation and returns `INVALID_TARGET` / `EMPTY_SUBMISSION`
  // error codes for missing fields. If the schema rejected missing fields
  // at the parse boundary, those user-facing errors would never fire and
  // existing tests would fail. The handler checks this at runtime.
  targetSessionId?: string | undefined;
  image?: string | undefined; // base64 PNG, optional if prompt present
  prompt?: string | undefined;
}

export interface WatchSessionMessage {
  type: "watch-session";
  sessionId: string;
}

export interface PermissionVerdictMessage {
  type: "permission-verdict";
  requestId: string;
  behavior: PermissionBehavior;
}

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

// ────────────────────────────────────────────────────────────────────────────
// Bridge → Server (also: the server appends sessionId and forwards to browsers)
// ────────────────────────────────────────────────────────────────────────────

export interface RegisterMessage {
  type: "register";
  sessionId: string;
  label: string;
  sessionStartedAt?: number | undefined;
}

export interface TranscriptEntryMessage {
  type: "transcript-entry";
  entry: TranscriptEntryData;
}

export interface ResponseMessage {
  type: "response";
  content: string;
  format?: "markdown" | "plain" | undefined;
}

export interface CanvasPushMessage {
  type: "canvas-push";
  image: string; // base64 PNG
  label?: string | undefined;
}

export interface TranscriptStatusMessage {
  type: "transcript-status";
  status: "running" | "idle" | "error";
}

export interface UsageUpdateMessage {
  type: "usage-update";
  usage: Usage;
}

export interface PermissionRequestMessage {
  type: "permission-request";
  requestId: string;
  toolName: string;
  toolInput?: unknown | undefined;
}

/** Bridge-routed messages: bridge sends these, server forwards them to
 * browsers that are watching the bridge's session (with `sessionId` appended),
 * and buffers the replay-worthy ones. */
export type BridgeRoutedMessage =
  | TranscriptEntryMessage
  | ResponseMessage
  | CanvasPushMessage
  | TranscriptStatusMessage
  | UsageUpdateMessage
  | PermissionRequestMessage;

export type BridgeToServerMessage = HeartbeatMessage | RegisterMessage | BridgeRoutedMessage;

// ────────────────────────────────────────────────────────────────────────────
// Server → Browser
// ────────────────────────────────────────────────────────────────────────────

export interface SessionsMessage {
  type: "sessions";
  sessions: Session[];
}

export interface AckMessage {
  type: "ack";
  submissionId: string;
  timestamp: number;
  status: "delivered" | "queued";
}

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
}

export interface UsageSnapshotMessage {
  type: "usage-snapshot";
  sessionId?: string;
  usage: UsageSnapshotData;
  sessionStartedAt?: number | undefined;
}

export interface ServerExitingMessage {
  type: "server-exiting";
  restart: boolean; // echoes the request so the browser knows what to expect
  containerMode: boolean; // true → orchestrator will handle restart
}

export interface ServerInfoMessage {
  type: "server-info";
  containerMode: boolean; // true if running under a container orchestrator
  // Room to grow: version, uptime, etc. as future fields
}

/** When the server forwards a bridge message to a browser, it tags it with
 * the bridge's session ID so the browser can route it to the right watcher. */
export type SessionScoped<M> = M & { sessionId: string };

export type ServerToBrowserMessage =
  | HeartbeatMessage
  | SessionsMessage
  | AckMessage
  | ErrorMessage
  | UsageSnapshotMessage
  | ServerInfoMessage
  | ServerExitingMessage
  | SessionScoped<BridgeRoutedMessage>;

// ────────────────────────────────────────────────────────────────────────────
// Server → Bridge
// ────────────────────────────────────────────────────────────────────────────

export interface SubmissionMessage {
  type: "submission";
  id: string;
  prompt: string;
  pngPath?: string;
}

export type ServerToBridgeMessage = HeartbeatMessage | SubmissionMessage | PermissionVerdictMessage;

// ────────────────────────────────────────────────────────────────────────────
// Exhaustiveness helper
// ────────────────────────────────────────────────────────────────────────────

/** Throws a descriptive error if called. Use in the `default` branch of a
 * switch over a discriminated union to force the compiler to verify every
 * variant is handled. If a new message type is added to the union and any
 * handler forgets to address it, the compiler will reject the `never`
 * assignment and refuse to build. */
export function assertNever(x: never): never {
  throw new Error(`Unhandled message variant: ${JSON.stringify(x)}`);
}
