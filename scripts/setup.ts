/**
 * Cross-platform setup script (replaces setup.sh for Windows compatibility).
 * Configures Claude Code to use trayce as a channel by writing .mcp.json.
 * No jq dependency — uses JSON.parse/JSON.stringify.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const bridgePath = join(projectRoot, "bridge", "index.ts");

// Parse args
let label = "";
let scope: "project" | "global" = "project";
let uninstall = false;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--label":
      label = args[++i] ?? "";
      break;
    case "--global":
      scope = "global";
      break;
    case "--uninstall":
      uninstall = true;
      break;
    case "-h":
    case "--help":
      console.log(`Usage: bun run scripts/setup.ts [OPTIONS]

Options:
  --label NAME    Session label shown in trayce dropdown (default: directory name)
  --global        Install to ~/.claude/.mcp.json instead of project .mcp.json
  --uninstall     Remove trayce from MCP config
  -h, --help      Show this help

After setup, launch Claude Code with:
  claude --dangerously-load-development-channels server:trayce`);
      process.exit(0);
      break;
    default:
      console.error(`Unknown option: ${args[i]}`);
      process.exit(1);
  }
}

// Determine config file path
const mcpFile = scope === "global" ? join(homedir(), ".claude.json") : ".mcp.json";

// Uninstall
if (uninstall) {
  if (existsSync(mcpFile)) {
    try {
      const config = JSON.parse(readFileSync(mcpFile, "utf-8"));
      if (config.mcpServers?.trayce) {
        delete config.mcpServers.trayce;
        writeFileSync(mcpFile, `${JSON.stringify(config, null, 2)}\n`);
        console.log(`Removed trayce from ${mcpFile}`);
      } else {
        console.log("trayce not found in config.");
      }
    } catch (err) {
      console.error(`Error reading ${mcpFile}:`, err);
      process.exit(1);
    }
  } else {
    console.log(`No MCP config found at ${mcpFile}`);
  }

  // Also clean up OTEL env vars
  const settingsDir = scope === "global"
    ? join(homedir(), ".claude")
    : ".claude";
  const settingsFile = join(settingsDir, "settings.local.json");
  if (existsSync(settingsFile)) {
    try {
      const settings = JSON.parse(readFileSync(settingsFile, "utf-8"));
      if (settings.env) {
        delete settings.env.CLAUDE_CODE_ENABLE_TELEMETRY;
        delete settings.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        delete settings.env.OTEL_METRICS_EXPORTER;
        delete settings.env.OTEL_LOGS_EXPORTER;
        delete settings.env.OTEL_METRIC_EXPORT_INTERVAL;
        if (Object.keys(settings.env).length === 0) delete settings.env;
      }
      writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
      console.log(`OTEL env vars removed from ${settingsFile}`);
    } catch {}
  }

  process.exit(0);
}

// Check prerequisites
if (!existsSync(bridgePath)) {
  console.error(`Error: Bridge not found at ${bridgePath}`);
  console.error("Run this script from the trayce project root.");
  process.exit(1);
}

// Install dependencies if needed
if (!existsSync(join(projectRoot, "node_modules"))) {
  console.log("Installing dependencies...");
  const result = Bun.spawnSync(["bun", "install"], {
    cwd: projectRoot,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.exitCode !== 0) {
    console.error("Failed to install dependencies.");
    process.exit(1);
  }
}

// Build client if needed
if (!existsSync(join(projectRoot, "dist", "client", "app.js"))) {
  console.log("Building client...");
  const result = Bun.spawnSync(["bun", "run", "build:client"], {
    cwd: projectRoot,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.exitCode !== 0) {
    console.error("Failed to build client.");
    process.exit(1);
  }
}

// Default label from cwd directory name
if (!label) {
  label = basename(process.cwd());
}

// Build MCP entry
const bunBin = process.execPath;
const trayceEntry: Record<string, unknown> = {
  command: bunBin,
  args: ["run", bridgePath],
};

// Global installs omit TRAYCE_LABEL so each session auto-labels from cwd
if (scope !== "global") {
  trayceEntry.env = { TRAYCE_LABEL: label };
}

// Read or create config
let config: Record<string, any> = {};
if (existsSync(mcpFile)) {
  try {
    config = JSON.parse(readFileSync(mcpFile, "utf-8"));
  } catch {
    config = {};
  }
}
if (!config.mcpServers) {
  config.mcpServers = {};
}
config.mcpServers.trayce = trayceEntry;

// Ensure directory exists for global config
if (scope === "global") {
  mkdirSync(dirname(mcpFile), { recursive: true });
}

writeFileSync(mcpFile, `${JSON.stringify(config, null, 2)}\n`);

// Write OTEL env vars to .claude/settings.local.json
const settingsDir = scope === "global"
  ? join(homedir(), ".claude")
  : ".claude";
const settingsFile = join(settingsDir, "settings.local.json");

let settings: Record<string, any> = {};
if (existsSync(settingsFile)) {
  try {
    settings = JSON.parse(readFileSync(settingsFile, "utf-8"));
  } catch {
    settings = {};
  }
}

if (!settings.env) settings.env = {};
settings.env.CLAUDE_CODE_ENABLE_TELEMETRY = "1";
settings.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:9740/otlp";
settings.env.OTEL_METRICS_EXPORTER = "otlp";
settings.env.OTEL_LOGS_EXPORTER = "otlp";
settings.env.OTEL_METRIC_EXPORT_INTERVAL = "10000";

mkdirSync(settingsDir, { recursive: true });
writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
console.log(`OTEL telemetry configured in ${settingsFile}`);

console.log();
console.log(`Trayce configured in ${mcpFile}`);
if (scope === "global") {
  console.log("  Label: (dynamic - based on project directory)");
} else {
  console.log(`  Label: ${label}`);
}
console.log(`  Bridge: ${bridgePath}`);
console.log();
console.log("Next steps:");
console.log();
console.log("  1. Start the trayce server (if not already running):");
console.log(`     cd ${projectRoot} && bun run scripts/start.ts`);
console.log();
console.log("  2. Launch Claude Code with the channel flag:");
console.log("     claude --dangerously-load-development-channels server:trayce");
console.log();
console.log("  3. Open the trayce canvas in your browser (URL printed by start.ts)");
console.log();
console.log("  4. Draw and submit - Claude will see your sketches!");
