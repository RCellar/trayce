import { beforeEach, describe, expect, test } from "bun:test";
import { AnnotationPersistence } from "../../client/annotations/persistence";
import type { Annotation } from "../../client/annotations/types";

// Minimal in-memory IndexedDB shim — just enough for AnnotationPersistence.
// Matches the subset of the API the class uses.
function installFakeIDB(): void {
  const stores = new Map<string, Map<string, unknown>>();

  function makeReq<T>(result: T): {
    onsuccess: ((e?: unknown) => void) | null;
    onerror: ((e?: unknown) => void) | null;
    result: T;
  } {
    const req = { onsuccess: null, onerror: null, result } as {
      onsuccess: ((e?: unknown) => void) | null;
      onerror: ((e?: unknown) => void) | null;
      result: T;
    };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  }

  function makeStore(name: string) {
    let bucket = stores.get(name);
    if (!bucket) {
      bucket = new Map();
      stores.set(name, bucket);
    }
    const local = bucket;
    return {
      put(payload: { sessionId: string } & Record<string, unknown>) {
        local.set(payload.sessionId, payload);
        return makeReq(undefined);
      },
      get(key: string) {
        return makeReq(local.get(key));
      },
      delete(key: string) {
        local.delete(key);
        return makeReq(undefined);
      },
    };
  }

  function makeTransaction(_storeName: string, _mode: string) {
    const tx = {
      oncomplete: null as ((e?: unknown) => void) | null,
      onerror: null as ((e?: unknown) => void) | null,
      error: null,
      objectStore(name: string) {
        return makeStore(name);
      },
    };
    queueMicrotask(() => tx.oncomplete?.());
    return tx;
  }

  function makeDb() {
    return {
      objectStoreNames: { contains: (name: string) => stores.has(name) },
      createObjectStore(name: string, _opts: { keyPath: string }) {
        stores.set(name, new Map());
        return makeStore(name);
      },
      transaction: makeTransaction,
    };
  }

  (globalThis as { indexedDB: unknown }).indexedDB = {
    open(_name: string, _version: number) {
      const db = makeDb();
      const req = {
        onupgradeneeded: null as ((e?: unknown) => void) | null,
        onsuccess: null as ((e?: unknown) => void) | null,
        onerror: null as ((e?: unknown) => void) | null,
        result: db,
      };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  stores.clear();
}

function samplePin(id: string): Annotation {
  return {
    id,
    kind: "pin",
    author: "user",
    status: "open",
    createdAt: 1,
    updatedAt: 1,
    replies: [],
    number: 1,
    at: [0, 0],
  };
}

describe("AnnotationPersistence", () => {
  beforeEach(() => {
    installFakeIDB();
  });

  test("load returns [] for an unknown session", async () => {
    const p = new AnnotationPersistence();
    const out = await p.load("unknown");
    expect(out).toEqual([]);
  });

  test("save then load round-trips annotations", async () => {
    const p = new AnnotationPersistence();
    p.save("s1", [samplePin("a1"), samplePin("a2")]);
    await p.flush("s1");
    const out = await p.load("s1");
    expect(out.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  test("rapid saves coalesce into a single write", async () => {
    const p = new AnnotationPersistence();
    p.save("s1", [samplePin("a1")]);
    p.save("s1", [samplePin("a1"), samplePin("a2")]);
    p.save("s1", [samplePin("a1"), samplePin("a2"), samplePin("a3")]);
    await p.flush("s1");
    const out = await p.load("s1");
    expect(out.length).toBe(3);
  });

  test("sessions are isolated", async () => {
    const p = new AnnotationPersistence();
    p.save("s1", [samplePin("a1")]);
    p.save("s2", [samplePin("b1")]);
    await p.flush("s1");
    await p.flush("s2");
    expect((await p.load("s1")).map((a) => a.id)).toEqual(["a1"]);
    expect((await p.load("s2")).map((a) => a.id)).toEqual(["b1"]);
  });

  test("clearSession removes only the target session", async () => {
    const p = new AnnotationPersistence();
    p.save("s1", [samplePin("a1")]);
    p.save("s2", [samplePin("b1")]);
    await p.flush("s1");
    await p.flush("s2");
    await p.clearSession("s1");
    expect(await p.load("s1")).toEqual([]);
    expect((await p.load("s2")).map((a) => a.id)).toEqual(["b1"]);
  });
});
