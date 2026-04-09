import { describe, expect, test } from "bun:test";
import type { SavedLayer } from "../../client/persistence";
import { persistenceKey, SCRATCHPAD_KEY } from "../../client/persistence";

describe("persistence key helpers", () => {
  test("persistenceKey returns prefixed session key", () => {
    expect(persistenceKey("abc-123")).toBe("layers-session-abc-123");
  });

  test("persistenceKey handles arbitrary session IDs", () => {
    expect(persistenceKey("xyz")).toBe("layers-session-xyz");
    expect(persistenceKey("my-session-42")).toBe("layers-session-my-session-42");
  });

  test("SCRATCHPAD_KEY equals layers-scratchpad", () => {
    expect(SCRATCHPAD_KEY).toBe("layers-scratchpad");
  });
});

describe("SavedLayer interface", () => {
  test("SavedLayer includes locked and deletable fields", () => {
    const layer: SavedLayer = {
      id: "test-id",
      name: "Test Layer",
      blob: new Blob(),
      opacity: 1,
      blendMode: "normal",
      visible: true,
      locked: false,
      deletable: true,
    };
    expect(layer.locked).toBe(false);
    expect(layer.deletable).toBe(true);
  });

  test("SavedLayer transform field is optional", () => {
    const layerWithoutTransform: SavedLayer = {
      id: "test-id",
      name: "Test Layer",
      blob: new Blob(),
      opacity: 1,
      blendMode: "normal",
      visible: true,
      locked: false,
      deletable: true,
    };
    expect(layerWithoutTransform.transform).toBeUndefined();
  });

  test("SavedLayer transform stores positioning and size data", () => {
    const layer: SavedLayer = {
      id: "img-layer",
      name: "Image Layer",
      blob: new Blob(),
      opacity: 1,
      blendMode: "normal",
      visible: true,
      locked: false,
      deletable: true,
      transform: {
        x: 100,
        y: 200,
        width: 400,
        height: 300,
        sourceWidth: 800,
        sourceHeight: 600,
      },
    };
    expect(layer.transform).toBeDefined();
    expect(layer.transform!.x).toBe(100);
    expect(layer.transform!.y).toBe(200);
    expect(layer.transform!.width).toBe(400);
    expect(layer.transform!.height).toBe(300);
    expect(layer.transform!.sourceWidth).toBe(800);
    expect(layer.transform!.sourceHeight).toBe(600);
  });

  test("SavedLayer transform shape matches LayerTransform fields", () => {
    const transform = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      sourceWidth: 200,
      sourceHeight: 200,
    };
    const layer: SavedLayer = {
      id: "id",
      name: "name",
      blob: new Blob(),
      opacity: 0.5,
      blendMode: "multiply",
      visible: false,
      locked: true,
      deletable: false,
      transform,
    };
    // All six transform fields must be present and correct
    const keys = Object.keys(layer.transform!);
    expect(keys).toContain("x");
    expect(keys).toContain("y");
    expect(keys).toContain("width");
    expect(keys).toContain("height");
    expect(keys).toContain("sourceWidth");
    expect(keys).toContain("sourceHeight");
  });
});
