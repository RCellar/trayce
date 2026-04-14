import { describe, expect, test } from "bun:test";
import { AnnotationRegistry } from "../../client/annotations/registry";
import { AnnotationRenderer } from "../../client/annotations/render";
import type { Annotation } from "../../client/annotations/types";
import { drawAnnotationsOnto } from "../../client/export";

function makeStubStage() {
  const children: unknown[] = [];
  return {
    children,
    addChild(c: unknown) {
      children.push(c);
    },
    removeChild(c: unknown) {
      const i = children.indexOf(c);
      if (i >= 0) children.splice(i, 1);
    },
  };
}

describe("AnnotationRenderer", () => {
  test("mounts a container on the stage", () => {
    const stage = makeStubStage();
    const registry = new AnnotationRegistry();
    const r = new AnnotationRenderer(stage as never, registry);
    r.mount();
    expect(stage.children.length).toBe(1);
  });

  test("creates a child per visible annotation", () => {
    const stage = makeStubStage();
    const registry = new AnnotationRegistry();
    const r = new AnnotationRenderer(stage as never, registry);
    r.mount();
    registry.createPin({ at: [10, 10] });
    registry.createPin({ at: [20, 20] });
    r.sync();
    expect(r.visibleCount()).toBe(2);
  });

  test("hides deleted annotations on sync", () => {
    const stage = makeStubStage();
    const registry = new AnnotationRegistry();
    const r = new AnnotationRenderer(stage as never, registry);
    r.mount();
    const p = registry.createPin({ at: [10, 10] });
    r.sync();
    registry.softDelete(p.id);
    r.sync();
    expect(r.visibleCount()).toBe(0);
  });

  test("Claude-authored annotations get distinct visual flag", () => {
    const stage = makeStubStage();
    const registry = new AnnotationRegistry();
    const r = new AnnotationRenderer(stage as never, registry);
    r.mount();
    registry.ingestPushed([
      {
        id: "c1",
        kind: "pin",
        author: "claude",
        status: "open",
        createdAt: 1,
        updatedAt: 1,
        replies: [],
        number: 1,
        at: [0, 0],
      },
    ]);
    r.sync();
    expect(r.isClaudeAuthored("c1")).toBe(true);
  });

  test("container() returns the mounted PixiJS container", () => {
    const stage = makeStubStage();
    const registry = new AnnotationRegistry();
    const r = new AnnotationRenderer(stage as never, registry);
    r.mount();
    // stage.children[0] is typed as unknown because the stub uses unknown[];
    // cast to never to satisfy the overloaded expect().toBe() matcher.
    expect(r.container()).toBe(stage.children[0] as never);
  });
});

describe("drawAnnotationsOnto (export rasterizer)", () => {
  function makeStubCtx() {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const ctx = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "calls") return calls;
          return (...args: unknown[]) => {
            calls.push({ method: String(prop), args });
            return ctx;
          };
        },
        set() {
          return true;
        },
      },
    );
    return ctx as unknown as CanvasRenderingContext2D & { calls: typeof calls };
  }

  test("draws nothing for empty list", () => {
    const ctx = makeStubCtx();
    drawAnnotationsOnto(ctx, []);
    expect(ctx.calls.length).toBe(0);
  });

  test("draws a pin with a number", () => {
    const ctx = makeStubCtx();
    const ann: Annotation = {
      id: "p1",
      kind: "pin",
      author: "user",
      status: "open",
      createdAt: 1,
      updatedAt: 1,
      replies: [],
      number: 1,
      at: [100, 200],
    };
    drawAnnotationsOnto(ctx, [ann]);
    const methods = ctx.calls.map((c) => c.method);
    expect(methods).toContain("arc"); // circle
    expect(methods).toContain("fillText"); // number
  });

  test("draws text annotation via fillText", () => {
    const ctx = makeStubCtx();
    const ann: Annotation = {
      id: "t1",
      kind: "text",
      author: "user",
      status: "open",
      createdAt: 1,
      updatedAt: 1,
      replies: [],
      text: "hello",
      bbox: [10, 20, 100, 24],
      style: { fontSize: 14, color: "#dc2626", weight: "normal" },
    };
    drawAnnotationsOnto(ctx, [ann]);
    const fillTexts = ctx.calls.filter((c) => c.method === "fillText");
    expect(fillTexts.length).toBeGreaterThan(0);
    expect(fillTexts[0]!.args[0]).toBe("hello");
  });

  test("draws callout with leader line", () => {
    const ctx = makeStubCtx();
    const ann: Annotation = {
      id: "c1",
      kind: "callout",
      author: "user",
      status: "open",
      createdAt: 1,
      updatedAt: 1,
      replies: [],
      text: "move",
      bbox: [200, 100, 80, 24],
      target: [300, 300],
      style: { fontSize: 14, color: "#dc2626" },
    };
    drawAnnotationsOnto(ctx, [ann]);
    const methods = ctx.calls.map((c) => c.method);
    expect(methods).toContain("moveTo");
    expect(methods).toContain("lineTo");
  });

  test("skips deleted annotations", () => {
    const ctx = makeStubCtx();
    const ann: Annotation = {
      id: "d1",
      kind: "pin",
      author: "user",
      status: "deleted",
      createdAt: 1,
      updatedAt: 1,
      replies: [],
      number: 1,
      at: [0, 0],
    };
    drawAnnotationsOnto(ctx, [ann]);
    expect(ctx.calls.length).toBe(0);
  });
});
