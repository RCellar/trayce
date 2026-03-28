import { describe, it, expect } from "bun:test";
import { formatTabTitle } from "../../client/tab-title";

describe("formatTabTitle", () => {
  it("returns base title when no sessions", () => {
    expect(formatTabTitle([], "")).toBe("trayce");
  });

  it("returns base title when selected session not found", () => {
    const sessions = [{ id: "abc", label: "MediaStack", status: "active" }];
    expect(formatTabTitle(sessions, "nonexistent")).toBe("trayce");
  });

  it("returns title with session label when session is selected", () => {
    const sessions = [{ id: "abc", label: "MediaStack", status: "active" }];
    expect(formatTabTitle(sessions, "abc")).toBe("trayce — MediaStack");
  });

  it("returns title with correct session when multiple exist", () => {
    const sessions = [
      { id: "abc", label: "trayce", status: "active" },
      { id: "def", label: "MediaStack", status: "active" },
    ];
    expect(formatTabTitle(sessions, "def")).toBe("trayce — MediaStack");
  });
});
