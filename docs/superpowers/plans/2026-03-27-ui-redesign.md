# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Trayce's UI with a floating tabbed panel for brush/layers, a two-row chat-style submit bar, and a theme customization system.

**Architecture:** Three independent features built in sequence to avoid file conflicts. Theme system first (adds CSS variables used by everything), submit bar second (bottom bar restructure), floating panel last (removes right panel, adds floating window). Each feature is self-contained and testable after its tasks complete.

**Tech Stack:** TypeScript, vanilla DOM (no framework), CSS custom properties, localStorage for persistence, Bun bundler

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `client/theme.ts` | Create | ThemeManager class — presets, accent colors, fonts, gear popover, localStorage persistence |
| `client/floating-panel.ts` | Create | FloatingPanel class — draggable tabbed window, collapse, position persistence |
| `client/index.html` | Modify | Remove #right-panel, restructure #bottom-bar to two rows, add gear icon, add early theme script |
| `client/style.css` | Modify | Add theme variables, floating panel styles, two-row bottom bar, gear popover styles, remove #right-panel |
| `client/app.ts` | Modify | Wire ThemeManager, FloatingPanel, restructured bottom bar references |
| `client/toolbar.ts` | Modify | Add floating panel toggle button |
| `client/side-panel.ts` | No change | — |

---

### Task 1: Theme CSS variables and early-load script

**Files:**
- Modify: `client/style.css:1-18` (`:root` block)
- Modify: `client/index.html:7-8` (add inline script before stylesheet)

- [ ] **Step 1: Add new CSS variables to :root**

In `client/style.css`, add `--canvas-bg` and `--font-family` to the `:root` block. Replace the existing `:root` block:

```css
:root {
  --bg: #111;
  --surface: #1a1a2e;
  --border: #333;
  --text: #c9d1d9;
  --text-muted: #8b949e;
  --accent: #4a9eff;
  --accent-dim: rgba(74, 158, 255, 0.15);
  --danger: #ff4444;
  --success: #3fb950;
  --warning: #d29922;
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --canvas-bg: #222;
  --toolbar-width: 48px;
  --panel-width: 200px;
  --topbar-height: 40px;
  --bottombar-height: 64px;
}
```

Changes: added `--font-family`, `--canvas-bg`, increased `--bottombar-height` from 36px to 64px (for two-row bar).

- [ ] **Step 2: Apply the new variables**

In `client/style.css`, change the `body` font-family to use the variable:

```css
html, body {
  height: 100%;
  overflow: hidden;
  font-family: var(--font-family);
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
}
```

Change `#canvas-container` background to use the variable:

```css
#canvas-container {
  background: var(--canvas-bg);
  overflow: hidden;
  position: relative;
}
```

- [ ] **Step 3: Add early theme loader to index.html**

In `client/index.html`, add an inline script BEFORE the stylesheet link (between lines 7 and 8):

```html
  <script>
    // Apply saved theme before first paint to prevent flash
    try {
      const saved = localStorage.getItem("trayce-theme");
      if (saved) {
        const t = JSON.parse(saved);
        const r = document.documentElement.style;
        if (t.vars) Object.entries(t.vars).forEach(([k,v]) => r.setProperty(k, v));
      }
    } catch {}
  </script>
```

- [ ] **Step 4: Build to verify**

Run: `bun build client/app.ts --outdir /tmp/trayce-check --target browser 2>&1`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add client/style.css client/index.html
git commit -m "feat(client): add theme CSS variables and early-load script"
```

---

### Task 2: Create ThemeManager

**Files:**
- Create: `client/theme.ts`

- [ ] **Step 1: Create the ThemeManager class**

Create `client/theme.ts`:

```typescript
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
      "--canvas-bg": "#222",
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
      "--canvas-bg": "#1a1a1a",
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
      "--canvas-bg": "#251c15",
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
  { name: "System Default", value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { name: "Monospace", value: '"SF Mono", "Fira Code", "JetBrains Mono", monospace' },
  { name: "Sans Serif", value: '"Inter", "Helvetica Neue", Arial, sans-serif' },
];

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

    // Theme presets
    this.addSectionLabel(this.popover, "Theme");
    const themeRow = document.createElement("div");
    themeRow.className = "theme-swatches";
    for (const preset of THEME_PRESETS) {
      const swatch = document.createElement("div");
      swatch.className = "theme-swatch" + (preset.name === this.currentPreset ? " active" : "");
      swatch.style.background = preset.vars["--bg"];
      swatch.title = preset.name;
      swatch.addEventListener("click", () => {
        this.currentPreset = preset.name;
        this.applyAndSave();
        this.refreshPopover(anchor);
      });
      themeRow.appendChild(swatch);
    }
    this.popover.appendChild(themeRow);

    // Accent colors
    this.addSectionLabel(this.popover, "Accent");
    const accentRow = document.createElement("div");
    accentRow.className = "theme-swatches";
    for (const ac of ACCENT_COLORS) {
      const swatch = document.createElement("div");
      swatch.className = "accent-swatch" + (ac.name === this.currentAccent ? " active" : "");
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

    // Font
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

    // Position below anchor
    const rect = anchor.getBoundingClientRect();
    this.popover.style.top = rect.bottom + 4 + "px";
    this.popover.style.right = (window.innerWidth - rect.right) + "px";

    document.body.appendChild(this.popover);

    // Dismiss on click-away (next tick to avoid immediate dismiss)
    requestAnimationFrame(() => {
      this.dismissHandler = (e: MouseEvent) => {
        if (this.popover && !this.popover.contains(e.target as Node) && e.target !== anchor) {
          this.closePopover();
        }
      };
      document.addEventListener("click", this.dismissHandler);
    });

    // Dismiss on Escape
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
    const preset = THEME_PRESETS.find((p) => p.name === this.currentPreset) ?? THEME_PRESETS[0];
    const accent = ACCENT_COLORS.find((a) => a.name === this.currentAccent) ?? ACCENT_COLORS[0];
    const font = FONT_OPTIONS.find((f) => f.name === this.currentFont) ?? FONT_OPTIONS[0];
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
      // Vars are already applied by the inline <script> in index.html
    } catch {}
  }
}
```

- [ ] **Step 2: Build to verify**

Run: `bun build client/theme.ts --outdir /tmp/trayce-check --target browser 2>&1`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add client/theme.ts
git commit -m "feat(client): create ThemeManager with presets, accent, font, and gear popover"
```

---

### Task 3: Add gear popover CSS and wire ThemeManager

**Files:**
- Modify: `client/style.css`
- Modify: `client/index.html`
- Modify: `client/app.ts`

- [ ] **Step 1: Add gear button and popover CSS**

In `client/style.css`, add after the `#top-bar .right` block (after line 73):

```css
.gear-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}

.gear-btn:hover {
  color: var(--text);
}

.theme-popover {
  position: fixed;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  width: 220px;
  z-index: 200;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}

.theme-section-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-muted);
  margin-bottom: 6px;
  margin-top: 10px;
}

.theme-section-label:first-child {
  margin-top: 0;
}

.theme-swatches {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}

.theme-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s;
}

.theme-swatch.active {
  border-color: var(--accent);
}

.theme-swatch:hover {
  border-color: var(--text-muted);
}

.accent-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s;
}

.accent-swatch.active {
  border-color: var(--text);
}

.accent-swatch:hover {
  border-color: var(--text-muted);
}

.theme-font-select {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 11px;
  margin-top: 2px;
}
```

- [ ] **Step 2: Add gear icon container to index.html top-bar**

In `client/index.html`, in the `#top-bar .right` div, add a gear container after the submit button (or where the submit button currently is — it will move in the next task). Add `<span id="gear-container"></span>` as the last element in the `.right` div:

```html
    <div class="right">
      <label class="session-label">Session:
        <select id="session-select" disabled>
          <option value="">No sessions</option>
        </select>
      </label>
      <button id="submit-btn" disabled>Submit</button>
      <span id="gear-container"></span>
    </div>
```

- [ ] **Step 3: Wire ThemeManager in app.ts**

In `client/app.ts`, add import:

```typescript
import { ThemeManager } from "./theme";
```

At the end of `initUIComponents()`, add:

```typescript
  // Theme
  const themeManager = new ThemeManager();
  const gearContainer = document.getElementById("gear-container");
  if (gearContainer) themeManager.attachGearIcon(gearContainer);
```

- [ ] **Step 4: Build and verify**

Run: `bun build client/app.ts --outdir dist/client --minify --target browser && cp client/index.html client/style.css dist/client/`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add client/style.css client/index.html client/app.ts
git commit -m "feat(client): wire gear popover theme settings in top bar"
```

---

### Task 4: Restructure bottom bar to two-row chat layout

**Files:**
- Modify: `client/index.html`
- Modify: `client/style.css`
- Modify: `client/app.ts`

- [ ] **Step 1: Update index.html bottom bar structure**

Replace the entire `<footer id="bottom-bar">...</footer>` with:

```html
  <!-- Bottom Bar (two-row chat layout) -->
  <footer id="bottom-bar">
    <div class="bar-row bar-status">
      <span id="connection-status" class="status disconnected">
        <span class="dot"></span>
        <span class="text">Disconnected</span>
      </span>
      <label class="session-label">
        <select id="session-select" disabled>
          <option value="">No sessions</option>
        </select>
      </label>
    </div>
    <div class="bar-row bar-prompt">
      <div class="prompt-container">
        <input type="text" id="prompt-input" placeholder="Describe what you want...">
        <button id="submit-btn" disabled>Send</button>
      </div>
    </div>
  </footer>
```

Also remove the session-select and submit-btn from the top-bar `.right` div since they've moved. The top bar `.right` should now contain only the gear container and the info spans:

```html
    <div class="right">
      <span id="tool-info"></span>
      <span id="layer-info"></span>
      <span id="gear-container"></span>
    </div>
```

- [ ] **Step 2: Update bottom bar CSS**

Replace the existing `#bottom-bar` CSS block and the `#prompt-input` styles with:

```css
#bottom-bar {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 4px 12px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  z-index: 10;
  gap: 4px;
}

.bar-row {
  display: flex;
  align-items: center;
}

.bar-status {
  justify-content: space-between;
}

.bar-prompt {
  flex: 1;
}

.prompt-container {
  display: flex;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
}

.prompt-container:focus-within {
  border-color: var(--accent);
}

#prompt-input {
  flex: 1;
  background: transparent;
  border: none;
  padding: 6px 12px;
  color: var(--text);
  font-size: 12px;
  outline: none;
}

#submit-btn {
  background: var(--accent);
  color: #fff;
  border: none;
  padding: 6px 20px;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

#submit-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

#submit-btn:not(:disabled):hover {
  filter: brightness(1.1);
}
```

Remove the old `#bottom-bar .left`, `#bottom-bar .right`, `#bottom-bar .center` rules. Remove the old `#prompt-input:focus` rule. Remove the old standalone `#submit-btn` rules from the top-bar section (they're now in the bottom bar section).

Also remove the `.session-label` styles from the top-bar section and move them to be near the bottom-bar section:

```css
.session-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
}

#session-select {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  min-width: 120px;
}
```

- [ ] **Step 3: Update DOM references in app.ts**

The DOM element references in `app.ts` still point to the same IDs (`session-select`, `submit-btn`, `prompt-input`, `connection-status`, `tool-info`, `layer-info`), so the `getElementById` calls don't need to change. However, verify that all references still resolve since elements moved in the HTML.

- [ ] **Step 4: Build and test**

Run: `bun build client/app.ts --outdir dist/client --minify --target browser && cp client/index.html client/style.css dist/client/`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/style.css client/app.ts
git commit -m "feat(client): restructure bottom bar to two-row chat layout with inline send"
```

---

### Task 5: Create FloatingPanel component

**Files:**
- Create: `client/floating-panel.ts`

- [ ] **Step 1: Create the FloatingPanel class**

Create `client/floating-panel.ts`:

```typescript
export interface FloatingPanelConfig {
  defaultX: number;  // default position from right edge
  defaultY: number;  // default position from top edge
}

type TabId = "brush" | "layers";

export class FloatingPanel {
  private el: HTMLElement | null = null;
  private tabContents = new Map<TabId, HTMLElement>();
  private activeTab: TabId = "brush";
  private isVisible = true;
  private x = 0;
  private y = 0;
  private parentEl: HTMLElement | null = null;

  constructor(private config: FloatingPanelConfig) {
    this.loadState();
  }

  mount(parent: HTMLElement): void {
    this.parentEl = parent;

    this.el = document.createElement("div");
    this.el.className = "floating-panel";

    // Tab bar (also drag handle)
    const tabBar = document.createElement("div");
    tabBar.className = "fp-tabbar";

    const brushTab = this.createTab("brush", "Brush");
    const layersTab = this.createTab("layers", "Layers");

    const closeBtn = document.createElement("button");
    closeBtn.className = "fp-close";
    closeBtn.textContent = "\u00D7";
    closeBtn.addEventListener("click", () => this.hide());

    tabBar.appendChild(brushTab);
    tabBar.appendChild(layersTab);
    tabBar.appendChild(closeBtn);
    this.el.appendChild(tabBar);

    // Content areas
    const brushContent = document.createElement("div");
    brushContent.className = "fp-content";
    this.tabContents.set("brush", brushContent);
    this.el.appendChild(brushContent);

    const layersContent = document.createElement("div");
    layersContent.className = "fp-content";
    layersContent.style.display = "none";
    this.tabContents.set("layers", layersContent);
    this.el.appendChild(layersContent);

    // Position
    this.applyPosition();

    parent.appendChild(this.el);

    // Drag
    this.setupDrag(tabBar);

    // Apply initial visibility
    if (!this.isVisible) {
      this.el.style.display = "none";
    }

    this.updateTabs();
  }

  getBrushContainer(): HTMLElement | null {
    return this.tabContents.get("brush") ?? null;
  }

  getLayersContainer(): HTMLElement | null {
    return this.tabContents.get("layers") ?? null;
  }

  show(): void {
    this.isVisible = true;
    if (this.el) this.el.style.display = "";
    this.saveState();
  }

  hide(): void {
    this.isVisible = false;
    if (this.el) this.el.style.display = "none";
    this.saveState();
  }

  toggle(): void {
    if (this.isVisible) this.hide();
    else this.show();
  }

  get visible(): boolean {
    return this.isVisible;
  }

  private createTab(id: TabId, label: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "fp-tab";
    btn.dataset.tab = id;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      this.activeTab = id;
      this.updateTabs();
      this.saveState();
    });
    return btn;
  }

  private updateTabs(): void {
    if (!this.el) return;
    const tabs = this.el.querySelectorAll<HTMLButtonElement>(".fp-tab");
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === this.activeTab));

    for (const [id, content] of this.tabContents) {
      content.style.display = id === this.activeTab ? "" : "none";
    }
  }

  private applyPosition(): void {
    if (!this.el || !this.parentEl) return;
    const rect = this.parentEl.getBoundingClientRect();

    // Default: top-right corner with offset
    if (this.x === 0 && this.y === 0) {
      this.x = rect.width - this.config.defaultX - 280;
      this.y = this.config.defaultY;
    }

    // Clamp to parent bounds
    this.x = Math.max(0, Math.min(this.x, rect.width - 280));
    this.y = Math.max(0, Math.min(this.y, rect.height - 100));

    this.el.style.left = this.x + "px";
    this.el.style.top = this.y + "px";
  }

  private setupDrag(handle: HTMLElement): void {
    let startX = 0;
    let startY = 0;
    let startPosX = 0;
    let startPosY = 0;

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      this.x = startPosX + dx;
      this.y = startPosY + dy;

      // Clamp
      if (this.parentEl) {
        const rect = this.parentEl.getBoundingClientRect();
        this.x = Math.max(0, Math.min(this.x, rect.width - 280));
        this.y = Math.max(0, Math.min(this.y, rect.height - 100));
      }

      if (this.el) {
        this.el.style.left = this.x + "px";
        this.el.style.top = this.y + "px";
      }
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      this.saveState();
    };

    handle.addEventListener("mousedown", (e) => {
      // Don't drag if clicking a button inside the tab bar
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      startPosX = this.x;
      startPosY = this.y;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  private saveState(): void {
    localStorage.setItem("trayce-floating-panel", JSON.stringify({
      x: this.x,
      y: this.y,
      tab: this.activeTab,
      visible: this.isVisible,
    }));
  }

  private loadState(): void {
    try {
      const raw = localStorage.getItem("trayce-floating-panel");
      if (!raw) return;
      const state = JSON.parse(raw);
      if (typeof state.x === "number") this.x = state.x;
      if (typeof state.y === "number") this.y = state.y;
      if (state.tab === "brush" || state.tab === "layers") this.activeTab = state.tab;
      if (typeof state.visible === "boolean") this.isVisible = state.visible;
    } catch {}
  }
}
```

- [ ] **Step 2: Build to verify**

Run: `bun build client/floating-panel.ts --outdir /tmp/trayce-check --target browser 2>&1`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add client/floating-panel.ts
git commit -m "feat(client): create FloatingPanel with draggable tabs and persistence"
```

---

### Task 6: Add floating panel CSS and remove right panel

**Files:**
- Modify: `client/style.css`
- Modify: `client/index.html`

- [ ] **Step 1: Add floating panel CSS**

In `client/style.css`, add before the `/* -- Usage Tab -- */` comment:

```css
/* -- Floating Panel -- */

.floating-panel {
  position: absolute;
  width: 280px;
  background: rgba(26, 26, 46, 0.92);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 30;
  backdrop-filter: blur(8px);
}

.fp-tabbar {
  display: flex;
  border-bottom: 1px solid var(--border);
  cursor: grab;
  user-select: none;
}

.fp-tabbar:active {
  cursor: grabbing;
}

.fp-tab {
  padding: 6px 14px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.fp-tab:hover {
  color: var(--text);
}

.fp-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.fp-close {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 10px;
}

.fp-close:hover {
  color: var(--text);
}

.fp-content {
  padding: 10px;
  max-height: 400px;
  overflow-y: auto;
}
```

- [ ] **Step 2: Remove right panel from HTML**

In `client/index.html`, remove the entire `<aside id="right-panel">...</aside>` block (lines 54-57):

```html
    <!-- Right Panel -->
    <aside id="right-panel">
      <section id="brush-settings"></section>
      <section id="layers-panel"></section>
    </aside>
```

Remove these lines entirely. The brush settings and layers will be rendered inside the FloatingPanel.

- [ ] **Step 3: Remove right panel CSS and update grid**

In `client/style.css`:

Remove the `--panel-width` variable from `:root`.

Change the `#main` grid:
```css
#main {
  display: grid;
  grid-template-columns: var(--toolbar-width) 1fr auto;
  overflow: hidden;
}
```

Remove or comment out the entire `/* -- Right Panel -- */` section:
```css
#right-panel { ... }
#brush-settings, #layers-panel { ... }
#brush-settings { ... }
```

Also remove the responsive `#right-panel` rules from the `@media (max-width: 768px)` block.

Keep the `.panel-label`, `.slider-row`, `.slider-track`, `.slider-fill`, `.layer-item`, and related styles — they're still used inside the floating panel.

- [ ] **Step 4: Build and verify**

Run: `bun build client/app.ts --outdir /tmp/trayce-check --target browser 2>&1`
Expected: Build succeeds (app.ts still references #brush-settings and #layers-panel by ID but they won't exist in HTML — this gets fixed in the next task).

- [ ] **Step 5: Commit**

```bash
git add client/style.css client/index.html
git commit -m "feat(client): add floating panel CSS, remove fixed right panel"
```

---

### Task 7: Wire FloatingPanel into app.ts and toolbar

**Files:**
- Modify: `client/app.ts`
- Modify: `client/toolbar.ts`

- [ ] **Step 1: Add FloatingPanel toggle to toolbar**

In `client/toolbar.ts`, add to `PANEL_BUTTONS` at the beginning of the array:

```typescript
  { id: "floating", icon: "\uD83D\uDD27", title: "Brush & Layers" },
```

Also update the `PanelId` type:

```typescript
export type PanelId = "floating" | "response" | "transcript" | "usage";
```

- [ ] **Step 2: Wire FloatingPanel in app.ts**

In `client/app.ts`, add import:

```typescript
import { FloatingPanel } from "./floating-panel";
```

Add state variable after the other panel declarations:

```typescript
let floatingPanel: FloatingPanel | null = null;
```

In `initUIComponents`, remove the lines that reference `#brush-settings` and `#layers-panel` DOM elements (these no longer exist in the HTML). The BrushSettingsUI and LayersUI will now be mounted into the floating panel.

Replace the brush settings initialization and move it after canvas init. In the `initCanvas` function, after the canvas is created and before the input handler setup, the LayersUI is currently initialized at the `#layers-panel` element. This needs to change to use the floating panel's container.

The key changes to `app.ts`:

1. In `initUIComponents`, create the FloatingPanel and mount it to `#canvas-container`:

```typescript
  // Floating panel (brush + layers)
  floatingPanel = new FloatingPanel({ defaultX: 20, defaultY: 20 });
  floatingPanel.mount(canvasContainer);
```

2. Move BrushSettingsUI creation into `initUIComponents`, mounting to the floating panel's brush container:

```typescript
  const brushContainer = floatingPanel.getBrushContainer();
  if (brushContainer) {
    brushSettingsUI = new BrushSettingsUI(brushContainer, brushParams, {
      onParamsChange: (params) => {
        brushParams = params;
        updateToolInfo();
      },
    });

    // Color picker inside brush tab
    colorPicker = new ColorPicker(brushContainer, {
      onColorChange: (color) => {
        brushParams.color = color;
      },
    });
  }
```

3. In `initCanvas`, change the LayersUI initialization to use the floating panel's layers container instead of `#layers-panel`:

```typescript
  const layersContainer = floatingPanel?.getLayersContainer();
  if (layersContainer) {
    layersUI = new LayersUI(layersContainer, layerManager, { ... });
  }
```

4. In the `onPanelToggle` callback, handle the "floating" panel ID:

```typescript
    onPanelToggle: (panelId) => {
      if (panelId === "floating") {
        floatingPanel?.toggle();
        toolbar?.setPanelActive(floatingPanel?.visible ? "floating" : null);
        return;
      }
      sidePanel?.toggle(panelId);
      toolbar?.setPanelActive(sidePanel?.isOpen ? sidePanel.activeTab : null);
      // ... rest of panel mount logic
    },
```

5. Remove the old references to `document.getElementById("brush-settings")` and `document.getElementById("layers-panel")`.

- [ ] **Step 3: Build and verify**

Run: `bun build client/app.ts --outdir dist/client --minify --target browser && cp client/index.html client/style.css dist/client/`
Expected: Build succeeds.

- [ ] **Step 4: Run the full test suite**

Run: `bun test`
Expected: All tests pass (except pre-existing integration test).

- [ ] **Step 5: Commit**

```bash
git add client/app.ts client/toolbar.ts
git commit -m "feat(client): wire floating panel, move brush/layers from fixed panel"
```

---

### Task 8: Integration test and rebuild

- [ ] **Step 1: Full client build**

Run: `bun build client/app.ts --outdir dist/client --minify --target browser && cp client/index.html client/style.css dist/client/`
Expected: Build succeeds.

- [ ] **Step 2: Restart server**

```bash
kill $(cat /tmp/trayce/state.json | python3 -c "import sys,json; print(json.load(sys.stdin)['pid'])") 2>/dev/null
sleep 1
nohup bun run server/index.ts > /tmp/trayce/server.log 2>&1 &
sleep 2
cat /tmp/trayce/state.json
```

- [ ] **Step 3: Manual verification**

Open the browser with the URL from `state.json`. Verify:

1. **Floating panel:** Brush tab open by default in top-right of canvas. Draggable. Layers tab switches content. Close button hides. Toolbar toggle re-shows. Position persists across reload.
2. **Submit bar:** Two-row layout — status + session on top, prompt + Send button on bottom. Ctrl+Enter submits. Tool/layer info in top bar.
3. **Theme:** Gear icon in top bar. Click opens popover with theme swatches, accent colors, font selector. Selecting any option updates immediately. Persists across reload. No flash on load.
4. **Canvas:** Full width (no right panel stealing 200px). Drawing still works.
5. **Side panel:** Response, Transcript, Usage tabs still work.
