---
name: trayce-setup
description: >
  Use when the user asks to "set up trayce", "install trayce", "configure
  trayce", "remove trayce", or "uninstall trayce". Handles both installation
  (writing the MCP config into `.mcp.json` or `~/.claude.json`) and
  uninstallation. Prompts for scope (single project vs. all projects / global)
  when the user hasn't specified.
invocable_by:
  - user
---

# Trayce Setup

Configure the trayce MCP bridge for Claude Code, or remove it. This skill does
NOT start the server — after configuring, route the user to `trayce-start`.

## Decide the operation

Detect intent from the user's phrasing:

- "remove", "uninstall", "delete" → uninstall flow
- "set up", "install", "configure", "add" → install flow

If ambiguous, ask.

## Determine scope

If the user hasn't specified scope explicitly ("for this project" vs. "globally"
or "for all my projects"), ask using AskUserQuestion with two options:

- **This project only** — writes `.mcp.json` in the current project directory.
  Label is inferred from the project directory name.
- **All my projects (global)** — writes `~/.claude.json`. No fixed label; each
  session auto-labels from its cwd at runtime.

Map to flags: project scope = no flag, global = `--global`.

## Install flow

Run the setup script with the chosen scope. The script is idempotent — it
merges into existing MCP config without clobbering other servers.

```bash
# Project scope (default)
bun run ${CLAUDE_PLUGIN_ROOT}/../scripts/setup.ts --label "$(basename "$(pwd)")"

# Global scope
bun run ${CLAUDE_PLUGIN_ROOT}/../scripts/setup.ts --global
```

## Uninstall flow

Ask for scope the same way as install (project vs. global) — trayce may be
registered in either, and the user might want to remove only one.

```bash
# Project scope
bun run ${CLAUDE_PLUGIN_ROOT}/../scripts/setup.ts --uninstall

# Global scope
bun run ${CLAUDE_PLUGIN_ROOT}/../scripts/setup.ts --global --uninstall
```

## Tell the user (install)

1. Confirm where the config was written (quote the path the script printed).
2. Tell them to restart Claude Code with:
   `claude --dangerously-load-development-channels server:trayce`
3. Point to the next step: "To start the canvas server, ask me to start trayce
   (that uses the `trayce-start` skill)."

Do NOT invoke `trayce-start` or run `start.ts` inline — starting is a separate,
explicit user action.

## Tell the user (uninstall)

Confirm removal, then tell them they can re-register anytime by asking "set up
trayce" again.
