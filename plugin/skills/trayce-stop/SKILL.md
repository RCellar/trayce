---
name: trayce-stop
description: >
  Use when the user asks to "stop trayce", "shut down trayce", "kill trayce",
  or "stop the canvas server".
invocable_by:
  - user
---

# Stop Trayce

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/../scripts/stop.ts
```

Confirm the server has stopped. The browser canvas disconnects automatically.
Works on Linux, macOS, and Windows.

To restart later, ask to start trayce (that routes to `trayce-start`). To check
status without stopping or starting, route to `trayce-status`.
