import { describe, expect, test } from "bun:test";
import { type Command, History } from "../../client/history";

const makeCommand = (id: string, checkpointSize?: number): Command => ({
  type: "stroke",
  layerId: "layer-1",
  data: { id },
  ...(checkpointSize !== undefined && { checkpointSize }),
});

describe("History — undo/redo", () => {
  test("undo returns last command", () => {
    const h = new History(256 * 1024 * 1024);
    h.push(makeCommand("a"));
    h.push(makeCommand("b"));
    expect(h.undo()?.data.id).toBe("b");
  });

  test("redo returns undone command", () => {
    const h = new History(256 * 1024 * 1024);
    h.push(makeCommand("a"));
    h.push(makeCommand("b"));
    h.undo();
    expect(h.redo()?.data.id).toBe("b");
  });

  test("new command clears redo stack", () => {
    const h = new History(256 * 1024 * 1024);
    h.push(makeCommand("a"));
    h.push(makeCommand("b"));
    h.undo();
    h.push(makeCommand("c"));
    expect(h.redo()).toBeNull();
  });

  test("undo on empty returns null", () => {
    const h = new History(256 * 1024 * 1024);
    expect(h.undo()).toBeNull();
  });

  test("redo on empty returns null", () => {
    const h = new History(256 * 1024 * 1024);
    expect(h.redo()).toBeNull();
  });

  test("multiple undo/redo cycle", () => {
    const h = new History(256 * 1024 * 1024);
    h.push(makeCommand("a"));
    h.push(makeCommand("b"));
    h.push(makeCommand("c"));
    expect(h.undo()?.data.id).toBe("c");
    expect(h.undo()?.data.id).toBe("b");
    expect(h.redo()?.data.id).toBe("b");
    expect(h.redo()?.data.id).toBe("c");
    expect(h.redo()).toBeNull();
  });
});

describe("History — canUndo/canRedo", () => {
  test("canUndo false when empty", () => {
    expect(new History(256 * 1024 * 1024).canUndo()).toBe(false);
  });

  test("canUndo true after push", () => {
    const h = new History(256 * 1024 * 1024);
    h.push(makeCommand("a"));
    expect(h.canUndo()).toBe(true);
  });

  test("canRedo false before undo", () => {
    const h = new History(256 * 1024 * 1024);
    h.push(makeCommand("a"));
    expect(h.canRedo()).toBe(false);
  });

  test("canRedo true after undo", () => {
    const h = new History(256 * 1024 * 1024);
    h.push(makeCommand("a"));
    h.undo();
    expect(h.canRedo()).toBe(true);
  });
});

describe("History — checkpoint", () => {
  test("shouldCheckpoint after N strokes", () => {
    const h = new History(256 * 1024 * 1024);
    for (let i = 0; i < 9; i++) {
      h.push(makeCommand(`s${i}`));
      expect(h.shouldCheckpoint()).toBe(false);
    }
    h.push(makeCommand("s9"));
    expect(h.shouldCheckpoint()).toBe(true);
  });

  test("resetCheckpointCounter resets counter", () => {
    const h = new History(256 * 1024 * 1024);
    for (let i = 0; i < 10; i++) h.push(makeCommand(`s${i}`));
    expect(h.shouldCheckpoint()).toBe(true);
    h.resetCheckpointCounter();
    expect(h.shouldCheckpoint()).toBe(false);
  });
});

describe("History — memory eviction", () => {
  test("evicts oldest commands when budget exceeded", () => {
    const h = new History(100); // tiny budget
    h.push(makeCommand("a", 60));
    h.push(makeCommand("b", 60));
    // Total 120 > budget 100 → oldest evicted
    expect(h.undoCount).toBe(1);
    expect(h.undo()?.data.id).toBe("b");
  });

  test("keeps at least one command", () => {
    const h = new History(10);
    h.push(makeCommand("a", 50));
    expect(h.undoCount).toBe(1);
  });

  test("commands without checkpointSize are not counted", () => {
    const h = new History(100);
    h.push(makeCommand("a"));
    h.push(makeCommand("b"));
    h.push(makeCommand("c"));
    expect(h.undoCount).toBe(3);
  });
});

describe("History — clear", () => {
  test("clears all stacks", () => {
    const h = new History(256 * 1024 * 1024);
    h.push(makeCommand("a"));
    h.push(makeCommand("b"));
    h.undo();
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.undoCount).toBe(0);
    expect(h.redoCount).toBe(0);
  });
});
