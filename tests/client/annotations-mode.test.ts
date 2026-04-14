import { describe, expect, test } from "bun:test";
import { AnnotationMode } from "../../client/annotations/mode";

describe("AnnotationMode", () => {
  test("defaults to inactive, tool pin", () => {
    const m = new AnnotationMode();
    expect(m.isActive()).toBe(false);
    expect(m.currentTool()).toBe("pin");
  });

  test("toggle flips active state", () => {
    const m = new AnnotationMode();
    m.toggle();
    expect(m.isActive()).toBe(true);
    m.toggle();
    expect(m.isActive()).toBe(false);
  });

  test("setTool switches current tool", () => {
    const m = new AnnotationMode();
    m.setTool("text");
    expect(m.currentTool()).toBe("text");
    m.setTool("callout");
    expect(m.currentTool()).toBe("callout");
  });

  test("subscribe receives updates on toggle", () => {
    const m = new AnnotationMode();
    const seen: Array<{ active: boolean; tool: string }> = [];
    m.subscribe((s) => seen.push({ active: s.active, tool: s.tool }));
    m.toggle();
    m.setTool("text");
    expect(seen.length).toBe(2);
    expect(seen[0]!.active).toBe(true);
    expect(seen[1]!.tool).toBe("text");
  });

  test("unsubscribe stops updates", () => {
    const m = new AnnotationMode();
    let count = 0;
    const unsub = m.subscribe(() => count++);
    m.toggle();
    unsub();
    m.toggle();
    expect(count).toBe(1);
  });
});
