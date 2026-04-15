import { describe, expect, test } from "bun:test";
import { handlePushAnnotations } from "../../bridge/index";

describe("push_annotations tool", () => {
  test("assigns IDs and sets author=claude", () => {
    const sent: string[] = [];
    const ws = {
      readyState: 1,
      send: (s: string) => sent.push(s),
    } as unknown as WebSocket;
    const result = handlePushAnnotations(
      { annotations: [{ kind: "text", text: "look", bbox: [0, 0, 10, 10] }] },
      ws,
      () => 5, // next pin number
    );
    expect(result.content[0]!.type).toBe("text");
    const frame = JSON.parse(sent[0]!);
    expect(frame.type).toBe("annotations-push");
    expect(frame.annotations[0].id).toMatch(/[-0-9a-f]{36}/);
    expect(frame.annotations[0].author).toBe("claude");
    expect(frame.annotations[0].status).toBe("open");
    expect(frame.annotations[0].replies).toEqual([]);
  });

  test("auto-numbers pins from the supplied next-number", () => {
    const sent: string[] = [];
    const ws = { readyState: 1, send: (s: string) => sent.push(s) } as unknown as WebSocket;
    handlePushAnnotations(
      {
        annotations: [
          { kind: "pin", at: [10, 10] },
          { kind: "pin", at: [20, 20] },
        ],
      },
      ws,
      () => 7,
    );
    const frame = JSON.parse(sent[0]!);
    expect(frame.annotations[0].number).toBe(7);
    expect(frame.annotations[1].number).toBe(8);
  });

  test("rejects empty array", () => {
    const ws = { readyState: 1, send: () => {} } as unknown as WebSocket;
    const result = handlePushAnnotations({ annotations: [] }, ws, () => 1);
    expect(result.content[0]!.text).toContain("Error");
  });

  test("errors when not connected", () => {
    const ws = { readyState: 3, send: () => {} } as unknown as WebSocket;
    const result = handlePushAnnotations(
      { annotations: [{ kind: "pin", at: [0, 0] }] },
      ws,
      () => 1,
    );
    expect(result.content[0]!.text).toContain("not connected");
  });
});
