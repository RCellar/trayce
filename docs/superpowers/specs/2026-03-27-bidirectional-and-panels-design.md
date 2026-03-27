# Trayce Enhancements — Bidirectional Communication, Response View, and Transcript Panel

**Date:** 2026-03-27
**Status:** Design approved, pending implementation

## Overview

Three interconnected enhancements to Trayce that make the bridge bidirectional and add two new views to the browser client:

1. **Bidirectional communication** — Claude sessions can send images back to the canvas through the existing MCP channel, not just receive submissions.
2. **Response view** — A side panel tab showing Claude's response text with rendered markdown, so users can read Claude's output without switching to the CLI.
3. **Transcript panel** — A side panel tab showing the running conversation transcript for the connected session, with collapsible tool call summaries.

All three features flow through the same architectural change: making the bridge a two-way conduit between Claude Code and the Trayce server.

## Goals

- Enable Claude to push images onto the canvas as hidden layers via MCP notifications
- Show Claude's markdown responses in a readable browser panel alongside the canvas
- Display the full session transcript with curated tool call summaries
- Keep the canvas always visible — new views live in a resizable side panel
- Graceful degradation — if transcript file isn't found, canvas and submissions work as before

## Non-Goals

- Full CLI fidelity (spinners, permission prompts, tool call chrome) — response view renders markdown, not a CLI replica
- Structured drawing commands from Claude (shapes, text, annotations) — only image push for now; extensible later via the same channel
- Real-time streaming of partial assistant responses — entries arrive when transcript lines are written (near-real-time, not token-by-token)
- Replacing HappyTrails — the transcript tab is a lightweight companion view, not a full activity monitor

## Constraints

- **Transcript file access:** The bridge must be able to read Claude Code's native transcript JSONL from the filesystem. This works for local installs; containerized bridges would need a volume mount.
- **Image push size:** Same 20 MB cap as submissions. Images larger than canvas resolution are scaled down to fit.
- **Markdown rendering:** Lightweight inline renderer (~200 lines) covering headings, code blocks, inline code, bold/italic, lists, and links. No external dependency.

---

## Architecture

### Approach: Bridge-Centric Bidirectional

The bridge already connects to the Trayce server (WebSocket) and Claude Code (MCP stdio). Rather than adding new processes, the bridge itself becomes bidirectional:

```
                    ┌─────────────────────────┐
                    │      TRAYCE SERVER       │
                    │                          │
                    │  Existing:               │
                    │    submit → save → route │
                    │    sessions broadcast    │
                    │                          │
                    │  New:                    │
                    │    route transcript      │
                    │    route responses       │
                    │    route canvas-push     │
                    └────────┬───┬─────────────┘
                             │   │
              ┌──────────────┘   └──────────────┐
              │                                  │
     /canvas WebSocket                  /bridge WebSocket
              │                           (now bidirectional)
              │                                  │
    ┌─────────┴─────────┐            ┌───────────┴───────────┐
    │   BROWSER CLIENT  │            │       BRIDGE          │
    │                   │            │                       │
    │  Canvas (existing)│            │  Existing:            │
    │  Side Panel (new) │            │    register, forward  │
    │    Response tab   │            │    submissions→MCP    │
    │    Transcript tab │            │                       │
    │  Canvas push      │            │  New:                 │
    │    handler (new)  │            │    Watch transcript   │
    │                   │            │    Receive MCP notif  │
    │                   │            │    Forward to server   │
    └───────────────────┘            └───────────┬───────────┘
                                                 │
                                           MCP stdio
                                                 │
                                     ┌───────────┴───────────┐
                                     │     CLAUDE CODE       │
                                     │                       │
                                     │  Existing:            │
                                     │    Reads PNG from     │
                                     │    submission path    │
                                     │                       │
                                     │  New:                 │
                                     │    Sends images via   │
                                     │    MCP notification   │
                                     └───────────────────────┘
```

### Why Bridge-Centric

- The bridge already sits at the junction of both systems (MCP + WebSocket)
- It has session context (label, cwd) and can discover the transcript file
- No new processes, no new connection topology
- Bridge grows from ~100 to ~300 lines — manageable

---

## New WebSocket Message Types

### Bridge → Server

| Type | Payload | Trigger |
|------|---------|---------|
| `transcript-entry` | `{ entry: { role, content, toolCall?, timestamp } }` | New line detected in transcript JSONL |
| `response` | `{ content: string, format: "markdown", final: boolean }` | Assistant message extracted from transcript |
| `canvas-push` | `{ image: string (base64), label: string, visible: boolean }` | Claude sends image via MCP notification |

### Server → Browser

| Type | Payload | Purpose |
|------|---------|---------|
| `transcript-entry` | `{ sessionId, entry }` | Routed to transcript tab |
| `response` | `{ sessionId, content, format, final }` | Routed to response tab |
| `canvas-push` | `{ sessionId, image, label, visible }` | Creates hidden layer on canvas |

The server is a pass-through for these new message types — it routes bridge messages to browsers viewing that session. No business logic added to the server beyond routing.

---

## Bridge: Transcript Watcher

New module within the bridge (~80-100 lines). Activated after the bridge connects to the server.

### Transcript Discovery

The bridge finds Claude Code's transcript file by:

1. Checking `CLAUDE_TRANSCRIPT` env var (explicit override — absolute path to a specific transcript JSONL)
2. Reading `~/.claude/projects.json` (or equivalent) to find the project entry matching the bridge's `cwd`, then resolving the transcript path from that entry
3. Falling back to the most recently modified `~/.claude/projects/*/transcript.jsonl` whose directory name contains a path hash matching `cwd`

If not found by any method, the watcher is not started. The bridge sends a `transcript-status` message (`{ available: false }`) so the browser can show "No transcript available" in both tabs. The canvas and submission flow are unaffected.

### File Watching

- `fs.watch()` on the transcript file's parent directory + 2-second polling fallback (same hybrid approach as HappyTrails, works cross-platform)
- Maintains a byte offset; reads only new lines
- Read-only — never modifies the transcript file

### Entry Classification

Each transcript JSONL line is a conversation turn. The watcher parses and classifies:

| Content Block Type | Output |
|---|---|
| `text` in assistant message | `response` message with markdown content, `final: true` when turn is complete |
| `text` in user message | `transcript-entry` with role "user" |
| `tool_use` in assistant message | `transcript-entry` with tool call summary (name + truncated input) |
| `tool_result` in user message | Paired back to its `tool_use` by ID, updates the summary with status |

---

## Bridge: Canvas Push (Reverse Channel)

### MCP Notification Handler

The bridge registers a handler for incoming `notifications/claude/channel` from Claude Code. The MCP SDK supports bidirectional notifications — the bridge already sends them for submissions; now it also receives them.

Incoming notification payload:

```json
{
  "content": "Here's the mockup",
  "meta": {
    "type": "canvas-push",
    "image": "<base64 PNG>",
    "label": "Mockup v1"
  }
}
```

The `meta.type` field distinguishes canvas pushes from other potential future message types through the same channel.

### Processing

1. Validate image size (≤ 20 MB)
2. Forward as `canvas-push` WebSocket message to server
3. Server routes to browsers viewing this session

---

## Client: Side Panel

### Layout

A resizable right panel that opens alongside the canvas. The canvas remains visible at all times.

```
┌──────────────────────────────────────────────────────────────┐
│  trayce            Session: [dropdown]  [Submit]              │
├──────┬───────────────────────────┬───────────────────────────┤
│ [B]  │                           │ [Response] [Transcript]   │
│ [P]  │                           ├───────────────────────────┤
│ [M]  │      Canvas Area          │                           │
│ [W]  │   (always visible)        │  Tab content area         │
│ [H]  │                           │  (auto-scroll, rendered   │
│ [E]  │                           │   markdown or transcript) │
│      │                           │                           │
│ ───  │                           │                           │
│ [💬] │                           │                           │
│ [📜] │                           │                           │
└──────┴───────────────────────────┴───────────────────────────┘
```

### Panel Behavior

- **Toggle:** Toolbar icons at the bottom of the left toolbar (below a separator). Click to open panel with that tab active. Click the same icon again to collapse.
- **Tab switching:** Click tabs at the top of the panel, or click the other toolbar icon.
- **Resize:** Drag the panel's left border. Min width 240px, max 50% of viewport.
- **Brush settings relocation:** When panel is open, brush settings and layers panel move into a collapsible section at the top of the side panel, above the tab content. Canvas controls remain accessible while reading Claude's output.
- **Session-scoped:** Panel content updates when the session dropdown changes. Each session's data is kept in memory so switching is instant.
- **Auto-scroll:** Both tabs auto-scroll to latest content. Manual scrolling pauses auto-scroll (resumes when scrolled back to bottom).

### New Client Modules

| Module | Purpose |
|---|---|
| `client/side-panel.ts` | Panel container: open/close, resize, tab switching, brush settings relocation |
| `client/response-tab.ts` | Response tab: renders assistant markdown messages, shows canvas-push inline notifications |
| `client/transcript-tab.ts` | Transcript tab: renders conversation turns with collapsible tool calls |
| `client/markdown.ts` | Lightweight markdown → HTML renderer (~200 lines) |

---

## Client: Response Tab

Displays Claude's assistant messages as rendered markdown. Content arrives via `response` WebSocket messages.

### Rendering

- Each assistant message is a block with a "Claude" label and rendered markdown content
- Markdown support: headings, code blocks (with syntax class for future highlighting), inline code, bold, italic, lists, links
- Code blocks display in a monospace container with a language label

### Canvas Push Notifications

When a `canvas-push` message arrives:
- An inline notification appears in the response stream: "[Image received] — added as hidden layer '{label}'"
- Small thumbnail preview of the pushed image
- Badge indicator on the Response tab (if not currently active)

---

## Client: Transcript Tab

Displays the full session conversation with curated tool call detail. Content arrives via `transcript-entry` WebSocket messages.

### Entry Rendering

| Entry Type | Display |
|---|---|
| User message | Block with "You" label, plain text content |
| Assistant message | Block with "Claude" label, rendered markdown |
| Tool call | Collapsed single line: icon + tool name + short description (e.g. "Read server/index.ts", "Bash: bun test") |
| Tool result | Folded into parent tool call. Expand to see output, truncated at ~100 lines with "Show all" button |

### Interaction

- Click a tool call line to expand/collapse its detail (input + output)
- Tool calls show a status indicator (success/failure)
- Tool results that are paired to their `tool_use` by ID display nested under the call

---

## Client: Canvas Push Handler

When the browser receives a `canvas-push` message:

1. Create a new layer named from `label` (or "Claude: {HH:MM:SS}" if no label provided)
2. Decode base64 image data
3. If image exceeds canvas resolution, scale down to fit
4. Draw onto the new layer's canvas context
5. Set layer visibility to **hidden** (toggled off)
6. Update the layers panel to show the new layer
7. Show inline notification in the Response tab

The user toggles the layer visible when they want to see Claude's image. This keeps the canvas under user control while ensuring nothing is lost.

---

## Data Flow Summary

### Existing (unchanged)

```
Browser → submit (base64 PNG) → Server saves PNG → Server routes to Bridge →
Bridge sends MCP notification → Claude reads PNG from disk
```

### New: Transcript + Response

```
Claude writes transcript JSONL → Bridge watches file → Bridge classifies entries →
Bridge sends transcript-entry/response over WS → Server routes to browsers →
Browser renders in side panel tabs
```

### New: Canvas Push

```
Claude sends MCP notification (with image) → Bridge receives → Bridge validates →
Bridge sends canvas-push over WS → Server routes to browsers →
Browser creates hidden layer + shows inline notification
```

---

## Testing Strategy

### Bridge Tests

- Transcript watcher: mock filesystem, verify entry classification and message emission
- Canvas push handler: mock MCP notification, verify forwarding with size validation
- Graceful degradation: verify bridge works normally when transcript not found

### Server Tests

- New message routing: verify `transcript-entry`, `response`, `canvas-push` are forwarded only to browsers viewing the correct session
- Message validation: reject malformed new message types

### Client Tests

- Side panel: open/close, resize, tab switching, brush settings relocation
- Response tab: markdown rendering, canvas-push inline notifications
- Transcript tab: entry rendering, tool call expand/collapse, tool result pairing
- Canvas push handler: layer creation, hidden by default, image scaling
- Markdown renderer: unit tests for each supported element

### E2E Tests

- Full round-trip: Claude pushes image → appears as hidden layer in browser
- Transcript flow: bridge watches file → entries appear in transcript tab
- Session switching: panel content updates when session dropdown changes
