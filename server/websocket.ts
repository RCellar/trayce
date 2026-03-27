import type { ServerWebSocket } from "bun";
import type { SessionRegistry } from "./sessions";
import type { SubmissionStore } from "./submissions";
import type { Config } from "./config";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export interface WsData {
  kind: "browser" | "bridge";
  id: string;
  sessionId?: string;
  lastHeartbeat: number;
}

type Ws = ServerWebSocket<WsData>;

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

  constructor(
    private readonly registry: SessionRegistry,
    private readonly submissions: SubmissionStore,
    private readonly config: Config,
    private readonly now: () => number = Date.now,
  ) {}

  static parseMessage(raw: string | Buffer): WsMessage | null {
    try {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      const data = JSON.parse(text);
      if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
      if (typeof data.type !== "string" || data.type.length === 0) return null;
      return data as WsMessage;
    } catch {
      return null;
    }
  }

  // -- Connection lifecycle --

  addBrowser(ws: Ws): void {
    this.browsers.set(ws.data.id, ws);
    this.rateBuckets.set(ws.data.id, []);
    this.sendSessions(ws);
  }

  removeBrowser(ws: Ws): void {
    this.browsers.delete(ws.data.id);
    this.rateBuckets.delete(ws.data.id);
    this.browserWatchSession.delete(ws.data.id);
  }

  addBridge(ws: Ws): void {
    this.pendingBridges.set(ws.data.id, ws);
  }

  removeBridge(ws: Ws): void {
    this.pendingBridges.delete(ws.data.id);
    const sessionId = ws.data.sessionId;
    if (sessionId) {
      // Only clean up if this connection is still the canonical one
      if (this.sessionToBridgeId.get(sessionId) === ws.data.id) {
        this.bridges.delete(sessionId);
        this.sessionToBridgeId.delete(sessionId);
        this.registry.remove(sessionId);
        this.broadcastSessions();
      }
    }
  }

  // -- Message routing --

  async handleMessage(ws: Ws, raw: string | Buffer): Promise<void> {
    const msg = WebSocketHub.parseMessage(raw);
    if (!msg) return;

    if (msg.type === "heartbeat") {
      ws.data.lastHeartbeat = this.now();
      safeSend(ws, JSON.stringify({ type: "heartbeat" }));
      return;
    }

    if (ws.data.kind === "bridge" && msg.type === "register") {
      this.handleRegister(ws, msg);
      return;
    }

    if (ws.data.kind === "browser" && msg.type === "submit") {
      await this.handleSubmit(ws, msg);
      return;
    }

    if (ws.data.kind === "browser" && msg.type === "watch-session") {
      const sid = msg.sessionId;
      if (typeof sid === "string") {
        this.browserWatchSession.set(ws.data.id, sid);
      }
      return;
    }

    const BRIDGE_ROUTED_TYPES = ["transcript-entry", "response", "canvas-push", "transcript-status"];
    if (ws.data.kind === "bridge" && BRIDGE_ROUTED_TYPES.includes(msg.type)) {
      const sessionId = ws.data.sessionId;
      if (!sessionId) return;
      const payload = JSON.stringify({ ...msg, sessionId });
      for (const [browserId, browser] of this.browsers) {
        if (this.browserWatchSession.get(browserId) === sessionId) {
          safeSend(browser, payload);
        }
      }
      return;
    }
  }

  private handleRegister(ws: Ws, msg: WsMessage): void {
    const sessionId = msg.sessionId;
    const label = msg.label;
    if (typeof sessionId !== "string" || sessionId.length === 0) return;
    if (typeof label !== "string" || label.length === 0) return;

    // If this bridge previously registered a different session, clean up
    if (ws.data.sessionId && ws.data.sessionId !== sessionId) {
      this.bridges.delete(ws.data.sessionId);
      this.sessionToBridgeId.delete(ws.data.sessionId);
      this.registry.remove(ws.data.sessionId);
    }

    // If another bridge holds this sessionId, evict it
    const existingBridgeId = this.sessionToBridgeId.get(sessionId);
    if (existingBridgeId && existingBridgeId !== ws.data.id) {
      const existingBridge = this.bridges.get(sessionId);
      if (existingBridge) {
        existingBridge.data.sessionId = undefined;
        try { existingBridge.close(); } catch {}
      }
      this.bridges.delete(sessionId);
      this.sessionToBridgeId.delete(sessionId);
      this.registry.remove(sessionId);
    }

    ws.data.sessionId = sessionId;
    this.bridges.set(sessionId, ws);
    this.sessionToBridgeId.set(sessionId, ws.data.id);
    this.registry.add(sessionId, label);
    this.broadcastSessions();
  }

  private async handleSubmit(ws: Ws, msg: WsMessage): Promise<void> {
    // Rate limit
    if (!this.checkRateLimit(ws.data.id)) {
      safeSend(ws, JSON.stringify({
        type: "error",
        code: "RATE_LIMITED",
        message: "Too many submissions. Please wait before submitting again.",
      }));
      return;
    }

    const targetSessionId = msg.targetSessionId;
    const image = msg.image;
    const prompt = typeof msg.prompt === "string" ? msg.prompt : "";

    if (typeof targetSessionId !== "string" || targetSessionId.length === 0) {
      safeSend(ws, JSON.stringify({
        type: "error", code: "INVALID_TARGET", message: "Missing targetSessionId.",
      }));
      return;
    }

    if (typeof image !== "string" || image.length === 0) {
      safeSend(ws, JSON.stringify({
        type: "error", code: "INVALID_IMAGE", message: "Missing image data.",
      }));
      return;
    }

    // Save submission
    let submission;
    try {
      submission = await this.submissions.save(image, prompt);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save submission.";
      safeSend(ws, JSON.stringify({ type: "error", code: "SUBMISSION_FAILED", message }));
      return;
    }

    // Route to bridge (check it's still connected post-await)
    const bridge = this.bridges.get(targetSessionId);
    if (bridge) {
      safeSend(bridge, JSON.stringify({
        type: "submission",
        id: submission.id,
        pngPath: submission.pngPath,
        prompt: submission.prompt,
      }));
    }

    // Always ack the browser — PNG is saved on disk regardless
    safeSend(ws, JSON.stringify({
      type: "ack",
      submissionId: submission.id,
      timestamp: submission.timestamp,
    }));
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
        try { ws.close(1000, "heartbeat timeout"); } catch {}
      }
    }

    // Check both registered and pending bridges
    const allBridges = new Map([
      ...this.pendingBridges,
      ...[...this.bridges.values()].map((ws) => [ws.data.id, ws] as [string, Ws]),
    ]);
    for (const ws of allBridges.values()) {
      if (now - ws.data.lastHeartbeat > timeout) {
        try { ws.close(1000, "heartbeat timeout"); } catch {}
      }
    }
  }

  // -- Introspection (for tests) --

  get browserCount(): number { return this.browsers.size; }
  get bridgeCount(): number { return this.bridges.size; }
}
