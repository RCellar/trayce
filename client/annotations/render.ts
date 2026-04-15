import { Container, Graphics, Text } from "pixi.js";
import type { AnnotationRegistry } from "./registry";
import type { Annotation, AnnotationStatus } from "./types";

// Status-meaning colors (addressed/rejected/needs-clarification) stay fixed
// because they communicate semantic state. Only the `open` color follows the
// theme accent, since "open" is the neutral default state and should match
// the rest of the UI.
const FIXED_STATUS_COLORS: Record<Exclude<AnnotationStatus, "open">, number> = {
  addressed: 0x059669,
  "needs-clarification": 0xd97706,
  rejected: 0x6b7280,
  deleted: 0x000000, // unreachable — deleted items aren't drawn
};

const FALLBACK_OPEN_HEX = "#dc2626";

function parseHexColor(hex: string): number {
  const trimmed = hex.trim().replace(/^#/, "");
  if (trimmed.length !== 6 && trimmed.length !== 3) return 0xdc2626;
  const expanded =
    trimmed.length === 3
      ? trimmed
          .split("")
          .map((c) => c + c)
          .join("")
      : trimmed;
  const n = Number.parseInt(expanded, 16);
  return Number.isFinite(n) ? n : 0xdc2626;
}

function readThemeAccentHex(): string {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return FALLBACK_OPEN_HEX;
  }
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return raw || FALLBACK_OPEN_HEX;
  } catch {
    return FALLBACK_OPEN_HEX;
  }
}

function colorForStatus(status: AnnotationStatus): number {
  if (status === "open") return parseHexColor(readThemeAccentHex());
  return FIXED_STATUS_COLORS[status];
}

export class AnnotationRenderer {
  private inner: Container | null = null;
  private drawn = new Map<string, { root: Container; isClaude: boolean }>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly parent: Container,
    private readonly registry: AnnotationRegistry,
  ) {}

  private themeListener: (() => void) | null = null;

  mount(): void {
    this.inner = new Container();
    this.parent.addChild(this.inner);
    this.unsubscribe = this.registry.subscribe(() => this.sync());
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      this.themeListener = () => this.sync();
      document.addEventListener("trayce:theme-changed", this.themeListener);
    }
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (
      this.themeListener &&
      typeof document !== "undefined" &&
      typeof document.removeEventListener === "function"
    ) {
      document.removeEventListener("trayce:theme-changed", this.themeListener);
    }
    this.themeListener = null;
    if (this.inner && this.parent.removeChild) {
      this.parent.removeChild(this.inner);
    }
    this.inner = null;
    this.drawn.clear();
  }

  container(): Container {
    if (!this.inner) throw new Error("AnnotationRenderer not mounted");
    return this.inner;
  }

  visibleCount(): number {
    return this.drawn.size;
  }

  isClaudeAuthored(id: string): boolean {
    return this.drawn.get(id)?.isClaude ?? false;
  }

  sync(): void {
    if (!this.inner) return;
    const visible = new Map(this.registry.visible().map((a) => [a.id, a]));

    // Remove disappeared annotations
    for (const [id, entry] of this.drawn) {
      if (!visible.has(id)) {
        this.inner.removeChild(entry.root);
        entry.root.destroy({ children: true });
        this.drawn.delete(id);
      }
    }

    // Add new / update existing
    for (const [id, a] of visible) {
      const existing = this.drawn.get(id);
      if (existing) {
        // Simple strategy: destroy and recreate on any change. Cheap enough
        // for typical annotation counts (<100) and avoids diffing complexity.
        this.inner.removeChild(existing.root);
        existing.root.destroy({ children: true });
      }
      const root = this.drawOne(a);
      this.inner.addChild(root);
      this.drawn.set(id, { root, isClaude: a.author === "claude" });
    }
  }

  private drawOne(a: Annotation): Container {
    const color = colorForStatus(a.status);
    const root = new Container();

    if (a.kind === "pin") {
      const g = new Graphics();
      g.circle(0, 0, 11).fill({ color });
      g.x = a.at[0];
      g.y = a.at[1];
      root.addChild(g);

      const label = new Text({
        text: String(a.number),
        style: { fill: 0xffffff, fontSize: 12, fontWeight: "bold" },
      });
      label.anchor?.set?.(0.5, 0.5);
      label.x = a.at[0];
      label.y = a.at[1];
      root.addChild(label);
    } else if (a.kind === "text") {
      const t = new Text({
        text: a.text,
        style: { fill: color, fontSize: a.style.fontSize, fontWeight: a.style.weight },
      });
      t.x = a.bbox[0];
      t.y = a.bbox[1];
      root.addChild(t);
    } else {
      // callout
      const g = new Graphics();
      g.roundRect(a.bbox[0], a.bbox[1], a.bbox[2], a.bbox[3], 4)
        .fill({ color, alpha: 0.12 })
        .stroke({ color, width: 1.5 });

      const labelCenterX = a.bbox[0] + a.bbox[2] / 2;
      const labelCenterY = a.bbox[1] + a.bbox[3] / 2;
      g.moveTo(labelCenterX, labelCenterY)
        .lineTo(a.target[0], a.target[1])
        .stroke({ color, width: 1.5 });
      g.circle(a.target[0], a.target[1], 3).fill({ color });
      root.addChild(g);

      const t = new Text({
        text: a.text,
        style: { fill: color, fontSize: a.style.fontSize },
      });
      t.x = a.bbox[0] + 4;
      t.y = a.bbox[1] + 4;
      root.addChild(t);
    }

    if (a.author === "claude") {
      // Translucent outer ring as "from Claude" marker plus a small ✨ glyph.
      // (PixiJS stroke doesn't support true dashes without plugins, so we use
      // a translucent ring as the visual distinction instead.)
      const ring = new Graphics();
      if (a.kind === "pin") {
        ring.circle(a.at[0], a.at[1], 14).stroke({ color, width: 1.5, alpha: 0.6 });
      } else if (a.kind === "text") {
        ring
          .rect(a.bbox[0] - 2, a.bbox[1] - 2, a.bbox[2] + 4, a.bbox[3] + 4)
          .stroke({ color, width: 1.5, alpha: 0.6 });
      } else {
        ring
          .roundRect(a.bbox[0] - 2, a.bbox[1] - 2, a.bbox[2] + 4, a.bbox[3] + 4, 5)
          .stroke({ color, width: 1.5, alpha: 0.6 });
      }
      root.addChild(ring);

      const sparkle = new Text({ text: "✨", style: { fontSize: 10 } });
      sparkle.x = (a.kind === "pin" ? a.at[0] : a.bbox[0]) - 14;
      sparkle.y = (a.kind === "pin" ? a.at[1] : a.bbox[1]) - 14;
      root.addChild(sparkle);
    }

    return root;
  }
}
