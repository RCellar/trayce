import { existsSync } from "node:fs";
import type { ServerWebSocket } from "bun";
import type {
  BridgeRoutedMessage,
  BridgeToServerMessage,
  BrowserToServerMessage,
  RegisterMessage,
  SubmissionMessage,
  SubmitMessage,
} from "../shared/protocol";
import { BridgeToServerSchema, BrowserToServerSchema } from "../shared/protocol-schema";
import type { Config } from "./config";
import type { SessionRegistry } from "./sessions";
import type { SubmissionStore } from "./submissions";
import { SessionUsage } from "./usage";

export interface WsData {
  kind: "browser" | "bridge";
  id: string;
  sessionId: string | undefined;
  lastHeartbeat: number;
}

type Ws = ServerWebSocket<WsData>;

/** Callback invoked when a browser sends a shutdown-request. `server/index.ts`
 * implements the real behavior (process exit + optional spawn of a detached
 * replacement); tests pass a no-op spy. */
export type ShutdownFn = (opts: { restart: boolean; containerMode: boolean }) => void;

function safeSend(ws: Ws, payload: string): void {
  try {
    ws.send(payload);
  } catch {
    // Socket may have closed — swallow silently
  }
}

export class WebSocketHub {
  private readonly browsers = new Map<string, Ws>();
  private readonly bridges = new Map<string, Ws>();
  private readonly pendingBridges = new Map<string, Ws>();
  private readonly sessionToBridgeId = new Map<string, string>();
  private readonly rateBuckets = new Map<string, number[]>();
  private readonly browserWatchSession = new Map<string, string>();
  private readonly sessionBuffers = new Map<string, string[]>();
  private readonly sessionUsage = new Map<string, SessionUsage>();
  private _containerMode: boolean | null = null;
  private detectContainerMode(): boolean {
    if (this._containerMode !== null) return this._containerMode;
    this._containerMode = existsSync("/.dockerenv") || Bun.env.TRAYCE_CONTAINER === "1";
    return this._containerMode;
  }
  private static readonly BUFFERED_TYPES = new Set([
    "transcript-entry",
    "response",
    "transcript-status",
    "canvas-push",
    "annotation-update",
    "annotations-push",
  ]);
  /** Delay between acknowledging a shutdown-request and firing the
   * actual shutdown callback. Lets the WebSocket flush the ack frame
   * before the socket is torn down. */
  private static readonly SHUTDOWN_ACK_FLUSH_MS = 50;

  constructor(
    private readonly registry: SessionRegistry,
    private readonly submissions: SubmissionStore,
    private readonly config: Config,
    private readonly shutdownFn: ShutdownFn,
    private readonly now: () => number = Date.now,
  ) {}

  static parseBrowserMessage(raw: string | Buffer): BrowserToServerMessage | null {
    return WebSocketHub.parseWithSchema<BrowserToServerMessage>(
      raw,
      BrowserToServerSchema,
      "browser",
    );
  }

  static parseBridgeMessage(raw: string | Buffer): BridgeToServerMessage | null {
    return WebSocketHub.parseWithSchema<BridgeToServerMessage>(raw, BridgeToServerSchema, "bridge");
  }

  private static parseWithSchema<T>(
    raw: string | Buffer,
    schema: {
      safeParse: (
        data: unknown,
      ) => { success: true; data: T } | { success: false; error: { issues: unknown } };
    },
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

  // -- Connection lifecycle --

  addBrowser(ws: Ws): void {
    this.browsers.set(ws.data.id, ws);
    this.rateBuckets.set(ws.data.id, []);
    safeSend(
      ws,
      JSON.stringify({
        type: "server-info",
        containerMode: this.detectContainerMode(),
      }),
    );
    this.sendSessions(ws);
  }

  removeBrowser(ws: Ws): void {
    this.browsers.delete(ws.data.id);
    this.rateBuckets.delete(ws.data.id);
    this.browserWatchSession.delete(ws.data.id);
  }

  addBridge(ws: Ws): void {
    this.pendingBridges.set(ws.data.id, ws);
    this.rateBuckets.set(ws.data.id, []);
  }

  removeBridge(ws: Ws): void {
    this.rateBuckets.delete(ws.data.id);
    this.pendingBridges.delete(ws.data.id);
    const sessionId = ws.data.sessionId;
    if (sessionId) {
      // Only clean up if this connection is still the canonical one
      if (this.sessionToBridgeId.get(sessionId) === ws.data.id) {
        this.bridges.delete(sessionId);
        this.sessionToBridgeId.delete(sessionId);
        this.registry.remove(sessionId);
        this.sessionBuffers.delete(sessionId);
        this.sessionUsage.delete(sessionId);
        this.broadcastSessions();
      }
    }
  }

  // -- Message routing --

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

  /** Route a message from a browser. The exhaustive switch is load-bearing:
   * if someone adds a new BrowserToServerMessage variant, the compiler will
   * refuse to build until this switch handles it (via the `assertNever`
   * call in the default case). */
  private async handleBrowserMessage(ws: Ws, msg: BrowserToServerMessage): Promise<void> {
    switch (msg.type) {
      case "heartbeat":
        // Already handled in handleMessage; reached here only if the browser
        // echoed a heartbeat in an unexpected direction — ignore.
        return;

      case "submit":
        await this.handleSubmit(ws, msg);
        return;

      case "watch-session":
        this.handleWatchSession(ws, msg.sessionId);
        return;

      case "permission-verdict": {
        const sid = this.browserWatchSession.get(ws.data.id);
        if (!sid) return;
        const bridge = this.bridges.get(sid);
        if (!bridge) return;
        safeSend(
          bridge,
          JSON.stringify({
            type: "permission-verdict",
            requestId: msg.requestId,
            behavior: msg.behavior,
          }),
        );
        return;
      }

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
        // Give the socket a beat to flush the ack before tearing down.
        setTimeout(
          () => this.shutdownFn({ restart: msg.restart, containerMode }),
          WebSocketHub.SHUTDOWN_ACK_FLUSH_MS,
        );
        return;
      }

      default: {
        // Compile-time exhaustiveness: a new variant added to the union
        // without a case here becomes a type error (msg narrows to never).
        // Runtime: silently drop — messages come from untrusted clients
        // and may deliberately target the wrong connection kind.
        const _exhaustive: never = msg;
        void _exhaustive;
      }
    }
  }

  /** Route a message from a bridge. Exhaustive switch; same guarantee as
   * `handleBrowserMessage`. */
  private handleBridgeMessage(ws: Ws, msg: BridgeToServerMessage): void {
    switch (msg.type) {
      case "heartbeat":
        return;

      case "register":
        this.handleRegister(ws, msg);
        return;

      case "transcript-entry":
      case "response":
      case "canvas-push":
      case "transcript-status":
      case "usage-update":
      case "permission-request":
      case "annotation-update":
      case "annotations-push":
        this.handleBridgeRouted(ws, msg);
        return;

      default: {
        // Compile-time exhaustiveness: a new variant added to the union
        // without a case here becomes a type error (msg narrows to never).
        // Runtime: silently drop — messages come from untrusted clients
        // and may deliberately target the wrong connection kind.
        const _exhaustive: never = msg;
        void _exhaustive;
      }
    }
  }

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
    const session = this.registry.get(sid);
    const snapshot = JSON.parse(usage.toJSON());
    if (session?.sessionStartedAt) {
      snapshot.sessionStartedAt = session.sessionStartedAt;
    }
    safeSend(ws, JSON.stringify(snapshot));
  }

  /** Transcript/usage messages are high-volume and bypass the rate limiter;
   * only actionable messages like canvas-push and permission-request are
   * rate-limited. */
  private static readonly RATE_LIMITED_BRIDGE_TYPES = new Set<BridgeRoutedMessage["type"]>([
    "canvas-push",
    "permission-request",
  ]);

  private handleBridgeRouted(ws: Ws, msg: BridgeRoutedMessage): void {
    if (WebSocketHub.RATE_LIMITED_BRIDGE_TYPES.has(msg.type) && !this.checkRateLimit(ws.data.id)) {
      return;
    }
    const sessionId = ws.data.sessionId;
    if (!sessionId) return;
    const payload = JSON.stringify({ ...msg, sessionId });

    // Accumulate usage data
    if (msg.type === "usage-update") {
      let usage = this.sessionUsage.get(sessionId);
      if (!usage) {
        usage = new SessionUsage();
        this.sessionUsage.set(sessionId, usage);
      }
      usage.add(msg.usage);
    }

    // Buffer replay-worthy messages for late-joining browsers
    if (WebSocketHub.BUFFERED_TYPES.has(msg.type)) {
      let buffer = this.sessionBuffers.get(sessionId);
      if (!buffer) {
        buffer = [];
        this.sessionBuffers.set(sessionId, buffer);
      }
      buffer.push(payload);
      if (buffer.length > this.config.transcriptBufferSize) {
        buffer.splice(0, buffer.length - this.config.transcriptBufferSize);
      }
    }

    for (const [browserId, browser] of this.browsers) {
      if (this.browserWatchSession.get(browserId) === sessionId) {
        safeSend(browser, payload);
      }
    }
  }

  private handleRegister(ws: Ws, msg: RegisterMessage): void {
    const { sessionId, label } = msg;

    // If this bridge previously registered a different session, clean up
    if (ws.data.sessionId && ws.data.sessionId !== sessionId) {
      this.bridges.delete(ws.data.sessionId);
      this.sessionToBridgeId.delete(ws.data.sessionId);
      this.registry.remove(ws.data.sessionId);
      this.sessionBuffers.delete(ws.data.sessionId);
      this.sessionUsage.delete(ws.data.sessionId);
    }

    // If another bridge holds this sessionId, evict it
    const existingBridgeId = this.sessionToBridgeId.get(sessionId);
    if (existingBridgeId && existingBridgeId !== ws.data.id) {
      const existingBridge = this.bridges.get(sessionId);
      if (existingBridge) {
        existingBridge.data.sessionId = undefined;
        try {
          existingBridge.close();
        } catch {}
      }
      this.bridges.delete(sessionId);
      this.sessionToBridgeId.delete(sessionId);
      this.registry.remove(sessionId);
      this.sessionBuffers.delete(sessionId);
      this.sessionUsage.delete(sessionId);
    }

    ws.data.sessionId = sessionId;
    this.bridges.set(sessionId, ws);
    this.sessionToBridgeId.set(sessionId, ws.data.id);
    this.registry.add(sessionId, label, msg.sessionStartedAt);
    this.broadcastSessions();
  }

  private async handleSubmit(ws: Ws, msg: SubmitMessage): Promise<void> {
    // Rate limit
    if (!this.checkRateLimit(ws.data.id)) {
      safeSend(
        ws,
        JSON.stringify({
          type: "error",
          code: "RATE_LIMITED",
          message: "Too many submissions. Please wait before submitting again.",
        }),
      );
      return;
    }

    const targetSessionId = msg.targetSessionId;
    const image = typeof msg.image === "string" && msg.image.length > 0 ? msg.image : null;
    const prompt = typeof msg.prompt === "string" ? msg.prompt : "";

    if (typeof targetSessionId !== "string" || targetSessionId.length === 0) {
      safeSend(
        ws,
        JSON.stringify({
          type: "error",
          code: "INVALID_TARGET",
          message: "Missing targetSessionId.",
        }),
      );
      return;
    }

    if (!image && !prompt) {
      safeSend(
        ws,
        JSON.stringify({
          type: "error",
          code: "EMPTY_SUBMISSION",
          message: "Submission must include an image or prompt text.",
        }),
      );
      return;
    }

    // Save image to disk if present
    let submission: { id: string; pngPath: string | null; prompt: string; timestamp: number };
    if (image) {
      try {
        submission = await this.submissions.save(image, prompt);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to save submission.";
        safeSend(ws, JSON.stringify({ type: "error", code: "SUBMISSION_FAILED", message }));
        return;
      }
    } else {
      submission = {
        id: `sub-${Date.now()}-text`,
        pngPath: null,
        prompt,
        timestamp: Date.now(),
      };
    }

    // Route to bridge (check it's still connected post-await)
    const bridge = this.bridges.get(targetSessionId);
    const delivered = !!bridge;
    if (bridge) {
      const bridgeMsg: SubmissionMessage = {
        type: "submission",
        id: submission.id,
        prompt: submission.prompt,
      };
      if (submission.pngPath) bridgeMsg.pngPath = submission.pngPath;
      if (msg.annotations && msg.annotations.length > 0) {
        bridgeMsg.annotations = msg.annotations;
      }
      safeSend(bridge, JSON.stringify(bridgeMsg));
    }

    // Ack the browser with delivery status
    safeSend(
      ws,
      JSON.stringify({
        type: "ack",
        submissionId: submission.id,
        timestamp: submission.timestamp,
        status: delivered ? "delivered" : "queued",
      }),
    );
  }

  // -- Broadcasting --

  broadcastSessions(): void {
    const payload = JSON.stringify({ type: "sessions", sessions: this.registry.list() });
    for (const browser of this.browsers.values()) {
      safeSend(browser, payload);
    }
  }

  private sendSessions(ws: Ws): void {
    safeSend(ws, JSON.stringify({ type: "sessions", sessions: this.registry.list() }));
  }

  // -- Rate limiting (sliding window) --

  checkRateLimit(clientId: string): boolean {
    const now = this.now();
    const windowStart = now - 60_000;
    const bucket = this.rateBuckets.get(clientId);
    if (!bucket) return false;

    const recent = bucket.filter((t) => t > windowStart);
    if (recent.length >= this.config.rateLimitPerMinute) {
      this.rateBuckets.set(clientId, recent);
      return false;
    }

    recent.push(now);
    this.rateBuckets.set(clientId, recent);
    return true;
  }

  // -- Heartbeat timeout --

  checkHeartbeats(): void {
    const now = this.now();
    const timeout = this.config.heartbeatTimeoutMs;

    for (const ws of this.browsers.values()) {
      if (now - ws.data.lastHeartbeat > timeout) {
        try {
          ws.close(1000, "heartbeat timeout");
        } catch {}
      }
    }

    // Check both registered and pending bridges
    const allBridges = new Map([
      ...this.pendingBridges,
      ...[...this.bridges.values()].map((ws) => [ws.data.id, ws] as [string, Ws]),
    ]);
    for (const ws of allBridges.values()) {
      if (now - ws.data.lastHeartbeat > timeout) {
        try {
          ws.close(1000, "heartbeat timeout");
        } catch {}
      }
    }
  }

  // -- Introspection (for tests) --

  get browserCount(): number {
    return this.browsers.size;
  }
  get bridgeCount(): number {
    return this.bridges.size;
  }
}
