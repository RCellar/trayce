import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LockMessage } from "../../client/canvas-lock";
import { CanvasLock } from "../../client/canvas-lock";

// MockBroadcastChannel simulates cross-tab behavior: messages are delivered
// to all OTHER instances registered on the same channel name.
class MockBroadcastChannel {
  static registry: Map<string, MockBroadcastChannel[]> = new Map();

  name: string;
  onmessage: ((event: { data: LockMessage }) => void) | null = null;
  closed = false;

  constructor(name: string) {
    this.name = name;
    if (!MockBroadcastChannel.registry.has(name)) {
      MockBroadcastChannel.registry.set(name, []);
    }
    MockBroadcastChannel.registry.get(name)!.push(this);
  }

  postMessage(data: LockMessage): void {
    if (this.closed) return;
    const peers = MockBroadcastChannel.registry.get(this.name) ?? [];
    for (const peer of peers) {
      if (peer !== this && !peer.closed && peer.onmessage) {
        // Deliver synchronously (simpler for tests; real BC is async but
        // our 100ms query window handles timing)
        peer.onmessage({ data });
      }
    }
  }

  close(): void {
    this.closed = true;
    const peers = MockBroadcastChannel.registry.get(this.name);
    if (peers) {
      const idx = peers.indexOf(this);
      if (idx !== -1) peers.splice(idx, 1);
    }
  }

  static reset(): void {
    MockBroadcastChannel.registry.clear();
  }
}

// Inject the mock before tests run and restore after.
const originalBC = (globalThis as Record<string, unknown>).BroadcastChannel;

beforeEach(() => {
  MockBroadcastChannel.reset();
  (globalThis as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel;
});

afterEach(() => {
  if (originalBC !== undefined) {
    (globalThis as Record<string, unknown>).BroadcastChannel = originalBC;
  } else {
    delete (globalThis as Record<string, unknown>).BroadcastChannel;
  }
});

describe("CanvasLock", () => {
  test("claim succeeds when no other tab holds the session", async () => {
    const lock = new CanvasLock();
    const result = await lock.claim("session-1");
    expect(result).toBe(true);
    expect(lock.heldSession()).toBe("session-1");
    lock.destroy();
  });

  test("claim returns false when another tab holds the session", async () => {
    const lockA = new CanvasLock();
    const lockB = new CanvasLock();

    await lockA.claim("session-1");
    const result = await lockB.claim("session-1");

    expect(result).toBe(false);
    expect(lockB.heldSession()).toBeNull();

    lockA.destroy();
    lockB.destroy();
  });

  test("release makes session available to other tabs", async () => {
    const lockA = new CanvasLock();
    const lockB = new CanvasLock();

    await lockA.claim("session-1");
    lockA.release();

    const result = await lockB.claim("session-1");
    expect(result).toBe(true);
    expect(lockB.heldSession()).toBe("session-1");

    lockA.destroy();
    lockB.destroy();
  });

  test("claiming a new session releases the previous one", async () => {
    const lockA = new CanvasLock();
    const lockB = new CanvasLock();

    await lockA.claim("session-1");
    // Switch lockA to a different session — session-1 should be freed
    await lockA.claim("session-2");

    const result = await lockB.claim("session-1");
    expect(result).toBe(true);

    lockA.destroy();
    lockB.destroy();
  });

  test("claim null (scratchpad) always succeeds without broadcast", async () => {
    const lockA = new CanvasLock();
    const lockB = new CanvasLock();

    // Both tabs claim scratchpad (null) — both should succeed
    const r1 = await lockA.claim(null);
    const r2 = await lockB.claim(null);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    // Scratchpad is not tracked as a held session
    expect(lockA.heldSession()).toBeNull();
    expect(lockB.heldSession()).toBeNull();

    lockA.destroy();
    lockB.destroy();
  });

  test("onEvicted fires when another tab force-claims the held session", async () => {
    const lockA = new CanvasLock();
    const lockB = new CanvasLock();

    await lockA.claim("session-1");

    let evicted = false;
    lockA.onEvicted = () => {
      evicted = true;
    };

    lockB.forceClaim("session-1");

    expect(evicted).toBe(true);
    expect(lockA.heldSession()).toBeNull();

    lockA.destroy();
    lockB.destroy();
  });

  test("destroy cleans up without errors", async () => {
    const lock = new CanvasLock();
    await lock.claim("session-1");
    expect(() => lock.destroy()).not.toThrow();
    expect(lock.heldSession()).toBeNull();
  });

  test("forceClaim releasing old session allows another tab to claim it", async () => {
    const lockA = new CanvasLock();
    const lockB = new CanvasLock();

    // lockA holds session-1
    await lockA.claim("session-1");
    expect(lockA.heldSession()).toBe("session-1");

    // forceClaim session-2 — lockA should release session-1 first
    lockA.forceClaim("session-2");
    expect(lockA.heldSession()).toBe("session-2");

    // session-1 is now free; lockB should be able to claim it
    const result = await lockB.claim("session-1");
    expect(result).toBe(true);
    expect(lockB.heldSession()).toBe("session-1");

    lockA.destroy();
    lockB.destroy();
  });

  test("no-BroadcastChannel path: claim succeeds and throws no errors", async () => {
    // Remove BroadcastChannel from globalThis to simulate environments without it
    const savedBC = (globalThis as Record<string, unknown>).BroadcastChannel;
    delete (globalThis as Record<string, unknown>).BroadcastChannel;

    let lock: CanvasLock | undefined;
    try {
      expect(() => {
        lock = new CanvasLock();
      }).not.toThrow();

      const result = await lock!.claim("session-1");
      expect(result).toBe(true);
    } finally {
      lock?.destroy();
      // Restore whatever was in place before this test (the mock, from beforeEach)
      (globalThis as Record<string, unknown>).BroadcastChannel = savedBC;
    }
  });
});
