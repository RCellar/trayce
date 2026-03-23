import { describe, expect, it } from "bun:test";
import { generateToken, validateToken } from "../../server/auth";

describe("generateToken", () => {
  it("returns a non-empty string", () => {
    const token = generateToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("returns a different value on each call", () => {
    const tokens = Array.from({ length: 20 }, generateToken);
    const unique = new Set(tokens);
    expect(unique.size).toBe(20);
  });

  it("matches UUID v4 format", () => {
    const uuidV4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (let i = 0; i < 10; i++) {
      expect(generateToken()).toMatch(uuidV4);
    }
  });
});

describe("validateToken", () => {
  it("returns true when provided matches expected", () => {
    const token = generateToken();
    expect(validateToken(token, token)).toBe(true);
  });

  it("returns true for arbitrary matching strings", () => {
    expect(validateToken("abc123", "abc123")).toBe(true);
  });

  it("returns false when provided does not match expected", () => {
    const a = generateToken();
    const b = generateToken();
    expect(validateToken(a, b)).toBe(false);
  });

  it("returns false for strings that differ by one character", () => {
    expect(validateToken("aaaaa", "aaaab")).toBe(false);
  });

  it("returns false and does not throw when provided is shorter", () => {
    expect(() => validateToken("short", "much-longer-expected-value")).not.toThrow();
    expect(validateToken("short", "much-longer-expected-value")).toBe(false);
  });

  it("returns false and does not throw when provided is longer", () => {
    expect(() => validateToken("much-longer-provided-value", "short")).not.toThrow();
    expect(validateToken("much-longer-provided-value", "short")).toBe(false);
  });

  it("returns false for empty string provided", () => {
    expect(validateToken("", "expected")).toBe(false);
  });

  it("returns false when provided is null", () => {
    expect(validateToken(null, "expected")).toBe(false);
  });

  it("returns false when provided is undefined", () => {
    expect(validateToken(undefined, "expected")).toBe(false);
  });

  it("returns false when provided is a number", () => {
    expect(validateToken(42, "expected")).toBe(false);
  });

  it("returns false when provided is an object", () => {
    expect(validateToken({}, "expected")).toBe(false);
  });

  it("returns false when provided is a boolean", () => {
    expect(validateToken(true, "expected")).toBe(false);
  });

  it("returns false when expected is empty string", () => {
    expect(validateToken("anything", "")).toBe(false);
  });

  it("returns false when expected is null", () => {
    expect(validateToken("anything", null)).toBe(false);
  });

  it("returns false when expected is undefined", () => {
    expect(validateToken("anything", undefined)).toBe(false);
  });

  it("returns true for matching multibyte UTF-8 strings", () => {
    const token = "日本語テスト🔑";
    expect(validateToken(token, token)).toBe(true);
  });

  it("returns false for multibyte strings that differ in byte length", () => {
    expect(validateToken("cafe", "café")).toBe(false);
  });

  it("does not conflate strings with same byte length but different content", () => {
    expect(validateToken("AAAA", "BBBB")).toBe(false);
  });

  it("returns false for token with leading/trailing whitespace", () => {
    const token = generateToken();
    expect(validateToken(` ${token}`, token)).toBe(false);
    expect(validateToken(`${token} `, token)).toBe(false);
  });
});
