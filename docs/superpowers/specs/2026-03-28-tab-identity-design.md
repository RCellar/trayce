# Tab Identity: Dynamic Favicon & Session-Aware Title

## Summary

Add a theme-aware SVG favicon and a dynamic tab title that reflects the selected session. Both update reactively — the favicon changes with the theme, the title changes with the session selection.

## Favicon

### Rendering

The favicon is a programmatically generated SVG — no static file. `ThemeManager` builds an SVG string using current CSS variable values:

- `--bg` — icon background (rounded rectangle)
- `--accent` — brush stroke / mark graphic
- `--text` — outline or secondary detail

The SVG is a simple stylized pen/brush mark on a rounded square, designed to be legible at 16x16 and 32x32.

### Lifecycle

`ThemeManager` gains an `updateFavicon()` method:

1. Read `--bg`, `--accent`, `--text` from `document.documentElement.style` (or computed style).
2. Build SVG string with those colors inlined.
3. Create a `Blob` (`type: "image/svg+xml"`) and generate a blob URL via `URL.createObjectURL`.
4. Find or create a `<link rel="icon">` element in `<head>`.
5. Set its `href` to the new blob URL.
6. Revoke the previous blob URL (`URL.revokeObjectURL`) to avoid memory leaks.

Called from:
- `applyAndSave()` — on every theme/accent change
- `load()` / constructor — on page load to set the initial favicon

### HTML

`index.html` gets no static `<link rel="icon">`. The element is created dynamically on first call.

## Tab Title

### Format

- **Session selected:** `trayce — {session.label}` (em dash, e.g. "trayce — MediaStack")
- **No sessions connected:** `trayce`

### Integration

A `updateTabTitle()` function in `client/app.ts` reads the currently selected session ID from `sessionsUI.getSelectedId()`, looks up its label in the `sessions` array, and sets `document.title`.

Called from:
- The `sessions` WebSocket message handler (after `sessionsUI.update()`)
- The session `<select>` change event

### Edge Cases

- If the selected session disconnects and the selection falls back to another session, the title updates to the new session's label.
- If all sessions disconnect, the title reverts to `trayce`.

## Files Modified

- `client/theme.ts` — Add `updateFavicon()` method to `ThemeManager`, call from `applyAndSave()` and constructor/load path
- `client/app.ts` — Add `updateTabTitle()`, call after session list updates and selection changes
