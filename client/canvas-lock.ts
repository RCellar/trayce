export type LockMessage =
  | { type: "claim"; sessionId: string; tabId: string }
  | { type: "release"; sessionId: string; tabId: string }
  | { type: "query"; tabId: string }
  | { type: "status"; sessionId: string; tabId: string };

export class CanvasLock {
  private tabId: string;
  private channel: BroadcastChannel | null;
  private held: string | null = null;
  private destroyed = false;

  public onEvicted: (() => void) | null = null;

  constructor() {
    this.tabId = crypto.randomUUID();
    this.channel =
      typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("trayce-canvas-lock") : null;

    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<LockMessage>) => {
        this.handleMessage(event.data);
      };
    }
  }

  // NOTE: Two tabs can theoretically both succeed in claiming the same session
  // in a narrow race window — both may query before either has broadcast its
  // claim. This is handled gracefully: when the second claim is broadcast, the
  // first tab's handleMessage will receive it and fire onEvicted, self-evicting
  // from the session it believed it held.
  async claim(sessionId: string | null): Promise<boolean> {
    if (this.destroyed) {
      return false;
    }

    // Release whatever we currently hold before switching
    if (this.held !== null) {
      this.broadcastRelease(this.held);
      this.held = null;
    }

    // Scratchpad (null) — no coordination needed
    if (sessionId === null) {
      return true;
    }

    const holders = await this.queryHolders(sessionId);
    if (holders.length > 0) {
      return false;
    }

    this.held = sessionId;
    if (this.channel) {
      const msg: LockMessage = { type: "claim", sessionId, tabId: this.tabId };
      this.channel.postMessage(msg);
    }
    return true;
  }

  forceClaim(sessionId: string): void {
    if (this.held !== null && this.held !== sessionId) {
      this.broadcastRelease(this.held);
    }
    this.held = sessionId;
    if (this.channel) {
      const msg: LockMessage = { type: "claim", sessionId, tabId: this.tabId };
      this.channel.postMessage(msg);
    }
  }

  release(): void {
    if (this.held !== null) {
      this.broadcastRelease(this.held);
      this.held = null;
    }
  }

  heldSession(): string | null {
    return this.held;
  }

  destroy(): void {
    this.destroyed = true;
    this.release();
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }

  // --- Private helpers ---

  private broadcastRelease(sessionId: string): void {
    if (this.channel) {
      const msg: LockMessage = { type: "release", sessionId, tabId: this.tabId };
      this.channel.postMessage(msg);
    }
  }

  private queryHolders(sessionId: string): Promise<string[]> {
    return new Promise((resolve) => {
      if (!this.channel) {
        resolve([]);
        return;
      }

      const holders: string[] = [];

      // Temporarily override the message handler to collect status replies
      const originalHandler = this.channel.onmessage;
      this.channel.onmessage = (event: MessageEvent<LockMessage>) => {
        const msg = event.data;
        if (msg.type === "status" && msg.sessionId === sessionId) {
          holders.push(msg.tabId);
        } else {
          // Still process other message types during query window
          this.handleMessage(msg);
        }
      };

      const query: LockMessage = { type: "query", tabId: this.tabId };
      this.channel.postMessage(query);

      setTimeout(() => {
        if (!this.destroyed && this.channel) {
          this.channel.onmessage = originalHandler;
        }
        resolve(holders);
      }, 100);
    });
  }

  private handleMessage(msg: LockMessage): void {
    switch (msg.type) {
      case "query":
        // Respond with our status if we hold any session
        if (this.held !== null && this.channel) {
          const status: LockMessage = {
            type: "status",
            sessionId: this.held,
            tabId: this.tabId,
          };
          this.channel.postMessage(status);
        }
        break;

      case "claim":
        // Another tab claimed the session we hold — we are evicted
        if (this.held === msg.sessionId && msg.tabId !== this.tabId) {
          this.held = null;
          if (this.onEvicted) {
            this.onEvicted();
          }
        }
        break;

      case "release":
        // No action needed; the claim logic uses queryHolders
        break;

      case "status":
        // Handled inline in queryHolders; ignored here
        break;
    }
  }
}
