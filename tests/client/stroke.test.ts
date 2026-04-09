import { describe, expect, test } from "bun:test";
import { generateStrokeOutline, type StrokePoint } from "../../client/stroke";

describe("generateStrokeOutline", () => {
  test("generates outline points from input points", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 0, pressure: 0.5 },
      { x: 20, y: 0, pressure: 0.5 },
    ];
    const outline = generateStrokeOutline(points, { size: 10, smoothing: 0.5 });
    expect(outline.length).toBeGreaterThan(0);
    expect(outline.length).toBeGreaterThan(2);
  });

  test("respects size parameter", () => {
    const points: StrokePoint[] = Array.from({ length: 20 }, (_, i) => ({
      x: i * 5,
      y: 0,
      pressure: 0.5,
    }));
    const smallOutline = generateStrokeOutline(points, { size: 5, smoothing: 0.5 });
    const largeOutline = generateStrokeOutline(points, { size: 50, smoothing: 0.5 });
    const smallYSpread =
      Math.max(...smallOutline.map((p) => p[1]!)) - Math.min(...smallOutline.map((p) => p[1]!));
    const largeYSpread =
      Math.max(...largeOutline.map((p) => p[1]!)) - Math.min(...largeOutline.map((p) => p[1]!));
    expect(largeYSpread).toBeGreaterThan(smallYSpread);
  });

  test("returns array of [x, y] pairs", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 10, pressure: 0.5 },
    ];
    const outline = generateStrokeOutline(points, { size: 8, smoothing: 0.5 });
    for (const pt of outline) {
      expect(pt.length).toBe(2);
      expect(typeof pt[0]).toBe("number");
      expect(typeof pt[1]).toBe("number");
    }
  });

  test("single point produces output", () => {
    const points: StrokePoint[] = [{ x: 50, y: 50, pressure: 0.5 }];
    const outline = generateStrokeOutline(points, { size: 10, smoothing: 0.5 });
    expect(outline.length).toBeGreaterThan(0);
  });

  test("pressure affects stroke width", () => {
    const lightPoints: StrokePoint[] = Array.from({ length: 20 }, (_, i) => ({
      x: i * 5,
      y: 0,
      pressure: 0.1,
    }));
    const heavyPoints: StrokePoint[] = Array.from({ length: 20 }, (_, i) => ({
      x: i * 5,
      y: 0,
      pressure: 0.9,
    }));
    const light = generateStrokeOutline(lightPoints, {
      size: 20,
      smoothing: 0.5,
      simulatePressure: false,
    });
    const heavy = generateStrokeOutline(heavyPoints, {
      size: 20,
      smoothing: 0.5,
      simulatePressure: false,
    });
    const lightSpread = Math.max(...light.map((p) => p[1]!)) - Math.min(...light.map((p) => p[1]!));
    const heavySpread = Math.max(...heavy.map((p) => p[1]!)) - Math.min(...heavy.map((p) => p[1]!));
    expect(heavySpread).toBeGreaterThan(lightSpread);
  });
});
