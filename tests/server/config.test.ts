import { describe, expect, test } from "bun:test";
import { getConfig, type Config } from "../../server/config";

function env(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return overrides;
}

describe("getConfig — defaults", () => {
  const cfg = getConfig(env());

  test("host defaults to 0.0.0.0", () => {
    expect(cfg.host).toBe("0.0.0.0");
  });

  test("port defaults to 9740", () => {
    expect(cfg.port).toBe(9740);
  });

  test("submissionsDir defaults to /tmp/trayce/submissions", () => {
    expect(cfg.submissionsDir).toBe("/tmp/trayce/submissions");
  });

  test("stateFile defaults to /tmp/trayce/state.json", () => {
    expect(cfg.stateFile).toBe("/tmp/trayce/state.json");
  });

  test("clientDir defaults to dist/client", () => {
    expect(cfg.clientDir).toBe("dist/client");
  });

  test("noAuth defaults to false", () => {
    expect(cfg.noAuth).toBe(false);
  });

  test("maxSubmissionBytes is 20 MB", () => {
    expect(cfg.maxSubmissionBytes).toBe(20 * 1024 * 1024);
  });

  test("maxWsPayloadBytes is 30 MB", () => {
    expect(cfg.maxWsPayloadBytes).toBe(30 * 1024 * 1024);
  });

  test("submissionTtlMs is 1 hour", () => {
    expect(cfg.submissionTtlMs).toBe(60 * 60 * 1000);
  });

  test("cleanupIntervalMs is 15 minutes", () => {
    expect(cfg.cleanupIntervalMs).toBe(15 * 60 * 1000);
  });

  test("heartbeatIntervalMs is 10 seconds", () => {
    expect(cfg.heartbeatIntervalMs).toBe(10 * 1000);
  });

  test("heartbeatTimeoutMs is 30 seconds", () => {
    expect(cfg.heartbeatTimeoutMs).toBe(30 * 1000);
  });

  test("rateLimitPerMinute is 10", () => {
    expect(cfg.rateLimitPerMinute).toBe(10);
  });
});

describe("getConfig — env overrides", () => {
  test("TRAYCE_HOST overrides host", () => {
    expect(getConfig(env({ TRAYCE_HOST: "127.0.0.1" })).host).toBe("127.0.0.1");
  });

  test("TRAYCE_PORT overrides port", () => {
    expect(getConfig(env({ TRAYCE_PORT: "8080" })).port).toBe(8080);
  });

  test("TRAYCE_SUBMISSIONS_DIR overrides submissionsDir", () => {
    expect(getConfig(env({ TRAYCE_SUBMISSIONS_DIR: "/data/submissions" })).submissionsDir).toBe("/data/submissions");
  });

  test("TRAYCE_STATE_FILE overrides stateFile", () => {
    expect(getConfig(env({ TRAYCE_STATE_FILE: "/data/state.json" })).stateFile).toBe("/data/state.json");
  });

  test("TRAYCE_CLIENT_DIR overrides clientDir", () => {
    expect(getConfig(env({ TRAYCE_CLIENT_DIR: "/srv/client" })).clientDir).toBe("/srv/client");
  });

  test("TRAYCE_NO_AUTH=1 sets noAuth to true", () => {
    expect(getConfig(env({ TRAYCE_NO_AUTH: "1" })).noAuth).toBe(true);
  });

  test("TRAYCE_NO_AUTH=true sets noAuth to true", () => {
    expect(getConfig(env({ TRAYCE_NO_AUTH: "true" })).noAuth).toBe(true);
  });

  test("TRAYCE_NO_AUTH=yes sets noAuth to true", () => {
    expect(getConfig(env({ TRAYCE_NO_AUTH: "yes" })).noAuth).toBe(true);
  });

  test("TRAYCE_NO_AUTH=TRUE is case-insensitive", () => {
    expect(getConfig(env({ TRAYCE_NO_AUTH: "TRUE" })).noAuth).toBe(true);
  });

  test("TRAYCE_NO_AUTH=false leaves noAuth false", () => {
    expect(getConfig(env({ TRAYCE_NO_AUTH: "false" })).noAuth).toBe(false);
  });

  test("TRAYCE_NO_AUTH=0 leaves noAuth false", () => {
    expect(getConfig(env({ TRAYCE_NO_AUTH: "0" })).noAuth).toBe(false);
  });

  test("port boundary: port 1 is accepted", () => {
    expect(getConfig(env({ TRAYCE_PORT: "1" })).port).toBe(1);
  });

  test("port boundary: port 65535 is accepted", () => {
    expect(getConfig(env({ TRAYCE_PORT: "65535" })).port).toBe(65535);
  });
});

describe("getConfig — TRAYCE_PORT validation", () => {
  test("non-numeric value falls back to default port", () => {
    expect(getConfig(env({ TRAYCE_PORT: "abc" })).port).toBe(9740);
  });

  test("negative port falls back to default", () => {
    expect(getConfig(env({ TRAYCE_PORT: "-1" })).port).toBe(9740);
  });

  test("port 0 falls back to default", () => {
    expect(getConfig(env({ TRAYCE_PORT: "0" })).port).toBe(9740);
  });

  test("port > 65535 falls back to default", () => {
    expect(getConfig(env({ TRAYCE_PORT: "99999" })).port).toBe(9740);
  });

  test("empty string falls back to default", () => {
    expect(getConfig(env({ TRAYCE_PORT: "" })).port).toBe(9740);
  });

  test("whitespace-only string falls back to default", () => {
    expect(getConfig(env({ TRAYCE_PORT: "   " })).port).toBe(9740);
  });

  test("float value falls back to default", () => {
    expect(getConfig(env({ TRAYCE_PORT: "8080.5" })).port).toBe(9740);
  });

  test("leading-zero string parses as decimal", () => {
    expect(getConfig(env({ TRAYCE_PORT: "08080" })).port).toBe(8080);
  });

  test("undefined TRAYCE_PORT uses default", () => {
    expect(getConfig(env({ TRAYCE_PORT: undefined })).port).toBe(9740);
  });
});

describe("getConfig — whitespace trimming", () => {
  test("TRAYCE_HOST with spaces is trimmed", () => {
    expect(getConfig(env({ TRAYCE_HOST: "  192.168.1.100  " })).host).toBe("192.168.1.100");
  });

  test("TRAYCE_SUBMISSIONS_DIR with spaces is trimmed", () => {
    expect(getConfig(env({ TRAYCE_SUBMISSIONS_DIR: "  /data/subs  " })).submissionsDir).toBe("/data/subs");
  });
});

describe("getConfig — internal constants not overridable", () => {
  const cfg = getConfig(env({
    TRAYCE_HOST: "127.0.0.1",
    TRAYCE_PORT: "1234",
    TRAYCE_NO_AUTH: "true",
  }));

  test("maxSubmissionBytes remains 20 MB", () => {
    expect(cfg.maxSubmissionBytes).toBe(20 * 1024 * 1024);
  });

  test("maxWsPayloadBytes remains 30 MB", () => {
    expect(cfg.maxWsPayloadBytes).toBe(30 * 1024 * 1024);
  });

  test("rateLimitPerMinute remains 10", () => {
    expect(cfg.rateLimitPerMinute).toBe(10);
  });
});

describe("getConfig — return type shape", () => {
  test("all Config keys are present", () => {
    const cfg: Config = getConfig(env());
    const keys: (keyof Config)[] = [
      "host", "port", "submissionsDir", "stateFile", "clientDir",
      "maxSubmissionBytes", "maxWsPayloadBytes", "submissionTtlMs",
      "cleanupIntervalMs", "heartbeatIntervalMs", "heartbeatTimeoutMs",
      "rateLimitPerMinute", "noAuth",
    ];
    for (const key of keys) {
      expect(cfg[key]).toBeDefined();
    }
  });
});
