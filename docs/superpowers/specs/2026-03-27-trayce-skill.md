# Trayce Skill — Claude Code Plugin for Canvas Interaction

**Date:** 2026-03-27
**Status:** Design

## Overview

Create a Claude Code skill (plugin) that teaches Claude how to use the trayce canvas system. The skill provides instructions for receiving sketches, pushing images, understanding the transcript/response mechanism, and managing the server lifecycle. It packages trayce's MCP integration, channel protocol, and canvas interaction patterns into a discoverable, auto-triggering skill.

## Current State

Trayce works today but relies on:
- Manual MCP setup via `scripts/setup.sh` or editing `.mcp.json`
- The bridge's `instructions` string (one sentence, minimal)
- User knowledge of `--dangerously-load-development-channels server:trayce`
- No skill or plugin packaging — Claude only knows about trayce through channel notifications and the `push_image` tool, with no broader context about the system

## Goals

- Package trayce as a Claude Code plugin with a skill that auto-triggers on canvas/sketch/visual references
- Provide Claude with complete understanding of the trayce architecture so it can explain it to users
- Document the `push_image` tool usage (file_path preferred over inline base64)
- Document how incoming channel submissions work (PNG path + prompt)
- Include server start/stop lifecycle management
- Optionally provide a setup skill for first-time configuration

## Non-Goals

- Replacing the MCP bridge — the skill complements it, doesn't replace it
- Auto-starting the server — the skill instructs Claude how to, but doesn't run on session start
- Bundling the trayce codebase into the plugin — the skill references the installed trayce location

## Plugin Structure

```
trayce-plugin/
  .claude-plugin/
    plugin.json
  skills/
    trayce/
      SKILL.md              # Main skill — canvas interaction
    trayce-setup/
      SKILL.md              # Setup skill — first-time configuration
    trayce-stop/
      SKILL.md              # Stop skill — server shutdown
```

## Skill Definitions

### Main Skill: `trayce`

**Triggers on:** canvas, sketch, drawing, visual, trayce, push image, send image to canvas, submit sketch

**SKILL.md frontmatter:**
```yaml
---
name: trayce
description: >
  Use when the user wants to draw diagrams, annotate screenshots, sketch architecture,
  or send visual content to this conversation via the trayce canvas. Also use when the
  user asks you to push, send, or place images on a canvas. Triggers on mentions of
  drawing, sketching, canvas, visual, trayce, or pushing images to the canvas.
invocable_by:
  - user
---
```

**SKILL.md body — what Claude learns:**

1. **What trayce is** — A browser-based canvas drawing tool that connects to Claude Code sessions via MCP Channels. Users draw sketches in a browser and submit them with optional prompt text. Claude can also push images back to the canvas.

2. **Receiving submissions** — When a user submits a sketch from the trayce canvas, Claude receives a channel notification containing:
   - `image_path`: Absolute path to a PNG file on disk (e.g., `/tmp/trayce/submissions/sub-1234.png`)
   - Prompt text from the user
   - Claude should use the Read tool on the `image_path` to view the sketch

3. **Pushing images to the canvas** — Use the `mcp__trayce__push_image` tool:
   - **Preferred:** `file_path` parameter with an absolute path to a PNG/JPEG on disk. The bridge reads the file directly — no context window limitations.
   - **Alternative:** `image_base64` for small inline images (under ~50KB).
   - **Label:** Optional `label` parameter names the layer in the canvas UI.
   - Images arrive as hidden layers — the user toggles visibility in the layers panel.
   - Images arrive as transform layers — the user can move and resize them.

4. **Server lifecycle:**
   - Start: `bash /path/to/trayce/scripts/start.sh` (daemonized, prints URL with auth token)
   - Stop: `bash /path/to/trayce/scripts/stop.sh`
   - Status: Check `/tmp/trayce/state.json` for PID, port, token
   - Dev mode: `bun run dev` (foreground with hot reload)

5. **Architecture context:**
   - Three processes: Server (Bun HTTP+WS), Bridge (MCP, per Claude session), Client (browser)
   - PNGs are passed by file path, not inline — Claude reads them with the Read tool
   - The bridge connects to the server via WebSocket and registers with a session ID and label
   - Multiple Claude sessions can be connected simultaneously; the browser selects which to target

6. **Transcript and usage:**
   - The bridge watches Claude's JSONL transcript file and streams live data to the browser
   - The browser shows a Transcript tab (tool calls, responses), Response tab (assistant text), and Usage tab (token counts, costs)
   - This is automatic and requires no action from Claude

### Setup Skill: `trayce-setup`

**Triggers on:** set up trayce, configure trayce, install trayce

**SKILL.md body — what Claude does:**

1. Check if trayce is already configured:
   - Look for `trayce` in `.mcp.json` or `~/.claude.json`
   - Check if `/tmp/trayce/state.json` exists (server running)

2. If not configured, run setup:
   ```bash
   bash /path/to/trayce/scripts/setup.sh --label <project-name>
   ```

3. Start the server if not running:
   ```bash
   bash /path/to/trayce/scripts/start.sh
   ```

4. Tell the user:
   - The canvas URL (from state.json)
   - To restart Claude with: `claude --dangerously-load-development-channels server:trayce`
   - How to open the canvas in a browser

### Stop Skill: `trayce-stop`

**Triggers on:** stop trayce, shut down trayce, close canvas

**SKILL.md body:**
```bash
bash /path/to/trayce/scripts/stop.sh
```

## Plugin Metadata

**plugin.json:**
```json
{
  "name": "trayce",
  "description": "Canvas drawing tool for Claude Code — send and receive sketches via MCP Channels",
  "version": "1.0.0",
  "author": { "name": "RCellar" },
  "repository": "https://github.com/RCellar/trayce",
  "license": "MIT",
  "keywords": ["skills", "canvas", "visual", "drawing", "sketch", "mcp"]
}
```

## Key Details for the Skill Body

### Channel Notification Format (Incoming Submission)

When a user submits from the browser, Claude receives:
```xml
<channel source="trayce" submission_id="sub-1234" image_path="/tmp/trayce/submissions/sub-1234.png">
  User's prompt text here
</channel>
```

Claude should:
1. Read the image at the `image_path` using the Read tool
2. Treat the text as the user's request about or relating to the sketch
3. Respond based on the visual content + prompt

### push_image Tool Reference

```
Tool: mcp__trayce__push_image

Parameters:
  file_path (string, optional): Absolute path to image on disk. Preferred for all images.
  image_base64 (string, optional): Base64-encoded image data. Use only for tiny images.
  label (string, optional): Layer name in the canvas UI. Defaults to "Claude: HH:MM:SS".

Constraints:
  - Image must be under 20MB
  - Either file_path or image_base64 must be provided
  - Images arrive as hidden transform layers (user toggles visibility, can move/resize)

Example:
  push_image(file_path: "/tmp/output/diagram.png", label: "Architecture Diagram")
```

### WebSocket Message Types (Reference)

| Type | Direction | Purpose |
|---|---|---|
| `register` | bridge->server | Bridge announces session ID and label |
| `submit` | browser->server | User submits sketch + prompt |
| `submission` | server->bridge | Server routes submission to target bridge |
| `sessions` | server->browser | Broadcasts connected session list |
| `canvas-push` | bridge->server->browser | Claude pushes image to canvas |
| `permission-request` | bridge->server->browser | Claude requests user permission |
| `permission-verdict` | browser->server->bridge | User responds to permission request |
| `transcript-entry` | bridge->server->browser | Live transcript data |
| `response` | bridge->server->browser | Assistant response text |
| `usage-update` | bridge->server->browser | Token usage data |
| `watch-session` | browser->server | Browser selects which session to monitor |

## Implementation

### Files to Create

| File | Purpose |
|---|---|
| `plugin/.claude-plugin/plugin.json` | Plugin metadata |
| `plugin/skills/trayce/SKILL.md` | Main skill — canvas interaction instructions |
| `plugin/skills/trayce-setup/SKILL.md` | Setup skill — first-time configuration |
| `plugin/skills/trayce-stop/SKILL.md` | Stop skill — server shutdown |

### Path Resolution

The skills need to reference the trayce installation path. Options:
1. **Hardcoded path** — Simplest, works for single-machine installs. The skill body uses the absolute path to the trayce project.
2. **Environment variable** — `TRAYCE_ROOT` env var set in the shell profile. Skills reference `$TRAYCE_ROOT`.
3. **Relative to plugin** — If the plugin is inside the trayce repo, use `${CLAUDE_PLUGIN_ROOT}/../..` to resolve paths.

Option 3 is cleanest: place the plugin directory inside the trayce repo at `plugin/`, so the skill can reference scripts relative to the plugin root.

### Installation

Users install the plugin by adding to `~/.claude/settings.json`:
```json
{
  "enabledPlugins": {
    "trayce@local": true
  }
}
```

Or via a marketplace if published.

## How to Verify

1. Install the plugin and start a new Claude Code session
2. Say "set up trayce" — the setup skill should trigger and configure the MCP server
3. Restart with the channel flag
4. Say "open the canvas" — the main skill should trigger and explain how
5. Submit a sketch from the browser — Claude should know to read the PNG and respond
6. Say "push this image to the canvas" — Claude should use `push_image` with `file_path`
7. Say "stop trayce" — the stop skill should trigger and shut down the server
8. Verify the skill does NOT trigger on unrelated requests
