import type { BrushParams } from "./brushes/types";

export interface BrushSettingsConfig {
  onParamsChange: (params: BrushParams) => void;
}

export class BrushSettingsUI {
  private container: HTMLElement;
  private params: BrushParams;

  constructor(container: HTMLElement, initialParams: BrushParams, private config: BrushSettingsConfig) {
    this.container = container;
    this.params = { ...initialParams };
    this.render();
  }

  private render(): void {
    this.container.innerHTML = "";

    const label = document.createElement("div");
    label.className = "panel-label";
    label.textContent = "Brush";
    this.container.appendChild(label);

    this.addSlider("Size", 1, 200, this.params.size, "px", (v) => {
      this.params.size = v;
      this.notify();
    });

    this.addSlider("Opacity", 0, 100, this.params.opacity, "%", (v) => {
      this.params.opacity = v;
      this.notify();
    });

    this.addSlider("Flow", 0, 100, this.params.flow, "%", (v) => {
      this.params.flow = v;
      this.notify();
    });

    this.addSlider("Smoothing", 0, 100, this.params.smoothing, "%", (v) => {
      this.params.smoothing = v;
      this.notify();
    });
  }

  private addSlider(
    name: string,
    min: number,
    max: number,
    value: number,
    unit: string,
    onChange: (value: number) => void
  ): void {
    const row = document.createElement("div");
    row.className = "slider-row";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = name;

    const valueSpan = document.createElement("span");
    valueSpan.textContent = `${value}${unit}`;

    row.appendChild(nameSpan);
    row.appendChild(valueSpan);
    this.container.appendChild(row);

    const track = document.createElement("div");
    track.className = "slider-track";
    const fill = document.createElement("div");
    fill.className = "slider-fill";
    const thumb = document.createElement("div");
    thumb.className = "slider-thumb";

    const pctInitial = ((value - min) / (max - min)) * 100;
    fill.style.width = `${pctInitial}%`;
    thumb.style.left = `${pctInitial}%`;

    track.appendChild(fill);
    track.appendChild(thumb);
    this.container.appendChild(track);

    const updateFromEvent = (e: MouseEvent) => {
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const newValue = Math.round(min + pct * (max - min));
      const pctNew = ((newValue - min) / (max - min)) * 100;
      fill.style.width = `${pctNew}%`;
      thumb.style.left = `${pctNew}%`;
      valueSpan.textContent = `${newValue}${unit}`;
      onChange(newValue);
    };

    // Click and drag support
    track.addEventListener("mousedown", (e) => {
      e.preventDefault();
      updateFromEvent(e);
      const onMove = (ev: MouseEvent) => updateFromEvent(ev);
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  updateParams(params: Partial<BrushParams>): void {
    Object.assign(this.params, params);
    this.render();
  }

  getParams(): BrushParams {
    return { ...this.params };
  }

  private notify(): void {
    this.config.onParamsChange({ ...this.params });
  }
}
