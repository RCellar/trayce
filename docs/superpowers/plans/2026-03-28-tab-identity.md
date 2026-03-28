# Tab Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a theme-aware SVG favicon and dynamic tab title reflecting the selected Claude session.

**Architecture:** Two independent changes. The favicon is generated as an SVG blob URL in `ThemeManager`, updated on every theme change and initial load. The tab title is set in `app.ts` from session state, updated on session list changes and dropdown selection.

**Tech Stack:** Vanilla TypeScript, SVG, Blob API, DOM

---

## File Map

- **Modify:** `client/theme.ts` — Add `updateFavicon()` method and SVG generation to `ThemeManager`
- **Modify:** `client/app.ts` — Add `updateTabTitle()` function, call from session handlers
- **Test:** `tests/client/theme-favicon.test.ts` — Unit tests for SVG generation and favicon link management
- **Test:** `tests/client/tab-title.test.ts` — Unit tests for title formatting logic

---

### Task 1: Favicon SVG Generation

**Files:**
- Create: `tests/client/theme-favicon.test.ts`
- Modify: `client/theme.ts`

- [ ] **Step 1: Write failing tests for SVG generation and favicon link**

Create `tests/client/theme-favicon.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// Extract the pure functions we'll add to theme.ts
import { buildFaviconSvg, applyFavicon } from "../../client/theme";

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
  let existingLink: HTMLLinkElement | null = null;

  beforeEach(() => {
    // Clean up any existing favicon link
    existingLink = document.querySelector('link[rel="icon"]');
    existingLink?.remove();
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/theme-favicon.test.ts`
Expected: FAIL — `buildFaviconSvg` and `applyFavicon` are not exported from `client/theme.ts`

- [ ] **Step 3: Add `buildFaviconSvg` and `applyFavicon` exports to theme.ts**

Add these exported functions at the top of `client/theme.ts`, before the `ThemeManager` class:

```ts
/** Build an SVG favicon string using the given theme colors. */
export function buildFaviconSvg(
  bg = "#111",
  accent = "#4a9eff",
  text = "#c9d1d9",
): string {
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
```

The SVG is a stylized "T" stroke on a rounded square — legible at 16x16, uses `bg` for the background, `accent` for the stroke, and `text` for a subtle border.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/client/theme-favicon.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/theme.ts tests/client/theme-favicon.test.ts
git commit -m "feat(client): add SVG favicon generation with theme colors"
```

---

### Task 2: Wire Favicon Into ThemeManager

**Files:**
- Modify: `client/theme.ts`

- [ ] **Step 1: Add `updateFavicon()` call to `applyAndSave()`**

In `client/theme.ts`, modify the `applyAndSave` method to also update the favicon:

```ts
  private applyAndSave(): void {
    const vars = this.buildVars();
    this.apply(vars);
    this.save(vars);
    applyFavicon(buildFaviconSvg(vars["--bg"], vars["--accent"], vars["--text"]));
  }
```

- [ ] **Step 2: Add initial favicon in the constructor**

Modify the `ThemeManager` constructor to apply the favicon on load:

```ts
  constructor() {
    this.load();
    const vars = this.buildVars();
    applyFavicon(buildFaviconSvg(vars["--bg"], vars["--accent"], vars["--text"]));
  }
```

- [ ] **Step 3: Verify favicon appears in the browser**

Run: `bun run build:client && bun run start`
Open the browser URL. Verify:
- Favicon appears in the browser tab
- Changing the theme in the gear menu updates the favicon colors
- Changing the accent color updates the favicon stroke color

- [ ] **Step 4: Commit**

```bash
git add client/theme.ts
git commit -m "feat(client): wire favicon updates into ThemeManager lifecycle"
```

---

### Task 3: Dynamic Tab Title

**Files:**
- Create: `tests/client/tab-title.test.ts`
- Modify: `client/app.ts`

- [ ] **Step 1: Write failing tests for tab title formatting**

Create `tests/client/tab-title.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { formatTabTitle } from "../../client/app";

describe("formatTabTitle", () => {
  it("returns base title when no sessions", () => {
    expect(formatTabTitle([], "")).toBe("trayce");
  });

  it("returns base title when selected session not found", () => {
    const sessions = [{ id: "abc", label: "MediaStack", status: "active" }];
    expect(formatTabTitle(sessions, "nonexistent")).toBe("trayce");
  });

  it("returns title with session label when session is selected", () => {
    const sessions = [{ id: "abc", label: "MediaStack", status: "active" }];
    expect(formatTabTitle(sessions, "abc")).toBe("trayce — MediaStack");
  });

  it("returns title with correct session when multiple exist", () => {
    const sessions = [
      { id: "abc", label: "trayce", status: "active" },
      { id: "def", label: "MediaStack", status: "active" },
    ];
    expect(formatTabTitle(sessions, "def")).toBe("trayce — MediaStack");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/tab-title.test.ts`
Expected: FAIL — `formatTabTitle` is not exported from `client/app.ts`

- [ ] **Step 3: Add `formatTabTitle` export and `updateTabTitle` function**

At the top of `client/app.ts`, after the state declarations (after line ~66), add:

```ts
/** Format the browser tab title based on the selected session. */
export function formatTabTitle(
  sessions: Array<{ id: string; label: string; status: string }>,
  selectedId: string,
): string {
  const session = sessions.find((s) => s.id === selectedId);
  return session ? `trayce \u2014 ${session.label}` : "trayce";
}

function updateTabTitle(): void {
  document.title = formatTabTitle(sessions, selectedSessionId);
}
```

`\u2014` is the em dash character.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/client/tab-title.test.ts`
Expected: PASS

- [ ] **Step 5: Call `updateTabTitle()` from session handlers**

Add `updateTabTitle()` at the end of `updateSessionSelect()` (after line 794, before the closing `}`):

```ts
  updateTabTitle();
```

Add `updateTabTitle()` in the `sessionSelect` change event listener (after the `usageTab?.clear()` call on line 805):

```ts
  updateTabTitle();
```

- [ ] **Step 6: Verify in browser**

Run: `bun run build:client && bun run start`
Open the browser. Verify:
- Tab shows "trayce" when no sessions are connected
- Tab shows "trayce — {label}" when a session connects and is selected
- Changing the session dropdown updates the tab title
- If all sessions disconnect, tab reverts to "trayce"

- [ ] **Step 7: Commit**

```bash
git add client/app.ts tests/client/tab-title.test.ts
git commit -m "feat(client): dynamic tab title reflecting selected session"
```

---

### Task 4: Run Full Test Suite

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass, including the new `theme-favicon` and `tab-title` tests.

- [ ] **Step 2: Fix any failures if needed**

If any existing tests break, investigate and fix. The changes should be non-breaking — `buildFaviconSvg`, `applyFavicon`, and `formatTabTitle` are new exports, and the `ThemeManager` / `updateSessionSelect` changes are additive.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(client): resolve test issues from tab identity changes"
```
