import { describe, expect, test } from "bun:test";

const SKIP = !process.env.TRAYCE_E2E;

describe.skipIf(SKIP)("E2E: OTEL emission", () => {
  // TODO: Implement when OTEL plumbing is validated manually.
  // Test structure:
  // 1. Start trayce server with OTLP endpoints
  // 2. Launch claude -p "hello" with CLAUDE_CODE_ENABLE_TELEMETRY=1
  //    and OTEL_EXPORTER_OTLP_ENDPOINT pointing at the trayce server
  // 3. Wait for claude to complete + OTEL export interval
  // 4. Assert /otlp/v1/metrics received at least one payload with
  //    claude_code.token.usage metric data

  test("placeholder: claude emits token usage metrics", () => {
    expect(true).toBe(true);
  });
});
