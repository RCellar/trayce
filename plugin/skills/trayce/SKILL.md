---
name: trayce
description: >
  Use when the user wants to draw, sketch, or send visual content to this conversation
  via the trayce canvas. Also use when asked to push, send, or place images on a canvas.
  Triggers on mentions of drawing, sketching, canvas, visual, trayce, or pushing images.
invocable_by:
  - user
---

# Trayce — Canvas Drawing Tool

Browser canvas connected to this Claude Code session via MCP Channels. Users draw sketches and submit them with optional prompt text. You can push images back to their canvas.

## Receiving Sketches

Submissions arrive as channel notifications. **Read the PNG with the Read tool** — it's a file path, not inline data.

```xml
<channel source="trayce" image_path="/tmp/trayce/submissions/sub-1234.png">
  User's prompt text
</channel>
```

## Pushing Images to the Canvas

Use `mcp__trayce__push_image`. Always prefer `file_path` — it avoids context window limits.

```
push_image(file_path: "/tmp/trayce/diagram.png", label: "Architecture")
```

| Param | Usage |
|---|---|
| `file_path` | Absolute path to PNG/JPEG on disk. **Always use this.** |
| `image_base64` | Only for tiny inline data (<50KB). Avoid. |
| `label` | Layer name in the canvas UI. Optional. |

Images arrive as hidden, movable/resizable transform layers.

**Workflow:** Save image to disk first (e.g., download with curl, generate with a tool), then push via `file_path`.

## Server

| Action | Command |
|---|---|
| Status | `cat /tmp/trayce/state.json` |
| Start | `bash ${CLAUDE_PLUGIN_ROOT}/../scripts/start.sh` |
| Stop | `bash ${CLAUDE_PLUGIN_ROOT}/../scripts/stop.sh` |
