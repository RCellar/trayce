export interface TextToolConfig {
  onCommit: () => void;
}

export class TextTool {
  private textarea: HTMLTextAreaElement | null = null;
  private targetCtx: OffscreenCanvasRenderingContext2D | null = null;
  private docX = 0;
  private docY = 0;

  constructor(private config: TextToolConfig) {}

  place(
    ctx: OffscreenCanvasRenderingContext2D,
    container: HTMLElement,
    screenX: number,
    screenY: number,
    docX: number,
    docY: number,
    color: string,
    fontSize: number
  ): void {
    this.remove();
    this.targetCtx = ctx;
    this.docX = docX;
    this.docY = docY;

    const textarea = document.createElement("textarea");
    textarea.style.cssText = `
      position: absolute;
      left: ${screenX}px;
      top: ${screenY}px;
      background: transparent;
      border: 1px dashed var(--accent);
      color: ${color};
      font-size: ${fontSize}px;
      font-family: sans-serif;
      padding: 4px;
      min-width: 100px;
      min-height: 30px;
      outline: none;
      resize: both;
      z-index: 50;
    `;

    textarea.addEventListener("blur", () => this.commit(color, fontSize));
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.commit(color, fontSize);
      }
      if (e.key === "Escape") {
        this.remove();
      }
    });

    container.appendChild(textarea);
    textarea.focus();
    this.textarea = textarea;
  }

  private commit(color: string, fontSize: number): void {
    if (!this.textarea || !this.targetCtx) return;

    const text = this.textarea.value.trim();
    if (text) {
      const ctx = this.targetCtx;
      ctx.fillStyle = color;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textBaseline = "top";

      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], this.docX, this.docY + i * fontSize * 1.2);
      }
    }

    this.remove();
    this.config.onCommit();
  }

  remove(): void {
    if (this.textarea) {
      this.textarea.remove();
      this.textarea = null;
    }
    this.targetCtx = null;
  }
}
