import { describe, expect, test } from "bun:test";
import { buildWsUrl, parseServerMessage } from "../../client/connection";

describe("buildWsUrl", () => {
  test("constructs correct URL with token", () => {
    expect(buildWsUrl("localhost", 9740, "abc123")).toBe("ws://localhost:9740/canvas?token=abc123");
  });

  test("works with IP address", () => {
    expect(buildWsUrl("192.168.1.5", 9740, "tok")).toBe("ws://192.168.1.5:9740/canvas?token=tok");
  });

  test("works with empty token", () => {
    expect(buildWsUrl("localhost", 9740, "")).toBe("ws://localhost:9740/canvas?token=");
  });
});

describe("parseServerMessage", () => {
  test("parses valid sessions message", () => {
    const msg = parseServerMessage('{"type":"sessions","sessions":[]}');
    expect(msg?.type).toBe("sessions");
  });

  test("parses ack message", () => {
    const msg = parseServerMessage('{"type":"ack","submissionId":"sub-1","timestamp":1000}');
    expect(msg?.type).toBe("ack");
    expect(msg?.submissionId).toBe("sub-1");
  });

  test("parses error message", () => {
    const msg = parseServerMessage('{"type":"error","code":"RATE_LIMITED","message":"too fast"}');
    expect(msg?.type).toBe("error");
    expect(msg?.code).toBe("RATE_LIMITED");
  });

  test("returns null for invalid JSON", () => {
    expect(parseServerMessage("not json")).toBeNull();
  });

  test("returns null for non-object", () => {
    expect(parseServerMessage('"string"')).toBeNull();
  });

  test("returns null for missing type", () => {
    expect(parseServerMessage('{"data":"something"}')).toBeNull();
  });

  test("returns null for null", () => {
    expect(parseServerMessage("null")).toBeNull();
  });
});
