import { describe, expect, test } from "bun:test";
import { generateTabId } from "../../client/persistence";

describe("persistence helpers", () => {
  test("generateTabId returns a string", () => {
    expect(typeof generateTabId()).toBe("string");
  });

  test("generateTabId returns unique IDs", () => {
    const a = generateTabId();
    const b = generateTabId();
    expect(a).not.toBe(b);
  });

  test("generateTabId returns UUID format", () => {
    const id = generateTabId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
