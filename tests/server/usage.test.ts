import { describe, expect, it } from "bun:test";
import { SessionUsage, type UsageUpdate } from "../../server/usage";

function makeUpdate(overrides: Partial<UsageUpdate> = {}): UsageUpdate {
  return {
    inputTokens: 10,
    outputTokens: 50,
    cacheReadTokens: 100,
    cacheWriteTokens: 5,
    model: "claude-opus-4-6",
    timestamp: 1000000,
    ...overrides,
  };
}

describe("SessionUsage", () => {
  it("starts with zero snapshot", () => {
    const usage = new SessionUsage();
    const snap = usage.snapshot();
    expect(snap.inputTokens).toBe(0);
    expect(snap.outputTokens).toBe(0);
    expect(snap.cacheReadTokens).toBe(0);
    expect(snap.cacheWriteTokens).toBe(0);
    expect(snap.requestCount).toBe(0);
    expect(Object.keys(snap.models)).toHaveLength(0);
  });

  it("accumulates token counts from updates", () => {
    const usage = new SessionUsage();
    usage.add(makeUpdate({ inputTokens: 10, outputTokens: 50 }));
    usage.add(makeUpdate({ inputTokens: 20, outputTokens: 30 }));
    const snap = usage.snapshot();
    expect(snap.inputTokens).toBe(30);
    expect(snap.outputTokens).toBe(80);
    expect(snap.requestCount).toBe(2);
  });

  it("tracks cache tokens separately", () => {
    const usage = new SessionUsage();
    usage.add(makeUpdate({ cacheReadTokens: 500, cacheWriteTokens: 100 }));
    usage.add(makeUpdate({ cacheReadTokens: 300, cacheWriteTokens: 50 }));
    const snap = usage.snapshot();
    expect(snap.cacheReadTokens).toBe(800);
    expect(snap.cacheWriteTokens).toBe(150);
  });

  it("tracks per-model breakdown", () => {
    const usage = new SessionUsage();
    usage.add(makeUpdate({ model: "claude-opus-4-6", inputTokens: 10, outputTokens: 50 }));
    usage.add(makeUpdate({ model: "claude-haiku-4-5", inputTokens: 5, outputTokens: 20 }));
    usage.add(makeUpdate({ model: "claude-opus-4-6", inputTokens: 15, outputTokens: 30 }));
    const snap = usage.snapshot();
    expect(Object.keys(snap.models)).toHaveLength(2);
    expect(snap.models["claude-opus-4-6"]!.inputTokens).toBe(25);
    expect(snap.models["claude-opus-4-6"]!.outputTokens).toBe(80);
    expect(snap.models["claude-opus-4-6"]!.requests).toBe(2);
    expect(snap.models["claude-haiku-4-5"]!.requests).toBe(1);
  });

  it("tracks first and last timestamp", () => {
    const usage = new SessionUsage();
    usage.add(makeUpdate({ timestamp: 1000 }));
    usage.add(makeUpdate({ timestamp: 5000 }));
    usage.add(makeUpdate({ timestamp: 3000 }));
    const snap = usage.snapshot();
    expect(snap.firstTimestamp).toBe(1000);
    expect(snap.lastTimestamp).toBe(5000);
  });

  it("serializes snapshot to JSON", () => {
    const usage = new SessionUsage();
    usage.add(makeUpdate());
    const json = usage.toJSON();
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("usage-snapshot");
    expect(parsed.usage.inputTokens).toBe(10);
    expect(parsed.usage.requestCount).toBe(1);
  });
});
