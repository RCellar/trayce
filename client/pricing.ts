export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6":   { input: 5,   output: 25, cacheRead: 0.50, cacheWrite: 10 },
  "claude-sonnet-4-6": { input: 3,   output: 15, cacheRead: 0.30, cacheWrite: 6 },
  "claude-haiku-4-5":  { input: 1,   output: 5,  cacheRead: 0.10, cacheWrite: 2 },
};

const DEFAULT_PRICING: ModelPricing = MODEL_PRICING["claude-sonnet-4-6"]!;

export function getPricing(model: string): ModelPricing {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key.replace(/-\d+-\d+$/, ""))) return pricing;
  }
  return DEFAULT_PRICING;
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

export function estimateCost(snapshot: UsageSnapshot): number {
  let total = 0;
  for (const [model, data] of Object.entries(snapshot.models)) {
    const p = getPricing(model);
    total += (data.inputTokens / 1_000_000) * p.input;
    total += (data.outputTokens / 1_000_000) * p.output;
  }
  const primaryModel = Object.entries(snapshot.models)
    .sort((a, b) => b[1].requests - a[1].requests)[0]?.[0] ?? "";
  const pp = getPricing(primaryModel);
  total += (snapshot.cacheReadTokens / 1_000_000) * pp.cacheRead;
  total += (snapshot.cacheWriteTokens / 1_000_000) * pp.cacheWrite;
  return total;
}

export function formatCost(dollars: number): string {
  if (dollars < 0.01) return "<$0.01";
  return "$" + dollars.toFixed(4);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
