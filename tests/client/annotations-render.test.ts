import { describe, expect, test } from "bun:test";
import { AnnotationRenderer } from "../../client/annotations/render";
import { AnnotationRegistry } from "../../client/annotations/registry";

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
