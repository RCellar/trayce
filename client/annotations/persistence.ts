import type { Annotation } from "./types";

const DB_NAME = "trayce-annotations";
const DB_VERSION = 1;
const STORE = "annotations";
const DEBOUNCE_MS = 300;

interface StoredPayload {
  sessionId: string;
  annotations: Annotation[];
  schemaVersion: number;
  version: number;
  updatedAt: number;
}

export class AnnotationPersistence {
  private db: Promise<IDBDatabase> | null = null;
  private pendingSave = new Map<string, { annotations: Annotation[]; timer: number }>();
  private versionCounter = new Map<string, number>();

  private openDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "sessionId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  async load(sessionId: string): Promise<Annotation[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(sessionId);
      req.onsuccess = () => {
        const payload = req.result as StoredPayload | undefined;
        resolve(payload?.annotations ?? []);
      };
      req.onerror = () => reject(req.error);
    });
  }

  save(sessionId: string, annotations: Annotation[]): void {
    const existing = this.pendingSave.get(sessionId);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.flush(sessionId).catch((err) =>
        console.error("[trayce] annotation persistence flush failed:", err),
      );
    }, DEBOUNCE_MS) as unknown as number;
    this.pendingSave.set(sessionId, { annotations, timer });
  }

  async flush(sessionId: string): Promise<void> {
    const pending = this.pendingSave.get(sessionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingSave.delete(sessionId);
    const nextVersion = (this.versionCounter.get(sessionId) ?? 0) + 1;
    this.versionCounter.set(sessionId, nextVersion);
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({
        sessionId,
        annotations: pending.annotations,
        schemaVersion: 1,
        version: nextVersion,
        updatedAt: Date.now(),
      } satisfies StoredPayload);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearSession(sessionId: string): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
