# Image Layer Transforms — Movable & Resizable Image Objects

**Date:** 2026-03-27
**Status:** Design
**Depends on:** Image Import (2026-03-27-image-import.md)

## Overview

Imported images currently bake pixels directly into a full-size `OffscreenCanvas` layer. Once drawn, the image can't be repositioned or resized without clearing and redrawing.

This spec adds **transform properties** to layers so that image layers behave as movable, resizable objects on the canvas. The user can select an image layer and drag it to reposition, or drag corner handles to resize. The image remains a discrete object until the user explicitly rasterizes (flattens) it into the pixel grid.

## Current Architecture

| Component | Current behavior |
|---|---|
| `Layer` interface | `canvas`, `ctx`, `name`, `visible`, `opacity`, `blendMode`, `locked`, `deletable` — no position or size data |
| `Compositor` | Each layer → PixiJS Sprite at (0,0), full document size. No per-layer transforms. |
| `CanvasManager` | `screenToDoc()` / `docToScreen()` for viewport zoom/pan only |
| Image import | `ctx.drawImage(bitmap, x, y, w, h)` — pixels baked into layer canvas at import time |
| Select tool | Operates on pixel ImageData within a single layer. No layer-level movement. |

**Key constraint:** Layers are always `docWidth x docHeight` OffscreenCanvas objects. All content positioning is pixel-based within that canvas. There are no per-layer position or scale properties.

## Goals

- Imported images are placed as **transform layers** — movable and resizable objects
- Users can select a transform layer and drag to reposition
- Users can drag corner/edge handles to resize (preserving aspect ratio by default, free resize with Shift)
- Transform layers render at full quality regardless of zoom level
- Users can rasterize a transform layer to bake it into the pixel grid (irreversible)
- Transform state is visually distinct from regular layers (bounding box, handles)

## Non-Goals

- Rotation — adds significant complexity (interpolation, hit testing) for limited sketching value
- Arbitrary transform on brush layers — only image layers get transforms
- Multi-select / group transforms
- Snapping or alignment guides

## Design

### Layer Interface Extension

Add optional transform properties to the `Layer` interface. When present, the layer is a **transform layer** — the compositor uses the sprite's position/scale instead of blitting a full-canvas bitmap.

```typescript
interface Layer {
  // ... existing properties ...

  /** When set, layer content is a positioned object rather than full-canvas pixels. */
  transform?: {
    x: number;       // document-space X position (top-left of bounding box)
    y: number;       // document-space Y position
    width: number;   // display width in document pixels
    height: number;  // display height in document pixels
    sourceWidth: number;   // original image width (for quality reference)
    sourceHeight: number;  // original image height
  };
}
```

A layer **without** `transform` (brushes, rasterized images) behaves exactly as today — full-canvas bitmap composited at (0,0).

A layer **with** `transform` has its content drawn into a canvas sized to `sourceWidth x sourceHeight` (the original image dimensions, not the full document). The compositor positions and scales the sprite according to the transform properties.

### Compositor Changes

For transform layers, the compositor creates a sprite from the layer's smaller canvas and applies PixiJS transforms:

```
// Regular layer (no transform):
sprite.position = (0, 0)
sprite.scale = (1, 1)
sprite.texture = Texture.from(layer.canvas)  // full docWidth x docHeight

// Transform layer:
sprite.position = (transform.x, transform.y)
sprite.scale = (transform.width / transform.sourceWidth, transform.height / transform.sourceHeight)
sprite.texture = Texture.from(layer.canvas)  // sourceWidth x sourceHeight (smaller)
```

This means:
- The OffscreenCanvas for transform layers is only as large as the original image
- GPU-accelerated scaling via PixiJS — no manual pixel resampling
- Position and scale are adjustable without redrawing the canvas content

### Image Import Changes

When an image is imported, instead of baking it into a full-size canvas:

1. Create a layer with a canvas sized to the image dimensions (`sourceWidth x sourceHeight`)
2. Draw the bitmap at (0,0) in this smaller canvas
3. Set the `transform` property to center the image on the document canvas:

```typescript
const layer = layerManager.addLayer(name, {
  canvasWidth: bitmap.width,
  canvasHeight: bitmap.height,
});
layer.ctx.drawImage(bitmap, 0, 0);
layer.transform = {
  x: (docWidth - displayWidth) / 2,
  y: (docHeight - displayHeight) / 2,
  width: displayWidth,
  height: displayHeight,
  sourceWidth: bitmap.width,
  sourceHeight: bitmap.height,
};
```

### Interaction: Move

When the active layer has a `transform` and the user clicks within its bounding box:

1. **Hit test**: Check if click point (in doc coords) falls within `{x, y, width, height}`
2. **Begin drag**: Record offset from click to layer origin
3. **Drag**: Update `transform.x` and `transform.y` on each pointer move
4. **End drag**: Commit position, push undo snapshot

The cursor should change to a move cursor when hovering over a transform layer's bounds.

### Interaction: Resize

Eight handles at corners and edge midpoints of the bounding box:

```
  [NW]----[N]----[NE]
   |               |
  [W]     image   [E]
   |               |
  [SW]----[S]----[SE]
```

- **Corner handles**: Scale both axes. Default preserves aspect ratio; hold **Shift** for free resize.
- **Edge handles**: Scale one axis only. Shift constrains to maintain aspect ratio.
- **Handle hit area**: 8px radius in screen space (zoom-independent)

On resize:
1. Calculate new `width` and `height` from handle drag delta
2. Anchor to the opposite corner/edge (the handle being dragged moves; the opposite stays fixed)
3. Enforce minimum size (e.g., 10x10 document pixels)
4. Update `transform.width`, `transform.height`, and adjust `transform.x`/`transform.y` to keep the anchor fixed

### Visual Feedback

When a transform layer is the active layer:

- **Bounding box**: 1px dashed border in accent color, drawn in screen space (constant thickness regardless of zoom)
- **Handles**: 6px filled squares at corners and midpoints, drawn in screen space
- **No feedback** when a non-transform layer is active

This overlay is drawn by the compositor (or a dedicated overlay layer) on top of the composited scene, in screen coordinates. It does not affect the exported image.

### Rasterize (Flatten to Pixels)

A "Rasterize" action (context menu in layers UI, or keyboard shortcut) converts a transform layer back to a regular full-canvas layer:

1. Create a new full-size `OffscreenCanvas` (docWidth x docHeight)
2. Draw the transform layer's canvas content at `(transform.x, transform.y)` scaled to `(transform.width, transform.height)`
3. Replace the layer's canvas and context with the new full-size one
4. Remove the `transform` property
5. Mark compositor dirty

After rasterizing, the image is part of the pixel grid and can be painted over, erased, etc. — but can no longer be moved or resized.

### LayerManager.addLayer Changes

`addLayer` needs an optional parameter for custom canvas dimensions:

```typescript
addLayer(name: string, opts?: { canvasWidth?: number; canvasHeight?: number }): Layer
```

When `opts` is provided, the layer's OffscreenCanvas is created at those dimensions instead of `docWidth x docHeight`. This is only used for transform layers.

### Export Behavior

`flattenToPng` in `export.ts` already composites all visible layers. For transform layers, it needs to draw the layer's canvas at the transform position/scale rather than blitting at (0,0):

```typescript
if (layer.transform) {
  const t = layer.transform;
  mergeCtx.drawImage(layer.canvas, t.x, t.y, t.width, t.height);
} else {
  mergeCtx.drawImage(layer.canvas, 0, 0);
}
```

### Undo Integration

Transform changes (move, resize) push snapshots to the undo stack. Each snapshot captures the `transform` state before the change. Undo restores the previous transform without re-rendering the canvas content.

## Implementation

### Files to Modify

| File | Change |
|---|---|
| `client/layers.ts` | Add `transform` property to `Layer` interface. Update `addLayer` to support custom canvas dimensions. Add `rasterizeLayer(index)` method. |
| `client/compositor.ts` | Apply `sprite.position` and `sprite.scale` for transform layers. Draw selection overlay (bounding box + handles) for active transform layer. |
| `client/app.ts` | Update `handleImageImport` to create transform layers. Add transform interaction (move/resize) to `handleInput`. |
| `client/export.ts` | Update `flattenToPng` to respect transform position/scale. |
| `client/layers-ui.ts` | Add "Rasterize" button/option for transform layers. |
| `client/tools/image.ts` | No changes needed. |

### Files That Need No Changes

| File | Reason |
|---|---|
| `client/tools/image.ts` | Import pipeline unchanged — only the `onImport` callback in app.ts changes |
| `client/canvas.ts` | Viewport transforms unchanged |
| `client/input.ts` | Input pipeline unchanged — transform hit-testing happens in app.ts |
| `client/brushes/*` | Brush rendering unchanged — brushes only operate on non-transform layers |

### Implementation Order

1. **Layer interface + LayerManager** — Add `transform` property and custom canvas dimensions
2. **Compositor** — Sprite positioning/scaling for transform layers
3. **Image import** — Create transform layers instead of baking pixels
4. **Export** — Handle transform layers in flatten
5. **Move interaction** — Hit testing, drag to reposition
6. **Resize interaction** — Handle rendering, resize logic
7. **Visual overlay** — Bounding box and handles
8. **Rasterize** — Flatten transform layer to pixels
9. **Layers UI** — Rasterize button, visual indicator for transform layers

## How to Verify

1. Import an image via file picker, paste, or drag-and-drop
2. Confirm it appears as a layer with a visible bounding box and handles
3. Drag the image to reposition it on the canvas
4. Drag a corner handle to resize — aspect ratio preserved by default, free with Shift
5. Press Ctrl+Z to undo the move/resize
6. Submit the canvas — confirm the exported PNG includes the image at its current position and size
7. Use "Rasterize" on the image layer — confirm the bounding box disappears and the image becomes paintable
8. Verify brush strokes on a transform layer are blocked (must rasterize first)
9. Verify non-image layers (brush layers, background) are completely unaffected
