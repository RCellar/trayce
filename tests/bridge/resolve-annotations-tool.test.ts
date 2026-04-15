import { describe, expect, test } from "bun:test";
import { handleResolveAnnotations } from "../../bridge/index";

describe("resolve_annotations tool", () => {
  test("sends annotation-update WS frame with updates", () => {
    const sent: string[] = [];
    const ws = {
      readyState: 1, // OPEN
      send: (s: string) => sent.push(s),
    } as unknown as WebSocket;
    const result = handleResolveAnnotations(
      { updates: [{ id: "a1", status: "addressed", reply: "done" }] },
      ws,
    );
    expect(result.content[0]!.type).toBe("text");
    expect(sent.length).toBe(1);
    const frame = JSON.parse(sent[0]!);
    expect(frame.type).toBe("annotation-update");
    expect(frame.updates[0].id).toBe("a1");
    expect(frame.updates[0].reply).toBe("done");
  });

  test("rejects empty updates array", () => {
    const ws = { readyState: 1, send: () => {} } as unknown as WebSocket;
    const result = handleResolveAnnotations({ updates: [] }, ws);
    expect(result.content[0]!.text).toContain("Error");
  });

  test("errors when not connected", () => {
    const ws = { readyState: 3, send: () => {} } as unknown as WebSocket; // CLOSED
    const result = handleResolveAnnotations({ updates: [{ id: "a1", status: "addressed" }] }, ws);
    expect(result.content[0]!.text).toContain("not connected");
  });
});
