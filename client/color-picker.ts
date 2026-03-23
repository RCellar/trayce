export interface ColorPickerConfig {
  onColorChange: (color: string) => void;
}

export class ColorPicker {
  private color = "#000000";
  private recentColors: string[] = [];
  private element: HTMLElement;

  constructor(private container: HTMLElement, private config: ColorPickerConfig) {
    this.element = document.createElement("div");
    this.element.className = "color-picker";
    container.appendChild(this.element);

    // Load recent colors from localStorage
    try {
      const stored = localStorage.getItem("trayce-recent-colors");
      if (stored) this.recentColors = JSON.parse(stored);
    } catch {}

    this.render();
  }

  private render(): void {
    this.element.innerHTML = "";

    // Current color swatch
    const swatch = document.createElement("div");
    swatch.style.cssText = `width:28px;height:28px;border-radius:50%;border:2px solid #fff;cursor:pointer;background:${this.color};`;
    swatch.title = this.color;
    swatch.addEventListener("click", () => this.openNativePicker());
    this.element.appendChild(swatch);

    // Hidden native color input
    const input = document.createElement("input");
    input.type = "color";
    input.value = this.color;
    input.style.cssText = "position:absolute;opacity:0;pointer-events:none;width:0;height:0;";
    input.addEventListener("input", () => {
      this.setColor(input.value);
    });
    this.element.appendChild(input);

    // Recent colors strip
    if (this.recentColors.length > 0) {
      const strip = document.createElement("div");
      strip.style.cssText = "display:flex;gap:3px;margin-top:4px;flex-wrap:wrap;";
      for (const c of this.recentColors.slice(0, 12)) {
        const dot = document.createElement("div");
        dot.style.cssText = `width:14px;height:14px;border-radius:50%;cursor:pointer;border:1px solid var(--border);background:${c};`;
        dot.addEventListener("click", () => this.setColor(c));
        strip.appendChild(dot);
      }
      this.element.appendChild(strip);
    }
  }

  private openNativePicker(): void {
    const input = this.element.querySelector('input[type="color"]') as HTMLInputElement;
    input?.click();
  }

  setColor(color: string): void {
    this.color = color;
    this.addToRecent(color);
    this.config.onColorChange(color);
    this.render();
  }

  getColor(): string {
    return this.color;
  }

  private addToRecent(color: string): void {
    this.recentColors = [color, ...this.recentColors.filter((c) => c !== color)].slice(0, 12);
    localStorage.setItem("trayce-recent-colors", JSON.stringify(this.recentColors));
  }
}
