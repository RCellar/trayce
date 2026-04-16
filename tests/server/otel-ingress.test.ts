import { describe, expect, it } from "bun:test";
import { type OtlpAttribute, createOtelIngress } from "../../server/otel-ingress";

// -- Helpers --

function makeMetricsPayload(
  dataPoints: Array<{
    type: string;
    model?: string;
    asInt?: string;
    asDouble?: number;
  }>,
  resourceAttributes: OtlpAttribute[] = [
    { key: "session.id", value: { stringValue: "session-abc" } },
  ],
): string {
  const metrics = dataPoints.map((dp) => ({
    name: "claude_code.token.usage",
    sum: {
      dataPoints: [
        {
          ...(dp.asInt !== undefined ? { asInt: dp.asInt } : {}),
          ...(dp.asDouble !== undefined ? { asDouble: dp.asDouble } : {}),
          attributes: [
            { key: "type", value: { stringValue: dp.type } },
            ...(dp.model !== undefined
              ? [{ key: "model", value: { stringValue: dp.model } }]
              : []),
          ],
        },
      ],
    },
  }));

  return JSON.stringify({
    resourceMetrics: [
      {
        resource: { attributes: resourceAttributes },
        scopeMetrics: [{ metrics }],
      },
    ],
  });
}

function makeRequest(body: string, path = "/otlp/v1/metrics"): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

// -- Fixtures --

interface BroadcastCall {
  sessionId: string;
  payload: string;
}

function makeDeps(resolvedSessionId: string | null = "session-abc"): {
  deps: ReturnType<typeof createOtelIngress> extends never ? never : Parameters<typeof createOtelIngress>[0];
  broadcasts: BroadcastCall[];
} {
  const broadcasts: BroadcastCall[] = [];
  const deps = {
    broadcastUsage: (sessionId: string, payload: string) => {
      broadcasts.push({ sessionId, payload });
    },
    resolveSessionId: (_attrs: OtlpAttribute[]) => resolvedSessionId,
  };
  return { deps, broadcasts };
}

// -- Tests --

describe("handleMetrics", () => {
  it("parses OTLP metrics with claude_code.token.usage for input and output", async () => {
    const { deps, broadcasts } = makeDeps("session-abc");
    const { handleMetrics } = createOtelIngress(deps);

    const body = makeMetricsPayload([
      { type: "input", asInt: "500", model: "claude-sonnet-4-6" },
      { type: "output", asInt: "200", model: "claude-sonnet-4-6" },
    ]);

    const res = await handleMetrics(makeRequest(body));
    expect(res.status).toBe(200);
    expect(broadcasts).toHaveLength(1);

    const msg = JSON.parse(broadcasts[0]!.payload);
    expect(msg.type).toBe("usage-update");
    expect(msg.sessionId).toBe("session-abc");
    expect(msg.usage.inputTokens).toBe(500);
    expect(msg.usage.outputTokens).toBe(200);
    expect(msg.usage.cacheReadTokens).toBe(0);
    expect(msg.usage.cacheWriteTokens).toBe(0);
    expect(msg.usage.model).toBe("claude-sonnet-4-6");
    expect(typeof msg.usage.timestamp).toBe("number");
  });

  it("handles empty resourceMetrics array gracefully (200 OK, no broadcast)", async () => {
    const { deps, broadcasts } = makeDeps("session-abc");
    const { handleMetrics } = createOtelIngress(deps);

    const body = JSON.stringify({ resourceMetrics: [] });
    const res = await handleMetrics(makeRequest(body));

    expect(res.status).toBe(200);
    expect(broadcasts).toHaveLength(0);
  });

  it("rejects malformed JSON with 400", async () => {
    const { deps } = makeDeps("session-abc");
    const { handleMetrics } = createOtelIngress(deps);

    const res = await handleMetrics(makeRequest("this is not json"));
    expect(res.status).toBe(400);
  });

  it("handles metrics with asDouble values (not just asInt)", async () => {
    const { deps, broadcasts } = makeDeps("session-abc");
    const { handleMetrics } = createOtelIngress(deps);

    const body = makeMetricsPayload([
      { type: "input", asDouble: 123.7, model: "claude-haiku-4-5" },
      { type: "output", asDouble: 50.2, model: "claude-haiku-4-5" },
    ]);

    const res = await handleMetrics(makeRequest(body));
    expect(res.status).toBe(200);
    expect(broadcasts).toHaveLength(1);

    const msg = JSON.parse(broadcasts[0]!.payload);
    expect(msg.usage.inputTokens).toBe(124); // Math.round(123.7)
    expect(msg.usage.outputTokens).toBe(50); // Math.round(50.2)
  });

  it("ignores metrics with names other than claude_code.token.usage", async () => {
    const { deps, broadcasts } = makeDeps("session-abc");
    const { handleMetrics } = createOtelIngress(deps);

    const body = JSON.stringify({
      resourceMetrics: [
        {
          resource: {
            attributes: [{ key: "session.id", value: { stringValue: "session-abc" } }],
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "some.other.metric",
                  sum: {
                    dataPoints: [
                      {
                        asInt: "999",
                        attributes: [{ key: "type", value: { stringValue: "input" } }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const res = await handleMetrics(makeRequest(body));
    expect(res.status).toBe(200);
    expect(broadcasts).toHaveLength(0);
  });

  it("does not broadcast when resolveSessionId returns null", async () => {
    const { deps, broadcasts } = makeDeps(null);
    const { handleMetrics } = createOtelIngress(deps);

    const body = makeMetricsPayload([{ type: "input", asInt: "100", model: "claude-sonnet-4-6" }]);
    const res = await handleMetrics(makeRequest(body));

    expect(res.status).toBe(200);
    expect(broadcasts).toHaveLength(0);
  });

  it("parses cacheRead and cacheCreation token types", async () => {
    const { deps, broadcasts } = makeDeps("session-abc");
    const { handleMetrics } = createOtelIngress(deps);

    const body = makeMetricsPayload([
      { type: "cacheRead", asInt: "300", model: "claude-sonnet-4-6" },
      { type: "cacheCreation", asInt: "50", model: "claude-sonnet-4-6" },
    ]);

    const res = await handleMetrics(makeRequest(body));
    expect(res.status).toBe(200);
    expect(broadcasts).toHaveLength(1);

    const msg = JSON.parse(broadcasts[0]!.payload);
    expect(msg.usage.cacheReadTokens).toBe(300);
    expect(msg.usage.cacheWriteTokens).toBe(50);
    expect(msg.usage.inputTokens).toBe(0);
    expect(msg.usage.outputTokens).toBe(0);
  });
});

describe("handleLogs", () => {
  it("returns 200 OK regardless of body", async () => {
    const { deps } = makeDeps("session-abc");
    const { handleLogs } = createOtelIngress(deps);

    const body = JSON.stringify({ resourceLogs: [{ resource: {}, scopeLogs: [] }] });
    const res = await handleLogs(
      new Request("http://localhost/otlp/v1/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    );

    expect(res.status).toBe(200);
  });

  it("accepts and acknowledges without processing log entries", async () => {
    const { deps, broadcasts } = makeDeps("session-abc");
    const { handleLogs } = createOtelIngress(deps);

    const res = await handleLogs(
      new Request("http://localhost/otlp/v1/logs", {
        method: "POST",
        body: JSON.stringify({ resourceLogs: [{ logRecords: [{ body: "some log line" }] }] }),
      }),
    );

    expect(res.status).toBe(200);
    expect(broadcasts).toHaveLength(0);
  });
});
