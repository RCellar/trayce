import { describe, expect, it, beforeEach } from "bun:test";
import { SessionRegistry } from "../../server/sessions";

let registry: SessionRegistry;

beforeEach(() => {
  registry = new SessionRegistry();
});

describe("add", () => {
  it("returns a Session with the given id, label, and status active", () => {
    const s = registry.add("id-1", "app");
    expect(s).toEqual({ id: "id-1", label: "app", status: "active" });
  });

  it("stores the session so has() returns true", () => {
    registry.add("id-1", "app");
    expect(registry.has("id-1")).toBe(true);
  });

  it("the returned session matches get()", () => {
    const s = registry.add("id-1", "app");
    expect(registry.get("id-1")).toEqual(s);
  });
});

describe("remove", () => {
  it("removes an existing session", () => {
    registry.add("id-1", "app");
    registry.remove("id-1");
    expect(registry.has("id-1")).toBe(false);
  });

  it("is a no-op for a non-existent id", () => {
    expect(() => registry.remove("ghost")).not.toThrow();
  });

  it("does not affect other sessions", () => {
    registry.add("id-1", "app");
    registry.add("id-2", "other");
    registry.remove("id-1");
    expect(registry.has("id-2")).toBe(true);
  });

  it("after removal the label is available for reuse", () => {
    registry.add("id-1", "app");
    registry.remove("id-1");
    const s = registry.add("id-2", "app");
    expect(s.label).toBe("app");
  });
});

describe("has", () => {
  it("returns false for an id that was never added", () => {
    expect(registry.has("nope")).toBe(false);
  });

  it("returns true for an id that was added", () => {
    registry.add("id-1", "app");
    expect(registry.has("id-1")).toBe(true);
  });

  it("returns false after removal", () => {
    registry.add("id-1", "app");
    registry.remove("id-1");
    expect(registry.has("id-1")).toBe(false);
  });
});

describe("get", () => {
  it("returns undefined for unknown id", () => {
    expect(registry.get("nope")).toBeUndefined();
  });

  it("returns the session for a known id", () => {
    registry.add("id-1", "app");
    const s = registry.get("id-1");
    expect(s?.id).toBe("id-1");
    expect(s?.label).toBe("app");
    expect(s?.status).toBe("active");
  });

  it("returns undefined after removal", () => {
    registry.add("id-1", "app");
    registry.remove("id-1");
    expect(registry.get("id-1")).toBeUndefined();
  });
});

describe("list", () => {
  it("returns empty array when registry is empty", () => {
    expect(registry.list()).toEqual([]);
  });

  it("returns all added sessions", () => {
    registry.add("id-1", "alpha");
    registry.add("id-2", "beta");
    const labels = registry
      .list()
      .map((s) => s.label)
      .sort();
    expect(labels).toEqual(["alpha", "beta"]);
  });

  it("does not include removed sessions", () => {
    registry.add("id-1", "alpha");
    registry.add("id-2", "beta");
    registry.remove("id-1");
    expect(registry.list().length).toBe(1);
    expect(registry.list()[0]!.label).toBe("beta");
  });

  it("returns a snapshot — mutations to the array don't affect the registry", () => {
    registry.add("id-1", "app");
    const snapshot = registry.list();
    snapshot.pop();
    expect(registry.list().length).toBe(1);
  });
});

describe("label deduplication — basic", () => {
  it("first 'app' gets label 'app'", () => {
    expect(registry.add("id-1", "app").label).toBe("app");
  });

  it("second 'app' gets 'app (2)'", () => {
    registry.add("id-1", "app");
    expect(registry.add("id-2", "app").label).toBe("app (2)");
  });

  it("third 'app' gets 'app (3)'", () => {
    registry.add("id-1", "app");
    registry.add("id-2", "app");
    expect(registry.add("id-3", "app").label).toBe("app (3)");
  });

  it("different base labels do not interfere", () => {
    registry.add("id-1", "app");
    expect(registry.add("id-2", "service").label).toBe("service");
  });
});

describe("label deduplication — gap-filling after removal", () => {
  it("removing 'app' frees slot 1; next 'app' reclaims it", () => {
    registry.add("id-1", "app");
    registry.add("id-2", "app");
    registry.add("id-3", "app");
    registry.remove("id-1");
    expect(registry.add("id-4", "app").label).toBe("app");
  });

  it("removing 'app (2)' frees slot 2; next 'app' fills the gap", () => {
    registry.add("id-1", "app");
    registry.add("id-2", "app");
    registry.add("id-3", "app");
    registry.remove("id-2");
    expect(registry.add("id-4", "app").label).toBe("app (2)");
  });

  it("removing all then re-adding restarts from bare label", () => {
    registry.add("id-1", "app");
    registry.add("id-2", "app");
    registry.remove("id-1");
    registry.remove("id-2");
    expect(registry.add("id-3", "app").label).toBe("app");
  });
});

describe("label deduplication — directly registering suffixed labels", () => {
  it("direct 'app (2)' blocks that slot; next 'app' after 'app' skips to 'app (3)'", () => {
    registry.add("id-1", "app (2)");
    registry.add("id-2", "app");
    expect(registry.add("id-3", "app").label).toBe("app (3)");
  });

  it("direct 'app (2)' and 'app (3)' force next 'app' past 'app' to 'app (4)'", () => {
    registry.add("id-1", "app");
    registry.add("id-2", "app (2)");
    registry.add("id-3", "app (3)");
    expect(registry.add("id-4", "app").label).toBe("app (4)");
  });

  it("removing a directly-registered suffix frees that slot", () => {
    registry.add("id-1", "app");
    registry.add("id-2", "app (2)");
    registry.remove("id-2");
    expect(registry.add("id-3", "app").label).toBe("app (2)");
  });

  it("'app (1)' is treated as a distinct base label", () => {
    registry.add("id-1", "app (1)");
    expect(registry.add("id-2", "app (1)").label).toBe("app (1) (2)");
  });
});

describe("label deduplication — many sessions", () => {
  it("handles 10 sessions with the same label", () => {
    for (let i = 1; i <= 10; i++) {
      const s = registry.add(`id-${i}`, "svc");
      const expected = i === 1 ? "svc" : `svc (${i})`;
      expect(s.label).toBe(expected);
    }
  });
});

describe("id uniqueness", () => {
  it("adding a second session with the same id overwrites the first", () => {
    registry.add("id-1", "alpha");
    registry.add("id-1", "beta");
    expect(registry.list().length).toBe(1);
    expect(registry.get("id-1")?.label).toBe("beta");
  });
});
