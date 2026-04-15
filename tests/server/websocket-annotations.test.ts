import { describe, expect, test } from "bun:test";
import { WebSocketHub } from "../../server/websocket";

describe("WebSocketHub annotation message parsing", () => {
  test("parses annotation-update from bridge", () => {
    const raw = JSON.stringify({
      type: "annotation-update",
      updates: [{ id: "a1", status: "addressed", reply: "done" }],
    });
    const parsed = WebSocketHub.parseBridgeMessage(raw);
    expect(parsed?.type).toBe("annotation-update");
    if (parsed?.type === "annotation-update") {
      expect(parsed.updates[0]?.id).toBe("a1");
    }
  });

  test("parses annotations-push from bridge", () => {
    const raw = JSON.stringify({
      type: "annotations-push",
      annotations: [
        {
          id: "a1",
          kind: "pin",
          author: "claude",
          status: "open",
          createdAt: 1,
          updatedAt: 1,
          replies: [],
          number: 1,
          at: [10, 20],
        },
      ],
    });
    const parsed = WebSocketHub.parseBridgeMessage(raw);
    expect(parsed?.type).toBe("annotations-push");
  });

  test("parses submit with annotations from browser", () => {
    const raw = JSON.stringify({
      type: "submit",
      targetSessionId: "s1",
      prompt: "hi",
      annotations: [
        {
          id: "a1",
          kind: "pin",
          author: "user",
          status: "open",
          createdAt: 1,
          updatedAt: 1,
          replies: [],
          number: 1,
          at: [0, 0],
        },
      ],
    });
    const parsed = WebSocketHub.parseBrowserMessage(raw);
    expect(parsed?.type).toBe("submit");
    if (parsed?.type === "submit") {
      expect(parsed.annotations?.length).toBe(1);
    }
  });

  test("drops malformed annotation-update", () => {
    const raw = JSON.stringify({
      type: "annotation-update",
      updates: [{ id: "a1", status: "bogus" }],
    });
    const parsed = WebSocketHub.parseBridgeMessage(raw);
    expect(parsed).toBeNull();
  });
});
