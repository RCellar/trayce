export const SCRATCHPAD_KEY = "layers-scratchpad";

export function persistenceKey(sessionId: string): string {
  return `layers-session-${sessionId}`;
}

const DB_NAME = "trayce";
const STORE_NAME = "layers";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface SavedLayer {
  id: string;
  name: string;
  blob: Blob;
  opacity: number;
  blendMode: string;
  visible: boolean;
  locked: boolean;
  deletable: boolean;
  transform?: {
    x: number;
    y: number;
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
  };
}

interface PersistedEntry {
  layers: SavedLayer[];
  lastAccessed: number;
}

export async function saveLayers(key: string, layers: SavedLayer[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const entry: PersistedEntry = { layers, lastAccessed: Date.now() };
  store.put(entry, key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadLayers(key: string): Promise<SavedLayer[] | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const req = store.get(key);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const raw: PersistedEntry | SavedLayer[] | null = req.result ?? null;
      if (raw === null) {
        resolve(null);
        return;
      }

      // Handle both legacy SavedLayer[] format and new PersistedEntry format
      let layers: SavedLayer[];
      if (Array.isArray(raw)) {
        layers = raw;
      } else {
        layers = raw.layers;
      }

      // Touch lastAccessed on read within the same transaction
      const updated: PersistedEntry = { layers, lastAccessed: Date.now() };
      store.put(updated, key);

      tx.oncomplete = () => resolve(layers);
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteLayers(key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.delete(key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function pruneStaleEntries(activeSessionIds: string[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const activeKeys = new Set(activeSessionIds.map(persistenceKey));
  const STALE_TTL_MS = 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - STALE_TTL_MS;

  const req = store.openCursor();
  await new Promise<void>((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      const key = cursor.key as string;
      // Only prune session keys that are not active
      if (key.startsWith("layers-session-") && !activeKeys.has(key)) {
        const value = cursor.value as PersistedEntry | SavedLayer[];
        const lastAccessed = Array.isArray(value) ? 0 : value.lastAccessed;
        if (lastAccessed < cutoff) {
          cursor.delete();
        }
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
