/**
 * Cross-platform bridge setup script (replaces setup-bridge.sh for Windows compatibility).
 * Configures Claude Code to connect to a trayce server.
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
let host = "localhost";
let port = "9740";
let token = "";

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
    case "--host":
      host = args[++i] ?? "localhost";
      break;
    case "--port":
      port = args[++i] ?? "9740";
      break;
    case "--token":
      token = args[++i] ?? "";
      break;
    case "-h":
    case "--help":
      console.log(`Usage: bun run scripts/setup-bridge.ts [OPTIONS]

Configure Claude Code to connect to a trayce server.

Options:
  --host HOST     Server host (default: localhost)
  --port PORT     Server port (default: 9740)
  --token TOKEN   Auth token (default: none - no auth)
  --label NAME    Session label in trayce dropdown (default: directory name)
  --global        Install to ~/.claude.json instead of project .mcp.json
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
  process.exit(0);
}

// Check prerequisites
const bunBin = process.execPath;

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

// Default label
if (!label) {
  label = basename(process.cwd());
}

// Build env object
const env: Record<string, string> = {
  TRAYCE_HOST: host,
  TRAYCE_PORT: port,
};
if (token) env.TRAYCE_TOKEN = token;
if (label) env.TRAYCE_LABEL = label;

// Build MCP entry
const trayceEntry = {
  command: bunBin,
  args: ["run", bridgePath],
  env,
};

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

console.log();
console.log(`trayce bridge configured in ${mcpFile}`);
console.log(`  Server: ${host}:${port}`);
console.log(`  Auth:   ${token ? "token-based" : "none"}`);
if (scope === "global") {
  console.log("  Label:  (dynamic - based on project directory)");
} else {
  console.log(`  Label:  ${label}`);
}
console.log();
console.log("Next: launch Claude Code with:");
console.log("  claude --dangerously-load-development-channels server:trayce");
