/**
 * OTLP/HTTP JSON ingress handlers for Claude Code's native OpenTelemetry export.
 *
 * No auth required — these endpoints are localhost-only and the data is
 * non-sensitive (token counts, not content).
 *
 * v1 scope:
 *   - POST /otlp/v1/metrics  — parse claude_code.token.usage, broadcast usage-update
 *   - POST /otlp/v1/logs     — accept and acknowledge (no processing)
 */

export interface OtlpAttribute {
  key: string;
  value: { stringValue?: string; intValue?: string | number; doubleValue?: number };
}

interface OtlpDataPoint {
  asInt?: string | number;
  asDouble?: number;
  attributes?: OtlpAttribute[];
}

interface OtlpMetric {
  name: string;
  sum?: {
    dataPoints?: OtlpDataPoint[];
  };
  gauge?: {
    dataPoints?: OtlpDataPoint[];
  };
}

interface OtlpScopeMetrics {
  metrics?: OtlpMetric[];
}

interface OtlpResource {
  attributes?: OtlpAttribute[];
}

interface OtlpResourceMetrics {
  resource?: OtlpResource;
  scopeMetrics?: OtlpScopeMetrics[];
}

interface OtlpMetricsPayload {
  resourceMetrics?: OtlpResourceMetrics[];
}

export interface OtelIngressDeps {
  broadcastUsage: (sessionId: string, payload: string) => void;
  resolveSessionId: (resourceAttributes: OtlpAttribute[]) => string | null;
}

function getAttributeString(attrs: OtlpAttribute[], key: string): string | null {
  const attr = attrs.find((a) => a.key === key);
  return attr?.value?.stringValue ?? null;
}

function parseDataPointValue(dp: OtlpDataPoint): number {
  if (dp.asInt !== undefined) {
    return typeof dp.asInt === "string" ? parseInt(dp.asInt, 10) : dp.asInt;
  }
  if (dp.asDouble !== undefined) {
    return Math.round(dp.asDouble);
  }
  return 0;
}

export function createOtelIngress(deps: OtelIngressDeps): {
  handleMetrics: (req: Request) => Promise<Response>;
  handleLogs: (req: Request) => Promise<Response>;
} {
  async function handleMetrics(req: Request): Promise<Response> {
    let body: OtlpMetricsPayload;
    try {
      const text = await req.text();
      body = JSON.parse(text) as OtlpMetricsPayload;
    } catch {
      return new Response("Bad Request: malformed JSON", { status: 400 });
    }

    const resourceMetrics = body.resourceMetrics;
    if (!Array.isArray(resourceMetrics) || resourceMetrics.length === 0) {
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }

    for (const rm of resourceMetrics) {
      const resourceAttributes = rm.resource?.attributes ?? [];
      const sessionId = deps.resolveSessionId(resourceAttributes);
      if (!sessionId) continue;

      const scopeMetrics = rm.scopeMetrics ?? [];
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let model = "";
      let foundTokenData = false;

      for (const sm of scopeMetrics) {
        const metrics = sm.metrics ?? [];
        for (const metric of metrics) {
          if (metric.name !== "claude_code.token.usage") continue;

          const dataPoints = metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];
          for (const dp of dataPoints) {
            const attrs = dp.attributes ?? [];
            const tokenType = getAttributeString(attrs, "type");
            const tokenModel = getAttributeString(attrs, "model");
            const value = parseDataPointValue(dp);

            if (tokenModel) model = tokenModel;

            switch (tokenType) {
              case "input":
                inputTokens += value;
                foundTokenData = true;
                break;
              case "output":
                outputTokens += value;
                foundTokenData = true;
                break;
              case "cacheRead":
                cacheReadTokens += value;
                foundTokenData = true;
                break;
              case "cacheCreation":
                cacheWriteTokens += value;
                foundTokenData = true;
                break;
              default:
                break;
            }
          }
        }
      }

      if (foundTokenData) {
        const payload = JSON.stringify({
          type: "usage-update",
          usage: {
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            model,
            timestamp: Date.now(),
          },
          sessionId,
        });
        deps.broadcastUsage(sessionId, payload);
      }
    }

    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }

  async function handleLogs(req: Request): Promise<Response> {
    try {
      await req.text(); // consume body to keep the OTEL exporter happy
    } catch {
      // ignore read errors
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }

  return { handleMetrics, handleLogs };
}
