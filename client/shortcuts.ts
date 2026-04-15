export type ShortcutAction =
  | { type: "tool"; tool: string }
  | { type: "brush-size"; delta: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "submit" }
  | { type: "cycle-shape" }
  | { type: "annotation-mode"; op: "toggle" | "exit" }
  | { type: "annotation-tool"; tool: "pin" | "text" | "callout" };

export type ShortcutCallback = (action: ShortcutAction) => void;

export class ShortcutHandler {
  constructor(private callback: ShortcutCallback) {
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Don't handle when typing in inputs
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement
    ) {
      return;
    }

    // Modifier shortcuts
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "z":
          e.preventDefault();
          this.callback({ type: "undo" });
          return;
        case "y":
          e.preventDefault();
          this.callback({ type: "redo" });
          return;
        case "enter":
          e.preventDefault();
          this.callback({ type: "submit" });
          return;
      }
    }

    // Shift shortcuts
    if (e.shiftKey && e.key.toLowerCase() === "u") {
      this.callback({ type: "cycle-shape" });
      return;
    }

    // Escape — exit annotation mode
    if (e.key === "Escape") {
      this.callback({ type: "annotation-mode", op: "exit" });
      return;
    }

    // Single key shortcuts
    switch (e.key.toLowerCase()) {
      case "b":
        this.callback({ type: "tool", tool: "pen" });
        break;
      case "n":
        this.callback({ type: "tool", tool: "pencil" });
        break;
      case "m":
        this.callback({ type: "tool", tool: "marker" });
        break;
      case "w":
        this.callback({ type: "tool", tool: "watercolor" });
        break;
      case "h":
        this.callback({ type: "tool", tool: "highlighter" });
        break;
      case "e":
        this.callback({ type: "tool", tool: "eraser" });
        break;
      case "r":
        this.callback({ type: "tool", tool: "select" });
        break;
      case "l":
        this.callback({ type: "tool", tool: "lasso" });
        break;
      case "u":
        this.callback({ type: "tool", tool: "shapes" });
        break;
      case "a":
        this.callback({ type: "annotation-mode", op: "toggle" });
        break;
      case "t":
        this.callback({ type: "tool", tool: "text" });
        this.callback({ type: "annotation-tool", tool: "text" });
        break;
      case "p":
        this.callback({ type: "annotation-tool", tool: "pin" });
        break;
      case "c":
        this.callback({ type: "annotation-tool", tool: "callout" });
        break;
      case "i":
        this.callback({ type: "tool", tool: "image" });
        break;
      case "[":
        this.callback({ type: "brush-size", delta: -2 });
        break;
      case "]":
        this.callback({ type: "brush-size", delta: 2 });
        break;
    }
  };

  private onKeyUp = (_e: KeyboardEvent): void => {
    // Space release could end panning — handled by touch module
  };

  destroy(): void {
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
  }
}
