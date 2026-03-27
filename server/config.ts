export interface Config {
  host: string;
  port: number;
  submissionsDir: string;
  stateFile: string;
  clientDir: string;
  maxSubmissionBytes: number;
  maxWsPayloadBytes: number;
  submissionTtlMs: number;
  cleanupIntervalMs: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  rateLimitPerMinute: number;
  transcriptBufferSize: number;
  noAuth: boolean;
}

const DEFAULTS: Config = {
  host: "0.0.0.0",
  port: 9740,
  submissionsDir: "/tmp/trayce/submissions",
  stateFile: "/tmp/trayce/state.json",
  clientDir: "dist/client",
  maxSubmissionBytes: 20 * 1024 * 1024,   // 20 MB
  maxWsPayloadBytes: 30 * 1024 * 1024,    // 30 MB
  submissionTtlMs: 60 * 60 * 1000,        // 1 hour
  cleanupIntervalMs: 15 * 60 * 1000,      // 15 minutes
  heartbeatIntervalMs: 10 * 1000,         // 10 seconds
  heartbeatTimeoutMs: 30 * 1000,          // 30 seconds
  rateLimitPerMinute: 10,
  transcriptBufferSize: 500,
  noAuth: false,
};

function parsePort(raw: string | undefined, defaultPort: number): number {
  if (raw === undefined || raw.trim() === "") return defaultPort;

  const n = Number(raw);

  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.warn(
      `[trayce] Invalid TRAYCE_PORT value "${raw}" — must be an integer between 1 and 65535. ` +
        `Falling back to default port ${defaultPort}.`
    );
    return defaultPort;
  }

  return n;
}

function parseBool(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return ["1", "true", "yes"].includes(raw.trim().toLowerCase());
}

export function getConfig(env: Record<string, string | undefined>): Config {
  return {
    host: env.TRAYCE_HOST?.trim() || DEFAULTS.host,
    port: parsePort(env.TRAYCE_PORT, DEFAULTS.port),
    submissionsDir: env.TRAYCE_SUBMISSIONS_DIR?.trim() || DEFAULTS.submissionsDir,
    stateFile: env.TRAYCE_STATE_FILE?.trim() || DEFAULTS.stateFile,
    clientDir: env.TRAYCE_CLIENT_DIR?.trim() || DEFAULTS.clientDir,
    noAuth: parseBool(env.TRAYCE_NO_AUTH),
    maxSubmissionBytes: DEFAULTS.maxSubmissionBytes,
    maxWsPayloadBytes: DEFAULTS.maxWsPayloadBytes,
    submissionTtlMs: DEFAULTS.submissionTtlMs,
    cleanupIntervalMs: DEFAULTS.cleanupIntervalMs,
    heartbeatIntervalMs: DEFAULTS.heartbeatIntervalMs,
    heartbeatTimeoutMs: DEFAULTS.heartbeatTimeoutMs,
    rateLimitPerMinute: DEFAULTS.rateLimitPerMinute,
    transcriptBufferSize: DEFAULTS.transcriptBufferSize,
  };
}
