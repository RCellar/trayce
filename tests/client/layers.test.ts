import { describe, expect, test } from "bun:test";
import { type BlendMode, type Layer, LayerManager } from "../../client/layers";

// Mock OffscreenCanvas for Bun test environment
globalThis.OffscreenCanvas = class MockOffscreenCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return {
      clearRect: () => {},
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      fill: () => {},
      fillRect: () => {},
      fillStyle: "",
      globalCompositeOperation: "source-over",
      globalAlpha: 1,
    };
  }
  convertToBlob() {
    return Promise.resolve(new Blob(["fake"], { type: "image/png" }));
  }
} as any;

describe("LayerManager — creation", () => {
  test("creates with background layer", () => {
    const lm = new LayerManager(100, 100, "white");
    expect(lm.layers.length).toBe(1);
    expect(lm.layers[0]!.name).toBe("Background");
    expect(lm.layers[0]!.deletable).toBe(false);
    expect(lm.activeLayerIndex).toBe(0);
  });

  test("transparent background creates layer without fill", () => {
    const lm = new LayerManager(100, 100, "transparent");
    expect(lm.layers.length).toBe(1);
    expect(lm.layers[0]!.name).toBe("Background");
  });

  test("activeLayer returns the current active layer", () => {
    const lm = new LayerManager(100, 100, "white");
    expect(lm.activeLayer.name).toBe("Background");
  });
});

describe("LayerManager — add/delete", () => {
  test("add layer", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.addLayer("Sketch");
    expect(lm.layers.length).toBe(2);
    expect(lm.layers[1]!.name).toBe("Sketch");
    expect(lm.activeLayerIndex).toBe(1);
  });

  test("added layer is deletable", () => {
    const lm = new LayerManager(100, 100, "white");
    const layer = lm.addLayer("Sketch");
    expect(layer.deletable).toBe(true);
  });

  test("added layer has default properties", () => {
    const lm = new LayerManager(100, 100, "white");
    const layer = lm.addLayer("Sketch");
    expect(layer.visible).toBe(true);
    expect(layer.opacity).toBe(100);
    expect(layer.blendMode).toBe("normal");
    expect(layer.locked).toBe(false);
  });

  test("delete layer", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.addLayer("Sketch");
    lm.deleteLayer(1);
    expect(lm.layers.length).toBe(1);
  });

  test("cannot delete background", () => {
    const lm = new LayerManager(100, 100, "white");
    expect(() => lm.deleteLayer(0)).toThrow();
  });

  test("delete adjusts activeLayerIndex", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.addLayer("A");
    lm.addLayer("B");
    expect(lm.activeLayerIndex).toBe(2);
    lm.deleteLayer(2);
    expect(lm.activeLayerIndex).toBe(1);
  });

  test("max 20 layers", () => {
    const lm = new LayerManager(100, 100, "white");
    for (let i = 0; i < 19; i++) lm.addLayer(`L${i}`);
    expect(lm.layers.length).toBe(20);
    expect(() => lm.addLayer("overflow")).toThrow();
  });
});

describe("LayerManager — reorder", () => {
  test("move layer down", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.addLayer("A");
    lm.addLayer("B");
    lm.moveLayer(2, 1);
    expect(lm.layers[1]!.name).toBe("B");
    expect(lm.layers[2]!.name).toBe("A");
  });

  test("move updates activeLayerIndex", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.addLayer("A");
    lm.addLayer("B");
    lm.activeLayerIndex = 2;
    lm.moveLayer(2, 1);
    expect(lm.activeLayerIndex).toBe(1);
  });

  test("move same index is no-op", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.addLayer("A");
    lm.moveLayer(1, 1);
    expect(lm.layers[1]!.name).toBe("A");
  });
});

describe("LayerManager — duplicate", () => {
  test("duplicate creates copy after source", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.addLayer("Sketch");
    lm.duplicateLayer(1);
    expect(lm.layers.length).toBe(3);
    expect(lm.layers[2]!.name).toBe("Sketch copy");
    expect(lm.activeLayerIndex).toBe(2);
  });

  test("duplicate respects max layers", () => {
    const lm = new LayerManager(100, 100, "white");
    for (let i = 0; i < 19; i++) lm.addLayer(`L${i}`);
    expect(() => lm.duplicateLayer(1)).toThrow();
  });
});

describe("duplicateLayer copies all properties", () => {
  test("copies transform from image layer", () => {
    const lm = new LayerManager(100, 100, "white");
    const layer = lm.addLayer("Image", { canvasWidth: 50, canvasHeight: 50 });
    layer.transform = { x: 10, y: 20, width: 50, height: 50, sourceWidth: 50, sourceHeight: 50 };
    layer.locked = true;
    layer.visible = false;

    const copy = lm.duplicateLayer(1);
    expect(copy.transform).toEqual({
      x: 10,
      y: 20,
      width: 50,
      height: 50,
      sourceWidth: 50,
      sourceHeight: 50,
    });
    expect(copy.locked).toBe(true);
    expect(copy.visible).toBe(false);
  });

  test("copy transform is independent from source", () => {
    const lm = new LayerManager(100, 100, "white");
    const layer = lm.addLayer("Image", { canvasWidth: 50, canvasHeight: 50 });
    layer.transform = { x: 10, y: 20, width: 50, height: 50, sourceWidth: 50, sourceHeight: 50 };

    const copy = lm.duplicateLayer(1);
    copy.transform!.x = 999;
    expect(layer.transform.x).toBe(10);
  });

  test("copies canvas dimensions from source", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.addLayer("Image", { canvasWidth: 50, canvasHeight: 30 });

    const copy = lm.duplicateLayer(1);
    expect(copy.canvas.width).toBe(50);
    expect(copy.canvas.height).toBe(30);
  });
});

describe("LayerManager — merge down", () => {
  test("merge down removes upper layer", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.addLayer("Sketch");
    lm.mergeDown(1);
    expect(lm.layers.length).toBe(1);
  });

  test("merge at index 0 is no-op", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.mergeDown(0);
    expect(lm.layers.length).toBe(1);
  });
});

describe("revision tracking", () => {
  test("new layers start at revision 0", () => {
    const lm = new LayerManager(100, 100, "white");
    expect(lm.layers[0]!.revision).toBe(0);
  });

  test("bumpRevision increments revision counter", () => {
    const lm = new LayerManager(100, 100, "white");
    const layer = lm.addLayer("Test");
    lm.bumpRevision(layer.id);
    expect(layer.revision).toBe(1);
    lm.bumpRevision(layer.id);
    expect(layer.revision).toBe(2);
  });

  test("bumpRevision is no-op for unknown id", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.bumpRevision("nonexistent"); // should not throw
  });
});

describe("LayerManager — replaceAll", () => {
  test("replaceAll replaces all layers and resets active index", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.addLayer("Extra");
    expect(lm.layers.length).toBe(2);

    const canvas = new OffscreenCanvas(100, 100);
    const ctx = canvas.getContext("2d")!;
    const newLayers: Layer[] = [
      {
        id: "bg", name: "Background", canvas, ctx,
        visible: true, opacity: 100, blendMode: "normal",
        locked: false, deletable: false, revision: 0,
      },
      {
        id: "sketch", name: "Sketch",
        canvas: new OffscreenCanvas(100, 100),
        ctx: new OffscreenCanvas(100, 100).getContext("2d")!,
        visible: true, opacity: 100, blendMode: "normal",
        locked: false, deletable: true, revision: 0,
      },
      {
        id: "notes", name: "Notes",
        canvas: new OffscreenCanvas(100, 100),
        ctx: new OffscreenCanvas(100, 100).getContext("2d")!,
        visible: true, opacity: 80, blendMode: "multiply",
        locked: false, deletable: true, revision: 0,
      },
    ];

    lm.replaceAll(newLayers);
    expect(lm.layers.length).toBe(3);
    expect(lm.layers[0]!.id).toBe("bg");
    expect(lm.layers[2]!.name).toBe("Notes");
    // Active layer defaults to first deletable (non-background) layer
    expect(lm.activeLayerIndex).toBe(1);
  });

  test("replaceAll bumps revision on all layers to invalidate compositor cache", () => {
    const lm = new LayerManager(100, 100, "white");
    const canvas = new OffscreenCanvas(100, 100);
    const layer: Layer = {
      id: "test", name: "Test", canvas,
      ctx: canvas.getContext("2d")!,
      visible: true, opacity: 100, blendMode: "normal",
      locked: false, deletable: true, revision: 0,
    };
    lm.replaceAll([layer]);
    expect(lm.layers[0]!.revision).toBe(1);
  });
});

describe("LayerManager — blendToComposite", () => {
  test("maps all blend modes", () => {
    const lm = new LayerManager(100, 100, "white");
    const modes: BlendMode[] = [
      "normal",
      "multiply",
      "screen",
      "overlay",
      "soft-light",
      "hard-light",
      "darken",
      "lighten",
      "color-dodge",
      "color-burn",
    ];
    for (const mode of modes) {
      expect(typeof lm.blendToComposite(mode)).toBe("string");
    }
  });

  test("normal maps to source-over", () => {
    const lm = new LayerManager(100, 100, "white");
    expect(lm.blendToComposite("normal")).toBe("source-over");
  });
});
