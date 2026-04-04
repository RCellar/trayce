---
name: trayce-setup
description: >
  Use when the user wants to set up, configure, or install trayce for their project.
invocable_by:
  - user
---

# Trayce Setup

## Check Current State

```bash
cat .mcp.json 2>/dev/null | grep -q trayce && echo "CONFIGURED" || echo "NOT CONFIGURED"
cat /tmp/trayce/state.json 2>/dev/null || echo "SERVER NOT RUNNING"
```

## Configure (if needed)

```bash
bash ${CLAUDE_PLUGIN_ROOT}/../scripts/setup.sh --label "$(basename "$(pwd)")"
```

For all projects: add `--global`. To remove: add `--uninstall`.

## Start Server (if needed)

```bash
bash ${CLAUDE_PLUGIN_ROOT}/../scripts/start.sh
```

## Tell the User

1. Open the canvas URL from state.json (includes auth token)
2. Restart Claude Code with: `claude --dangerously-load-development-channels server:trayce`
