---
name: trayce-status
description: >
  Use when the user asks "is trayce running", "trayce status", "check trayce",
  "what's trayce doing", or otherwise wants to know whether the trayce canvas
  server is currently up without starting or stopping it.
invocable_by:
  - user
---

# Trayce Status

Report whether the trayce canvas server is currently running. This skill is
non-mutating — it does not start, stop, or restart anything.

## Run the status check

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/../scripts/status.ts
```

The script emits a single JSON line on stdout and exits 0 in all non-error
cases so the output is always parseable.

## Interpret the output

**Running:**
```json
{"running":true,"pid":12345,"port":9740,"url":"http://localhost:9740?token=…","token":"…"}
```
Report the URL, PID, and port to the user. The URL already embeds the auth
token. If they want to open the canvas, they can paste the URL into a browser.

**Not running — state file missing:**
```json
{"running":false,"reason":"no state file"}
```
Tell the user trayce is not running. If they want to start it, route to
`trayce-start`. If they've never configured trayce, route to `trayce-setup`
first.

**Not running — stale state:**
```json
{"running":false,"reason":"stale state — pid 12345 not alive"}
```
The server crashed or was killed outside of `trayce-stop`. Tell the user the
state file is stale and suggest `trayce-start` to launch a fresh instance —
the start script will clean up the stale state file automatically.

**Other `running:false` reasons** (`"corrupt state file"`, `"no pid in state
file"`, `"jq not installed"` from the .sh variant): relay the reason verbatim
and suggest `trayce-start` which recreates a clean state file.
