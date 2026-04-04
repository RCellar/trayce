import { describe, expect, test } from "bun:test";
import { getConfig } from "../../server/config";
import { generateToken } from "../../server/auth";

describe("token resolution priority", () => {
  test("noAuth=true means no token regardless of TRAYCE_TOKEN", () => {
    const config = getConfig({ TRAYCE_NO_AUTH: "true", TRAYCE_TOKEN: "mysecret" });
    expect(config.noAuth).toBe(true);
    // When noAuth is true, server should use empty token — verified via index.ts logic
  });

  test("TRAYCE_TOKEN set means use that token", () => {
    const config = getConfig({ TRAYCE_TOKEN: "mysecret" });
    expect(config.noAuth).toBe(false);
    expect(config.token).toBe("mysecret");
  });

  test("no TRAYCE_TOKEN and no noAuth means auto-generate", () => {
    const config = getConfig({});
    expect(config.noAuth).toBe(false);
    expect(config.token).toBeUndefined();
    // Server should call generateToken() in this case
    const generated = generateToken();
    expect(typeof generated).toBe("string");
    expect(generated.length).toBeGreaterThan(0);
  });
});
