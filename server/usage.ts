export interface UsageUpdate {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  timestamp: number;
}

export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requestCount: number;
  models: Record<string, { inputTokens: number; outputTokens: number; requests: number }>;
  firstTimestamp: number;
  lastTimestamp: number;
}

export class SessionUsage {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private requestCount = 0;
  private models: Record<string, { inputTokens: number; outputTokens: number; requests: number }> = {};
  private firstTimestamp = 0;
  private lastTimestamp = 0;

  add(update: UsageUpdate): void {
    this.inputTokens += update.inputTokens;
    this.outputTokens += update.outputTokens;
    this.cacheReadTokens += update.cacheReadTokens;
    this.cacheWriteTokens += update.cacheWriteTokens;
    this.requestCount++;

    let entry = this.models[update.model];
    if (!entry) {
      entry = { inputTokens: 0, outputTokens: 0, requests: 0 };
      this.models[update.model] = entry;
    }
    entry.inputTokens += update.inputTokens;
    entry.outputTokens += update.outputTokens;
    entry.requests++;

    if (this.firstTimestamp === 0 || update.timestamp < this.firstTimestamp) {
      this.firstTimestamp = update.timestamp;
    }
    if (update.timestamp > this.lastTimestamp) {
      this.lastTimestamp = update.timestamp;
    }
  }

  snapshot(): UsageSnapshot {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      requestCount: this.requestCount,
      models: { ...this.models },
      firstTimestamp: this.firstTimestamp,
      lastTimestamp: this.lastTimestamp,
    };
  }

  toJSON(): string {
    return JSON.stringify({ type: "usage-snapshot", usage: this.snapshot() });
  }
}
