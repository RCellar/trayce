import { beforeEach, describe, expect, test } from "bun:test";
import { AnnotationsTab } from "../../client/annotations/panel-tab";
import { AnnotationRegistry } from "../../client/annotations/registry";

// Use a minimal DOM shim via globalThis.document if bun-test environment
// lacks it; trayce's tests have historically relied on real DOM via Playwright
// for e2e. For unit tests here, stub the needed surface.

function setupDOM(): HTMLElement {
  // Bun test runner supports DOM via --preload or via a happy-dom package.
  // If document is undefined, install a minimal stub.
  if (typeof document === "undefined") {
    // Track elements appended to head/body so querySelector can find them.
    const headChildren: any[] = [];
    const bodyChildren: any[] = [];

    const stubElement = (tag = "DIV") => {
      const el: any = {
        tagName: tag.toUpperCase(),
        children: [] as any[],
        style: { cssText: "", display: "" },
        className: "",
        classList: { add: () => {}, remove: () => {}, toggle: () => {} },
        textContent: "",
        dataset: {},
        rel: "",
        type: "",
        href: "",
        download: "",
        appendChild(c: any) {
          el.children.push(c);
          c.parentElement = el;
          return c;
        },
        append(...cs: any[]) {
          for (const c of cs) el.children.push(c);
        },
        removeChild(c: any) {
          const i = el.children.indexOf(c);
          if (i >= 0) el.children.splice(i, 1);
        },
        remove() {
          const parent = el.parentElement;
          if (!parent) return;
          const i = parent.children.indexOf(el);
          if (i >= 0) parent.children.splice(i, 1);
          // Also remove from tracked arrays
          const hi = headChildren.indexOf(el);
          if (hi >= 0) headChildren.splice(hi, 1);
          const bi = bodyChildren.indexOf(el);
          if (bi >= 0) bodyChildren.splice(bi, 1);
        },
        insertAdjacentElement() {},
        addEventListener() {},
        removeEventListener() {},
        setAttribute(k: string, v: string) {
          el[k] = v;
        },
        click() {},
        querySelectorAll: () => [] as any[],
        querySelector: () => null,
      };
      return el;
    };

    const headEl = stubElement("HEAD");
    headEl.appendChild = (c: any) => {
      headChildren.push(c);
      c.parentElement = headEl;
      return c;
    };
    headEl.removeChild = (c: any) => {
      const i = headChildren.indexOf(c);
      if (i >= 0) headChildren.splice(i, 1);
    };

    const bodyEl = stubElement("BODY");
    bodyEl.appendChild = (c: any) => {
      bodyChildren.push(c);
      c.parentElement = bodyEl;
      return c;
    };
    bodyEl.removeChild = (c: any) => {
      const i = bodyChildren.indexOf(c);
      if (i >= 0) bodyChildren.splice(i, 1);
    };

    const matchesSelector = (el: any, sel: string): boolean => {
      // Very minimal: handle 'link[rel="icon"]' pattern
      const m = sel.match(/^(\w+)(?:\[(\w+)="([^"]+)"\])?$/);
      if (!m) return false;
      const [, tag, attr, val] = m;
      if (tag && el.tagName?.toLowerCase() !== tag.toLowerCase()) return false;
      if (attr && val && el[attr] !== val) return false;
      return true;
    };

    const querySelectorImpl = (sel: string): any => {
      for (const el of [...headChildren, ...bodyChildren]) {
        if (matchesSelector(el, sel)) return el;
      }
      return null;
    };

    const querySelectorAllImpl = (sel: string): any[] => {
      return [...headChildren, ...bodyChildren].filter((el) => matchesSelector(el, sel));
    };

    const doc: any = {
      createElement: (tag: string) => stubElement(tag),
      createTextNode: (text: string) => ({ textContent: text, nodeType: 3 }),
      body: bodyEl,
      head: headEl,
      querySelector: querySelectorImpl,
      querySelectorAll: querySelectorAllImpl,
    };
    (globalThis as any).document = doc;
    (globalThis as any).HTMLInputElement = class {};
    (globalThis as any).HTMLTextAreaElement = class {};
    (globalThis as any).HTMLSelectElement = class {};
    (globalThis as any).HTMLElement = class {};

    // Stub Blob and URL if needed (for exportJSON)
    if (typeof (globalThis as any).Blob === "undefined") {
      (globalThis as any).Blob = class MockBlob {
        constructor(
          public parts: string[],
          public options: object,
        ) {}
      };
    }
    if (
      typeof (globalThis as any).URL === "undefined" ||
      !(globalThis as any).URL.createObjectURL
    ) {
      (globalThis as any).URL = {
        createObjectURL: (_blob: any) => "blob:mock-url",
        revokeObjectURL: (_url: string) => {},
      };
    }
  }
  return document.createElement("div") as HTMLElement;
}

describe("AnnotationsTab", () => {
  let container: HTMLElement;
  let registry: AnnotationRegistry;
  let tab: AnnotationsTab;
  let rowClicks: string[];

  beforeEach(() => {
    container = setupDOM();
    registry = new AnnotationRegistry();
    rowClicks = [];
    tab = new AnnotationsTab(registry, (id) => rowClicks.push(id));
    tab.mount(container);
  });

  test("mount attaches header + list to container", () => {
    expect(container.children.length).toBeGreaterThan(0);
  });

  test("adding an annotation causes a render", () => {
    registry.createPin({ at: [10, 10] });
    const rowCount = tab.rowCount();
    expect(rowCount).toBe(1);
  });

  test("soft-deleted annotations disappear from the list", () => {
    const p = registry.createPin({ at: [10, 10] });
    expect(tab.rowCount()).toBe(1);
    registry.softDelete(p.id);
    expect(tab.rowCount()).toBe(0);
  });

  test("clearResolved button removes addressed/rejected/deleted", () => {
    const p1 = registry.createPin({ at: [0, 0] });
    const p2 = registry.createPin({ at: [0, 0] });
    registry.applyUpdate({ id: p1.id, status: "addressed" });
    registry.softDelete(p2.id);
    tab.clickClearResolved();
    expect(registry.all().length).toBe(0);
  });
});
