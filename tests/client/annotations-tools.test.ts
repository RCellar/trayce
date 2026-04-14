import { describe, expect, test } from "bun:test";
import { AnnotationRegistry } from "../../client/annotations/registry";
import { CalloutPlacement } from "../../client/annotations/tools/callout-tool";
import { placePin } from "../../client/annotations/tools/pin-tool";

describe("placePin", () => {
  test("creates a pin in the registry at given coords", () => {
    const r = new AnnotationRegistry();
    placePin(r, 100, 200);
    const all = r.visible();
    expect(all.length).toBe(1);
    if (all[0]!.kind === "pin") {
      expect(all[0]!.at).toEqual([100, 200]);
      expect(all[0]!.number).toBe(1);
    }
  });
});

describe("CalloutPlacement", () => {
  test("first click sets target, does not create yet", () => {
    const r = new AnnotationRegistry();
    const placement = new CalloutPlacement();
    const opened: Array<{ x: number; y: number }> = [];
    const overlay = {
      open: (opts: {
        x: number;
        y: number;
        onCommit: (t: string) => void;
        onCancel: () => void;
      }) => {
        opened.push({ x: opts.x, y: opts.y });
        opts.onCommit("label");
      },
    };
    placement.onClick(r, 100, 100, overlay);
    expect(opened.length).toBe(0);
    expect(r.visible().length).toBe(0);
  });

  test("second click opens overlay at label position and commits on callback", () => {
    const r = new AnnotationRegistry();
    const placement = new CalloutPlacement();
    const overlay = {
      open: (opts: {
        x: number;
        y: number;
        onCommit: (t: string) => void;
        onCancel: () => void;
      }) => {
        opts.onCommit("hello");
      },
    };
    placement.onClick(r, 100, 100, overlay); // target
    placement.onClick(r, 200, 200, overlay); // label position — opens overlay
    const all = r.visible();
    expect(all.length).toBe(1);
    if (all[0]!.kind === "callout") {
      expect(all[0]!.target).toEqual([100, 100]);
      expect(all[0]!.text).toBe("hello");
      expect(all[0]!.bbox[0]).toBe(200);
      expect(all[0]!.bbox[1]).toBe(200);
    }
  });

  test("empty text commit does not create a callout", () => {
    const r = new AnnotationRegistry();
    const placement = new CalloutPlacement();
    const overlay = {
      open: (opts: {
        x: number;
        y: number;
        onCommit: (t: string) => void;
        onCancel: () => void;
      }) => {
        opts.onCommit("   ");
      },
    };
    placement.onClick(r, 0, 0, overlay);
    placement.onClick(r, 10, 10, overlay);
    expect(r.visible().length).toBe(0);
  });

  test("reset clears pending target", () => {
    const r = new AnnotationRegistry();
    const placement = new CalloutPlacement();
    const overlay = {
      open: (opts: {
        x: number;
        y: number;
        onCommit: (t: string) => void;
        onCancel: () => void;
      }) => {
        opts.onCommit("x");
      },
    };
    placement.onClick(r, 0, 0, overlay);
    placement.reset();
    placement.onClick(r, 10, 10, overlay); // should act as first click again
    expect(r.visible().length).toBe(0);
  });
});
