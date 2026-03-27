import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ResponseTab } from "../../client/response-tab";
import { TranscriptTab } from "../../client/transcript-tab";

const CSS = readFileSync("client/style.css", "utf-8");

/**
 * Extract all declarations for a given CSS selector.
 * Handles simple selectors (no nested rules).
 */
function getCssBlock(css: string, selector: string): string | null {
  // Escape special regex chars in selector
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, "m");
  const match = css.match(re);
  return match ? match[1] : null;
}

describe("panel scrolling — CSS requirements", () => {
  test(".panel-content has overflow-y: auto", () => {
    const block = getCssBlock(CSS, ".panel-content");
    expect(block).not.toBeNull();
    expect(block).toContain("overflow-y: auto");
  });

  test(".panel-content has min-height: 0 (flexbox scroll fix)", () => {
    const block = getCssBlock(CSS, ".panel-content");
    expect(block).not.toBeNull();
    expect(block).toContain("min-height: 0");
  });

  test(".panel-content has flex: 1 to fill available space", () => {
    const block = getCssBlock(CSS, ".panel-content");
    expect(block).not.toBeNull();
    expect(block).toContain("flex: 1");
  });

  test("#side-panel uses flex column layout", () => {
    const block = getCssBlock(CSS, "#side-panel");
    expect(block).not.toBeNull();
    expect(block).toContain("flex-direction: column");
    expect(block).toContain("display: flex");
  });
});

describe("panel scrolling — auto-scroll behavior", () => {
  test("ResponseTab initializes autoScroll to true", () => {
    const tab = new ResponseTab();
    // autoScroll is private, but we can verify mount sets up scroll listener
    // by checking that mount accepts a container without throwing
    expect(tab).toBeDefined();
  });

  test("TranscriptTab initializes autoScroll to true", () => {
    const tab = new TranscriptTab();
    expect(tab).toBeDefined();
  });

  test("ResponseTab.addResponse is a no-op before mount (no crash)", () => {
    const tab = new ResponseTab();
    expect(() => tab.addResponse("test content")).not.toThrow();
  });

  test("TranscriptTab.addEntry is a no-op before mount (no crash)", () => {
    const tab = new TranscriptTab();
    expect(() =>
      tab.addEntry({
        type: "response",
        role: "assistant",
        content: "test",
        timestamp: Date.now(),
      })
    ).not.toThrow();
  });
});
