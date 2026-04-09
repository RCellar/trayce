export interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

export type ConnectionStatus = "connected" | "disconnected" | "reconnecting";
export type StatusCallback = (status: ConnectionStatus) => void;
export type MessageCallback = (msg: ServerMessage) => void;

export function buildWsUrl(host: string, port: number, token: string): string {
  return `ws://${host}:${port}/canvas?token=${token}`;
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const data = JSON.parse(raw);
    if (typeof data !== "object" || !data?.type) return null;
    return data;
  } catch {
    return null;
  }
}

export class Connection {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private url: string,
    private onStatus: StatusCallback,
    private onMessage: MessageCallback,
  ) {}

  connect(): void {
    this.closed = false;
    this.onStatus("reconnecting");

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.onStatus("connected");
      this.startHeartbeat();
    };

    this.ws.onmessage = (e) => {
      const msg = parseServerMessage(String(e.data));
      if (!msg) return;

      if (msg.type === "heartbeat") {
        this.resetHeartbeatTimeout();
        return;
      }

      this.onMessage(msg);
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      if (!this.closed) {
        this.onStatus("reconnecting");
        setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
          this.connect();
        }, this.reconnectDelay);
      } else {
        this.onStatus("disconnected");
      }
    };

    this.ws.onerror = () => {};
  }

  send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect(): void {
    this.closed = true;
    this.stopHeartbeat();
    this.ws?.close();
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "heartbeat" });
    }, 10_000);
    this.resetHeartbeatTimeout();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    this.heartbeatTimer = null;
    this.heartbeatTimeout = null;
  }

  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    this.heartbeatTimeout = setTimeout(() => {
      this.ws?.close();
    }, 25_000);
  }
}
