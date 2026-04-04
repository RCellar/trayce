# Image Import — Canvas Image Attachment

**Date:** 2026-03-27
**Status:** Design

## Overview

Wire the existing `ImageTool` class into the application so users can add images to the canvas via file picker, clipboard paste, or drag-and-drop. Imported images are placed on a new layer, positioned and scaled to fit the canvas, and become part of the layer stack like any other content. Users can then draw over, reposition (with the select tool), or hide/delete the image layer.

## Current State

The `ImageTool` class (`client/tools/image.ts`) is **fully implemented** but not integrated:

| Component | Status |
|---|---|
| `ImageTool` class (file picker, paste, drag-drop) | Implemented, not instantiated |
| Toolbar button (`image` / `🖼`) | Defined in `ToolId` type, commented out in `TOOLS` array |
| Keyboard shortcut (`I`) | Mapped in `shortcuts.ts`, no handler in app |
| Layer system | Supports `ctx.drawImage()` — no changes needed |
| Compositor | Renders all layer content equally — no changes needed |
| Canvas-push (server→client) | Working reference implementation for image→layer flow |

## Goals

- Import images from local files, clipboard, or drag-and-drop
- Place each imported image on its own new layer
- Scale images to fit within the canvas while preserving aspect ratio
- Make paste and drag-drop work globally (not just when image tool is active)
- Keep the image tool button in the toolbar for explicit file picker access

## Non-Goals

- Image transform handles (resize/rotate via drag) — use select tool's existing move capability
- Image filters or adjustments (brightness, contrast, etc.)
- SVG or vector image import — raster only, consistent with the canvas model
- URL-based image import (fetch from link)

## Design

### Import Flow

```
User action (paste / drop / file picker)
  → ImageTool.onImport(bitmap: ImageBitmap)
    → Create new layer named "Image: <filename>" (or "Pasted image")
    → Calculate fit: scale bitmap to fit canvas, center it
    → Draw bitmap onto layer's OffscreenCanvas via ctx.drawImage()
    → Push undo snapshot
    → Mark compositor dirty
    → Update layers UI
```

This mirrors the existing canvas-push flow (`app.ts:484-510`) but with the layer visible by default and proper undo integration.

### Scaling Strategy

Images are scaled to **fit inside the canvas** (contain, not cover) while preserving aspect ratio. The image is centered on the canvas. No upscaling — if the image is smaller than the canvas, it is drawn at its native size, centered.

```
if (bitmap.width <= canvasWidth && bitmap.height <= canvasHeight) {
  // Draw at native size, centered
  drawWidth = bitmap.width;
  drawHeight = bitmap.height;
} else {
  // Scale down to fit
  const scale = Math.min(canvasWidth / bitmap.width, canvasHeight / bitmap.height);
  drawWidth = bitmap.width * scale;
  drawHeight = bitmap.height * scale;
}
x = (canvasWidth - drawWidth) / 2;
y = (canvasHeight - drawHeight) / 2;
```

### Input Methods

| Method | Trigger | When active | Notes |
|---|---|---|---|
| **File picker** | Click toolbar image button, or press `I` | Any time | Opens native file dialog, accepts `image/*` |
| **Clipboard paste** | `Ctrl+V` with image data | Always (global) | Intercepts paste only when clipboard contains image data; text paste is unaffected |
| **Drag-and-drop** | Drop image file onto canvas | Always (global) | `dragover` shows copy cursor, `drop` imports the file |

Paste and drag-drop are registered once at app startup (not tool-dependent). The file picker is triggered when the image tool is explicitly selected.

### Layer Naming

- File picker: `"Image: {filename}"` (e.g., `"Image: mockup.png"`)
- Paste: `"Pasted image"`
- Drag-drop: `"Image: {filename}"`
- Canvas-push (existing): uses the push label (unchanged)

### Undo Integration

Importing an image creates a single undo snapshot. `Ctrl+Z` after import removes the entire layer. This matches the behavior of other layer-creating operations.

## Implementation

### Files to Modify

| File | Change |
|---|---|
| `client/app.ts` | Instantiate `ImageTool`, wire `onImport` callback, call `setupPasteHandler()` and `setupDropHandler()`, handle `I` shortcut and toolbar image button |
| `client/toolbar.ts` | Uncomment the image tool entry in the `TOOLS` array |

### Files That Need No Changes

| File | Reason |
|---|---|
| `client/tools/image.ts` | Already complete |
| `client/layers.ts` | `addLayer()` + `ctx.drawImage()` already sufficient |
| `client/compositor.ts` | Renders all layers uniformly |
| `client/shortcuts.ts` | `I` → image already mapped |

### Implementation Steps

1. **Uncomment toolbar button** — In `toolbar.ts`, add `{ id: "image", icon: "🖼" }` to the `TOOLS` array.

2. **Instantiate ImageTool in app.ts** — Create the `ImageTool` with an `onImport` callback that:
   - Creates a new layer via `layerManager.addLayer(name)`
   - Calculates fit dimensions (scale-to-fit, center, no upscale)
   - Draws the bitmap: `layer.ctx.drawImage(bitmap, x, y, drawWidth, drawHeight)`
   - Pushes an undo snapshot via `history.push()`
   - Calls `compositor.markDirty()`
   - Updates the layers UI panel

3. **Register global handlers** — Call `imageTool.setupPasteHandler()` and `imageTool.setupDropHandler(canvasContainer)` at startup, outside of any tool-selection logic.

4. **Wire toolbar and shortcut** — When the image tool is selected (toolbar click or `I` key), call `imageTool.openFilePicker()`. Unlike brush tools, the image tool doesn't have a persistent active state — selecting it immediately opens the file picker, then the active tool reverts to the previous brush.

### Reference: Canvas-Push Pattern

The existing canvas-push handler (`app.ts:484-510`) demonstrates the same image→layer flow:

```typescript
const layer = layerManager.addLayer(label);
const imgElement = new Image();
imgElement.onload = () => {
  layer.ctx.drawImage(imgElement, 0, 0, sw, sh);
  compositor?.markDirty();
};
imgElement.src = `data:image/png;base64,${image}`;
```

The image import callback follows this same pattern but uses `ImageBitmap` (from `createImageBitmap()`) instead of an `Image` element, which can be drawn directly via `ctx.drawImage(bitmap, x, y, w, h)`.

## How to Verify

1. Start the server: `bun run start`
2. Open the canvas in a browser
3. **File picker**: Press `I` or click the image button → select an image file → image appears centered on a new layer
4. **Paste**: Copy an image to clipboard → `Ctrl+V` in the canvas → image appears on a new layer
5. **Drag-drop**: Drag an image file from the file manager onto the canvas → image appears on a new layer
6. Verify the layers panel shows the new image layer
7. Verify `Ctrl+Z` removes the image layer
8. Verify images larger than the canvas are scaled down; smaller images are drawn at native size
9. Verify the image is included in submissions (flattened with other layers on export)
