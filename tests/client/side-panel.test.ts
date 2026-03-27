import { describe, expect, test, beforeEach } from "bun:test";
import { SidePanel, type PanelTab } from "../../client/side-panel";

describe("SidePanel — class definition", () => {
  test("SidePanel class is defined", () => {
    expect(SidePanel).toBeDefined();
    expect(typeof SidePanel).toBe("function");
  });

  test("has expected initial state", () => {
    const panel = new SidePanel();
    expect(panel.isOpen).toBe(false);
    expect(panel.activeTab).toBeNull();
  });
});

describe("SidePanel — toggle behavior", () => {
  let panel: SidePanel;

  beforeEach(() => {
    panel = new SidePanel();
  });

  test("toggle opens panel when closed", () => {
    panel.toggle("response");
    expect(panel.isOpen).toBe(true);
    expect(panel.activeTab).toBe("response");
  });

  test("toggle closes panel when same tab is active", () => {
    panel.toggle("response");
    panel.toggle("response");
    expect(panel.isOpen).toBe(false);
    expect(panel.activeTab).toBeNull();
  });

  test("toggle switches tab when different tab is active (stays open)", () => {
    panel.toggle("response");
    expect(panel.isOpen).toBe(true);
    expect(panel.activeTab).toBe("response");

    panel.toggle("transcript");
    expect(panel.isOpen).toBe(true);
    expect(panel.activeTab).toBe("transcript");
  });

  test("toggle transcript opens with transcript tab", () => {
    panel.toggle("transcript");
    expect(panel.isOpen).toBe(true);
    expect(panel.activeTab).toBe("transcript");
  });

  test("toggle transcript when active closes panel", () => {
    panel.toggle("transcript");
    panel.toggle("transcript");
    expect(panel.isOpen).toBe(false);
    expect(panel.activeTab).toBeNull();
  });
});

describe("SidePanel — active tab tracking", () => {
  let panel: SidePanel;

  beforeEach(() => {
    panel = new SidePanel();
  });

  test("starts with null active tab", () => {
    expect(panel.activeTab).toBeNull();
  });

  test("setActiveTab changes tab without toggling", () => {
    panel.toggle("response");
    panel.setActiveTab("transcript");
    expect(panel.activeTab).toBe("transcript");
    expect(panel.isOpen).toBe(true);
  });

  test("tab transitions: null → response → transcript", () => {
    expect(panel.activeTab).toBeNull();

    panel.toggle("response");
    expect(panel.activeTab).toBe("response");

    panel.setActiveTab("transcript");
    expect(panel.activeTab).toBe("transcript");
  });
});

describe("SidePanel — containers (no DOM)", () => {
  test("getResponseContainer returns null before mount", () => {
    const panel = new SidePanel();
    expect(panel.getResponseContainer()).toBeNull();
  });

  test("getTranscriptContainer returns null before mount", () => {
    const panel = new SidePanel();
    expect(panel.getTranscriptContainer()).toBeNull();
  });
});
