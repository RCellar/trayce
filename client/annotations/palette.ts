import type { AnnotationMode, AnnotationToolKind } from "./mode";

export class AnnotationPalette {
  private el: HTMLDivElement;
  private buttons: Record<AnnotationToolKind, HTMLButtonElement>;
  private exitBtn: HTMLButtonElement;
  private unsubscribe: (() => void) | null = null;

  constructor(private mode: AnnotationMode) {
    this.el = document.createElement("div");
    this.el.className = "annotation-palette";
    this.el.style.cssText = `
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: none;
      gap: 6px;
      padding: 6px 8px;
      background: var(--panel-bg, #1a1a1a);
      border: 1px solid var(--border, #333);
      border-radius: 6px;
      z-index: 100;
    `;

    const make = (label: string, kind: AnnotationToolKind | "exit"): HTMLButtonElement => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = `
        padding: 4px 10px;
        background: transparent;
        border: 1px solid var(--border, #333);
        color: var(--fg, #eee);
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
      `;
      b.addEventListener("click", () => {
        if (kind === "exit") {
          this.mode.setActive(false);
        } else {
          this.mode.setTool(kind);
        }
      });
      return b;
    };

    const pin = make("Pin", "pin");
    const text = make("Text", "text");
    const callout = make("Callout", "callout");
    this.buttons = { pin, text, callout };
    this.exitBtn = make("Exit", "exit");

    this.el.append(text, pin, callout, this.exitBtn);
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
    this.unsubscribe = this.mode.subscribe((state) => this.render(state));
    this.render({ active: this.mode.isActive(), tool: this.mode.currentTool() });
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.el.remove();
  }

  private render(state: { active: boolean; tool: AnnotationToolKind }): void {
    this.el.style.display = state.active ? "flex" : "none";
    for (const [kind, btn] of Object.entries(this.buttons) as [
      AnnotationToolKind,
      HTMLButtonElement,
    ][]) {
      btn.style.borderColor =
        kind === state.tool ? "var(--accent, #dc2626)" : "var(--border, #333)";
      btn.style.color = kind === state.tool ? "var(--accent, #dc2626)" : "var(--fg, #eee)";
    }
  }
}
