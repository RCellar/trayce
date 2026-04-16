import { describe, expect, test } from "bun:test";

// These tests require a running trayce server and the claude CLI.
// They are skipped by default — run with TRAYCE_E2E=1 bun test tests/e2e/
const SKIP = !process.env.TRAYCE_E2E;

describe.skipIf(SKIP)("E2E: Hook dispatch", () => {
  // TODO: Implement when the hook plumbing is validated manually.
  // Test structure:
  // 1. Start trayce server programmatically
  // 2. Launch claude -p "hello" with plugin installed + channel flag + OTEL env vars
  // 3. Collect HTTP requests received at /hook
  // 4. Assert SessionStart hook arrived with transcript_path
  // 5. Assert PostToolUse hook arrived (claude -p triggers at least one tool)
  // 6. Assert Stop hook arrived after claude exits

  test("placeholder: SessionStart hook fires on claude startup", () => {
    expect(true).toBe(true);
  });

  test("placeholder: PostToolUse hook fires on tool use", () => {
    expect(true).toBe(true);
  });

  test("placeholder: Stop hook fires on session end", () => {
    expect(true).toBe(true);
  });
});
