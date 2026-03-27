# Trayce UI Redesign Spec

## Overview

Three UI changes to improve canvas space efficiency, match modern chat UX conventions, and add visual customization.

## 1. Floating Tabbed Panel (Brush + Layers)

### Problem
The fixed 200px `#right-panel` column permanently consumes canvas space even when brush/layer controls aren't being used.

### Solution
Replace the fixed panel with a single floating tabbed window that overlays the canvas.

### Behavior
- **Tabs:** "Brush" and "Layers" in a tab bar that doubles as a drag handle.
- **Default state on load:** Brush tab open, positioned top-right of `#canvas-container` (~20px from top and right edges).
- **Draggable:** User can drag the tab bar to reposition anywhere within the canvas container. Position is clamped to stay within the canvas bounds.
- **Collapsible:** Clicking the close button (x in tab bar) hides the entire window. A toolbar button re-opens it.
- **Persistence:** Position and open/closed state saved to localStorage. Restored on reload.
- **Appearance:** `background: rgba(26, 26, 46, 0.92)` (semi-transparent surface), `border: 1px solid var(--border)`, `border-radius: 8px`, `box-shadow: 0 4px 16px rgba(0,0,0,0.4)`. Width fixed at 280px.
- **Z-index:** Above the canvas content but below modal dialogs.

### Tab Content
- **Brush tab:** Contains the 4 sliders (size, opacity, flow, smoothing) currently rendered by `BrushSettingsUI`. The color picker also moves into this tab at the bottom.
- **Layers tab:** Contains the layer list currently rendered by `LayersUI`, including add/delete/visibility controls.

### Layout Changes
- Remove `#right-panel` from the HTML and CSS grid.
- The `#main` grid changes from `var(--toolbar-width) 1fr var(--panel-width) auto` to `var(--toolbar-width) 1fr auto`.
- Remove the `--panel-width` CSS variable.
- The existing toolbar "Brush/Layers" toggle (if any) becomes the show/hide toggle for the floating panel. If no toggle exists, add one to the toolbar.

### Files Affected
- Create: `client/floating-panel.ts` — new `FloatingPanel` class handling drag, tabs, collapse, localStorage persistence
- Modify: `client/app.ts` — instantiate FloatingPanel, mount BrushSettingsUI and LayersUI inside it instead of #right-panel
- Modify: `client/index.html` — remove `#right-panel`, remove `#brush-settings` and `#layers-panel` divs (FloatingPanel creates its own DOM)
- Modify: `client/style.css` — remove #right-panel styles, add floating panel styles, update grid layout
- Modify: `client/toolbar.ts` — add panel toggle button if not present

## 2. Two-Row Submit Bar

### Problem
The submit button is in the top bar, separated from the prompt input in the bottom bar. This doesn't match the chat-style mental model of "type then send."

### Solution
Restructure the bottom bar into two rows: status/session on top, prompt+send on bottom.

### Layout
```
Row 1: [status dot + "Connected"] .............. [session dropdown v]
Row 2: [prompt input text field                              [Send]]
```

- **Row 1:** Connection status (left-aligned), session selector (right-aligned). Both small (11-12px font).
- **Row 2:** A container with rounded corners (`border-radius: 8px`) holding the text input (flex: 1) and the Send button flush on the right. The Send button uses `var(--accent)` background.
- **Bottom bar height:** Increases from 36px to approximately 64px (two rows with padding).
- **Ctrl+Enter shortcut** continues to work for submit.

### What Moves
- Submit button moves from `#top-bar` to inside the prompt container in `#bottom-bar`.
- Tool info and layer info text (currently in bottom bar right section) move to `#top-bar` alongside canvas info, since the bottom bar is now dedicated to the chat input.

### Files Affected
- Modify: `client/index.html` — restructure `#bottom-bar` into two rows, move submit button
- Modify: `client/style.css` — new bottom bar layout styles, increase height, prompt container styling
- Modify: `client/app.ts` — update DOM element references for moved elements

## 3. Theme System (Gear Popover)

### Problem
No way to customize the visual appearance. The dark blue theme is hardcoded.

### Solution
A gear icon in the top bar that opens a popover with theme, accent, and font controls. All styling is driven by CSS custom properties, so changing them updates the entire UI instantly.

### Theme Presets

Four base themes, each defining these CSS variables:

| Variable | Dark (default) | Light | Midnight | Warm |
|----------|---------------|-------|----------|------|
| `--bg` | `#111` | `#f5f5f5` | `#0d1117` | `#1c1410` |
| `--surface` | `#1a1a2e` | `#ffffff` | `#161b22` | `#2a1f1a` |
| `--border` | `#333` | `#d0d7de` | `#30363d` | `#3d2e24` |
| `--text` | `#c9d1d9` | `#1f2328` | `#c9d1d9` | `#d4c5b5` |
| `--text-muted` | `#8b949e` | `#656d76` | `#8b949e` | `#9a8a7a` |
| `--canvas-bg` | `#222` | `#e8e8e8` | `#1a1a1a` | `#251c15` |

### Accent Colors

Six accent swatches that override `--accent` and `--accent-dim`:

| Name | `--accent` | `--accent-dim` |
|------|-----------|----------------|
| Blue (default) | `#4a9eff` | `rgba(74, 158, 255, 0.15)` |
| Orange | `#f78166` | `rgba(247, 129, 102, 0.15)` |
| Green | `#3fb950` | `rgba(63, 185, 80, 0.15)` |
| Purple | `#d2a8ff` | `rgba(210, 168, 255, 0.15)` |
| Red | `#ff4444` | `rgba(255, 68, 68, 0.15)` |
| Teal | `#2dd4bf` | `rgba(45, 212, 191, 0.15)` |

### Font Options

Three font options that override `--font-family` (new variable, applied to `body`):

| Name | Value |
|------|-------|
| System Default | `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| Monospace | `"SF Mono", "Fira Code", "JetBrains Mono", monospace` |
| Sans Serif | `"Inter", "Helvetica Neue", Arial, sans-serif` |

### Popover Behavior
- Opens on gear icon click, closes on click-away or Escape key.
- Positioned below and left-aligned to the gear icon (or right-aligned if near the edge).
- Selecting any option applies it immediately (no confirm button).
- All selections persisted to localStorage as a single JSON object under key `trayce-theme`.
- On page load, read `trayce-theme` from localStorage and apply before first paint (in a `<script>` in `<head>` to avoid flash).

### Files Affected
- Create: `client/theme.ts` — `ThemeManager` class: defines presets, applies CSS variables, reads/writes localStorage, manages popover DOM
- Modify: `client/index.html` — add inline `<script>` in `<head>` for early theme application to prevent flash, add gear icon to `#top-bar`
- Modify: `client/style.css` — add `--font-family` variable to `:root`, apply to `body`, add `--canvas-bg` variable, popover styles
- Modify: `client/app.ts` — instantiate ThemeManager, wire gear icon click

## Non-Goals

- Custom CSS editor or arbitrary variable overrides
- Per-session themes (theme is global, not per-session)
- Theme import/export
- Canvas background color customization (the document background is controlled by the canvas, not the theme — `--canvas-bg` only affects the container around the canvas)
- Responsive/mobile layout changes (out of scope for this spec)
