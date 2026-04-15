export interface ThemePreset {
  name: string;
  vars: Record<string, string>;
}

const THEME_PRESETS: ThemePreset[] = [
  {
    name: "Dark",
    vars: {
      "--bg": "#111",
      "--surface": "#1a1a2e",
      "--border": "#333",
      "--text": "#c9d1d9",
      "--text-muted": "#8b949e",
      "--canvas-bg": "#1a1a1a",
      "--canvas-dot": "rgba(255, 255, 255, 0.06)",
    },
  },
  {
    name: "Light",
    vars: {
      "--bg": "#f5f5f5",
      "--surface": "#ffffff",
      "--border": "#d0d7de",
      "--text": "#1f2328",
      "--text-muted": "#656d76",
      "--canvas-bg": "#e8e8e8",
      "--canvas-dot": "rgba(0, 0, 0, 0.06)",
    },
  },
  {
    name: "Midnight",
    vars: {
      "--bg": "#0d1117",
      "--surface": "#161b22",
      "--border": "#30363d",
      "--text": "#c9d1d9",
      "--text-muted": "#8b949e",
      "--canvas-bg": "#0a0e14",
      "--canvas-dot": "rgba(255, 255, 255, 0.04)",
    },
  },
  {
    name: "Warm",
    vars: {
      "--bg": "#1c1410",
      "--surface": "#2a1f1a",
      "--border": "#3d2e24",
      "--text": "#d4c5b5",
      "--text-muted": "#9a8a7a",
      "--canvas-bg": "#1a150f",
      "--canvas-dot": "rgba(255, 235, 205, 0.05)",
    },
  },
  {
    name: "Snow",
    vars: {
      "--bg": "#ffffff",
      "--surface": "#f8f9fa",
      "--border": "#dee2e6",
      "--text": "#212529",
      "--text-muted": "#6c757d",
      "--canvas-bg": "#f0f0f0",
      "--canvas-dot": "rgba(0, 0, 0, 0.05)",
    },
  },
  {
    name: "Stone",
    vars: {
      "--bg": "#e8e4df",
      "--surface": "#f2eeea",
      "--border": "#c9c2ba",
      "--text": "#3d3833",
      "--text-muted": "#78716c",
      "--canvas-bg": "#ddd8d2",
      "--canvas-dot": "rgba(0, 0, 0, 0.05)",
    },
  },
  {
    name: "Slate",
    vars: {
      "--bg": "#293241",
      "--surface": "#3d5a80",
      "--border": "#4a6fa0",
      "--text": "#e0fbfc",
      "--text-muted": "#98c1d9",
      "--canvas-bg": "#1f2937",
      "--canvas-dot": "rgba(255, 255, 255, 0.05)",
    },
  },
  {
    name: "Nord",
    vars: {
      "--bg": "#2e3440",
      "--surface": "#3b4252",
      "--border": "#4c566a",
      "--text": "#eceff4",
      "--text-muted": "#d8dee9",
      "--canvas-bg": "#272c36",
      "--canvas-dot": "rgba(236, 239, 244, 0.05)",
    },
  },
];

const ACCENT_COLORS = [
  { name: "Blue", accent: "#4a9eff", dim: "rgba(74, 158, 255, 0.15)" },
  { name: "Orange", accent: "#f78166", dim: "rgba(247, 129, 102, 0.15)" },
  { name: "Green", accent: "#3fb950", dim: "rgba(63, 185, 80, 0.15)" },
  { name: "Purple", accent: "#d2a8ff", dim: "rgba(210, 168, 255, 0.15)" },
  { name: "Red", accent: "#ff4444", dim: "rgba(255, 68, 68, 0.15)" },
  { name: "Teal", accent: "#2dd4bf", dim: "rgba(45, 212, 191, 0.15)" },
];

const FONT_OPTIONS = [
  {
    name: "System Default",
    value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  { name: "Monospace", value: '"SF Mono", "Fira Code", "JetBrains Mono", monospace' },
  { name: "Sans Serif", value: '"Inter", "Helvetica Neue", Arial, sans-serif' },
];

/** Build an SVG favicon string using the given theme colors. */
export function buildFaviconSvg(bg = "#111", accent = "#4a9eff", text = "#c9d1d9"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="${bg}" stroke="${text}" stroke-width="1" stroke-opacity="0.3"/>
  <path d="M9 23 L14 7 L17 7 L20 19 L22 11 L25 11" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

let currentBlobUrl: string | null = null;

/** Apply an SVG string as the page favicon via blob URL. */
export function applyFavicon(svg: string): void {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
  }

  const blob = new Blob([svg], { type: "image/svg+xml" });
  currentBlobUrl = URL.createObjectURL(blob);

  let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    document.head.appendChild(link);
  }
  link.href = currentBlobUrl;
}

interface SavedTheme {
  preset: string;
  accentName: string;
  fontName: string;
  vars: Record<string, string>;
}

export class ThemeManager {
  private popover: HTMLElement | null = null;
  private currentPreset = "Dark";
  private currentAccent = "Blue";
  private currentFont = "System Default";
  private dismissHandler: ((e: MouseEvent) => void) | null = null;

  constructor() {
    this.load();
    const vars = this.buildVars();
    applyFavicon(buildFaviconSvg(vars["--bg"], vars["--accent"], vars["--text"]));
  }

  attachGearIcon(container: HTMLElement): void {
    const gear = document.createElement("button");
    gear.className = "gear-btn";
    gear.textContent = "\u2699";
    gear.title = "Theme settings";
    gear.addEventListener("click", (e) => {
      e.stopPropagation();
      this.togglePopover(gear);
    });
    container.appendChild(gear);
  }

  private togglePopover(anchor: HTMLElement): void {
    if (this.popover) {
      this.closePopover();
      return;
    }

    this.popover = document.createElement("div");
    this.popover.className = "theme-popover";

    this.addSectionLabel(this.popover, "Theme");
    const themeRow = document.createElement("div");
    themeRow.className = "theme-swatches";
    for (const preset of THEME_PRESETS) {
      const swatch = document.createElement("div");
      swatch.className = `theme-swatch${preset.name === this.currentPreset ? " active" : ""}`;
      swatch.style.background = preset.vars["--bg"] ?? "";
      swatch.title = preset.name;
      swatch.addEventListener("click", () => {
        this.currentPreset = preset.name;
        this.applyAndSave();
        this.refreshPopover(anchor);
      });
      themeRow.appendChild(swatch);
    }
    this.popover.appendChild(themeRow);

    this.addSectionLabel(this.popover, "Accent");
    const accentRow = document.createElement("div");
    accentRow.className = "theme-swatches";
    for (const ac of ACCENT_COLORS) {
      const swatch = document.createElement("div");
      swatch.className = `accent-swatch${ac.name === this.currentAccent ? " active" : ""}`;
      swatch.style.background = ac.accent;
      swatch.title = ac.name;
      swatch.addEventListener("click", () => {
        this.currentAccent = ac.name;
        this.applyAndSave();
        this.refreshPopover(anchor);
      });
      accentRow.appendChild(swatch);
    }
    this.popover.appendChild(accentRow);

    this.addSectionLabel(this.popover, "Font");
    const fontSelect = document.createElement("select");
    fontSelect.className = "theme-font-select";
    for (const font of FONT_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = font.name;
      opt.textContent = font.name;
      if (font.name === this.currentFont) opt.selected = true;
      fontSelect.appendChild(opt);
    }
    fontSelect.addEventListener("change", () => {
      this.currentFont = fontSelect.value;
      this.applyAndSave();
    });
    this.popover.appendChild(fontSelect);

    const rect = anchor.getBoundingClientRect();
    this.popover.style.top = `${rect.bottom + 4}px`;
    this.popover.style.right = `${window.innerWidth - rect.right}px`;

    document.body.appendChild(this.popover);

    requestAnimationFrame(() => {
      this.dismissHandler = (e: MouseEvent) => {
        if (this.popover && !this.popover.contains(e.target as Node) && e.target !== anchor) {
          this.closePopover();
        }
      };
      document.addEventListener("click", this.dismissHandler);
    });

    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.closePopover();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);
  }

  private closePopover(): void {
    if (this.popover) {
      this.popover.remove();
      this.popover = null;
    }
    if (this.dismissHandler) {
      document.removeEventListener("click", this.dismissHandler);
      this.dismissHandler = null;
    }
  }

  private refreshPopover(anchor: HTMLElement): void {
    this.closePopover();
    this.togglePopover(anchor);
  }

  private addSectionLabel(parent: HTMLElement, text: string): void {
    const label = document.createElement("div");
    label.className = "theme-section-label";
    label.textContent = text;
    parent.appendChild(label);
  }

  private buildVars(): Record<string, string> {
    const preset = THEME_PRESETS.find((p) => p.name === this.currentPreset) ?? THEME_PRESETS[0]!;
    const accent = ACCENT_COLORS.find((a) => a.name === this.currentAccent) ?? ACCENT_COLORS[0]!;
    const font = FONT_OPTIONS.find((f) => f.name === this.currentFont) ?? FONT_OPTIONS[0]!;
    return {
      ...preset.vars,
      "--accent": accent.accent,
      "--accent-dim": accent.dim,
      "--font-family": font.value,
    };
  }

  private apply(vars: Record<string, string>): void {
    const style = document.documentElement.style;
    for (const [key, value] of Object.entries(vars)) {
      style.setProperty(key, value);
    }
  }

  private applyAndSave(): void {
    const vars = this.buildVars();
    this.apply(vars);
    this.save(vars);
    applyFavicon(buildFaviconSvg(vars["--bg"], vars["--accent"], vars["--text"]));
    // Notify subscribers (annotation renderer, panel, export rasterizer) so
    // anything that can't consume `--accent` via CSS (e.g., PixiJS Graphics,
    // OffscreenCanvas 2D) can refresh its cached colors.
    document.dispatchEvent(new CustomEvent("trayce:theme-changed"));
  }

  private save(vars: Record<string, string>): void {
    const data: SavedTheme = {
      preset: this.currentPreset,
      accentName: this.currentAccent,
      fontName: this.currentFont,
      vars,
    };
    localStorage.setItem("trayce-theme", JSON.stringify(data));
  }

  private load(): void {
    try {
      const raw = localStorage.getItem("trayce-theme");
      if (!raw) return;
      const data: SavedTheme = JSON.parse(raw);
      this.currentPreset = data.preset ?? "Dark";
      this.currentAccent = data.accentName ?? "Blue";
      this.currentFont = data.fontName ?? "System Default";
    } catch {}
  }
}
