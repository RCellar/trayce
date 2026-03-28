import { describe, it, expect, beforeEach, afterEach, beforeAll } from "bun:test";

// Extract the pure functions we'll add to theme.ts
import { buildFaviconSvg, applyFavicon } from "../../client/theme";

// Minimal DOM mocks for Bun's non-browser test environment
beforeAll(() => {
  // Minimal link element implementation
  const makeLinkEl = () => {
    const attrs: Record<string, string> = {};
    return {
      nodeName: "LINK",
      get rel() { return attrs.rel ?? ""; },
      set rel(v: string) { attrs.rel = v; },
      get type() { return attrs.type ?? ""; },
      set type(v: string) { attrs.type = v; },
      get href() { return attrs.href ?? ""; },
      set href(v: string) { attrs.href = v; },
      remove() { links.splice(links.indexOf(this as any), 1); },
    };
  };

  const links: ReturnType<typeof makeLinkEl>[] = [];

  if (typeof globalThis.document === "undefined") {
    (globalThis as any).document = {
      head: {
        appendChild(el: any) { links.push(el); },
      },
      querySelector(sel: string) {
        if (sel === 'link[rel="icon"]') {
          return links.find((l) => l.rel === "icon") ?? null;
        }
        return null;
      },
      querySelectorAll(sel: string) {
        if (sel === 'link[rel="icon"]') {
          return links.filter((l) => l.rel === "icon");
        }
        return [];
      },
      createElement(tag: string) {
        if (tag === "link") return makeLinkEl();
        throw new Error(`createElement("${tag}") not mocked`);
      },
    };
  }

  if (typeof globalThis.Blob === "undefined") {
    (globalThis as any).Blob = class MockBlob {
      constructor(public parts: string[], public options: object) {}
    };
  }

  let blobCounter = 0;
  if (typeof globalThis.URL === "undefined" || !(globalThis.URL as any).createObjectURL) {
    (globalThis as any).URL = {
      createObjectURL: (_blob: any) => `blob:mock-${++blobCounter}`,
      revokeObjectURL: (_url: string) => {},
    };
  }
});

describe("buildFaviconSvg", () => {
  it("returns valid SVG string with provided colors", () => {
    const svg = buildFaviconSvg("#111", "#4a9eff", "#c9d1d9");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("#111");
    expect(svg).toContain("#4a9eff");
  });

  it("uses default colors when called with no arguments", () => {
    const svg = buildFaviconSvg();
    expect(svg).toContain("<svg");
  });
});

describe("applyFavicon", () => {
  beforeEach(() => {
    // Clean up any existing favicon link
    const existing = document.querySelector('link[rel="icon"]');
    existing?.remove();
  });

  afterEach(() => {
    document.querySelector('link[rel="icon"]')?.remove();
  });

  it("creates a link element in head", () => {
    applyFavicon("<svg></svg>");
    const link = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
    expect(link).toBeTruthy();
    expect(link.type).toBe("image/svg+xml");
    expect(link.href).toContain("blob:");
  });

  it("replaces existing favicon link", () => {
    applyFavicon("<svg>first</svg>");
    const firstHref = (document.querySelector('link[rel="icon"]') as HTMLLinkElement).href;

    applyFavicon("<svg>second</svg>");
    const links = document.querySelectorAll('link[rel="icon"]');
    expect(links.length).toBe(1);
    expect((links[0] as HTMLLinkElement).href).not.toBe(firstHref);
  });
});
