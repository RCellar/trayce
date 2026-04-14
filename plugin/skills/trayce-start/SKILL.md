---
name: trayce-start
description: >
  Use when the user asks to "start trayce", "launch trayce", "run the canvas
  server", "start the canvas", or otherwise bring the trayce canvas server up.
  Use this skill after trayce has been configured via `trayce-setup` — not for
  first-time installation.
invocable_by:
  - user
---

# Start Trayce

Bring the trayce canvas server online. This skill assumes the MCP bridge is
already configured (via the `trayce-setup` skill). If it isn't, route the user
to `trayce-setup` first instead of proceeding.

## Pre-check (MCP config installed?)

Confirm trayce is registered in either the project's `.mcp.json` or the user's
`~/.claude.json` before starting. If neither has a `trayce` entry, tell the user
to run `trayce-setup` first and stop.

```bash
PROJECT_CFG=".mcp.json"
GLOBAL_CFG="$HOME/.claude.json"
if [ -f "$PROJECT_CFG" ] && grep -q '"trayce"' "$PROJECT_CFG" 2>/dev/null; then :
elif [ -f "$GLOBAL_CFG" ] && grep -q '"trayce"' "$GLOBAL_CFG" 2>/dev/null; then :
else
  echo "NOT CONFIGURED — run trayce-setup first"
fi
```

## Start the server

Invoke the cross-platform start script. It reuses an existing server if one is
already running at the expected state file.

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/../scripts/start.ts
```

The script emits a single JSON line on stdout:

- `{"status":"new","url":"…","pid":N}` — server was launched
- `{"status":"existing","url":"…","pid":N}` — a server was already running; URL
  and PID are reported as-is
- `{"status":"error","message":"…"}` on stderr with non-zero exit — the server
  failed to start; check `/tmp/trayce/server.log` (or `%TEMP%\trayce\server.log`
  on Windows)

## Tell the user

1. Quote the exact URL from the JSON. The URL already embeds the auth token; no
   extra copy/paste needed.
2. Tell them to open the URL in a browser. The canvas should load and show
   their connected sessions.
3. If Claude Code isn't already running with the channel flag, remind them to
   launch it with:
   `claude --dangerously-load-development-channels server:trayce`

To stop the server later, route to `trayce-stop`. To check whether it's running
without starting it, route to `trayce-status`.
