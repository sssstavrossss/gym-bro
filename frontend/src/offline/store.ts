/**
 * Where the phone keeps the server's last answers, so the app can open and show them offline.
 * IndexedDB in a browser; a Map when IndexedDB is missing (tests, some private windows). A
 * native build can swap in its own store behind the same three calls.
 */
export interface Saved<T> {
  /** When the server sent it, in ms. */
  at: number;
  body: T;
}

export interface OfflineStore {
  get<T>(key: string): Promise<Saved<T> | null>;
  put(key: string, value: Saved<unknown>): Promise<void>;
  /** Removes every key that starts with `prefix`. */
  clear(prefix: string): Promise<void>;
}

const DB_NAME = "gymbro-offline";
const STORE = "responses";

function memoryStore(): OfflineStore {
  const map = new Map<string, Saved<unknown>>();
  return {
    async get<T>(key: string) {
      return (map.get(key) as Saved<T> | undefined) ?? null;
    },
    async put(key, value) {
      map.set(key, value);
    },
    async clear(prefix) {
      for (const key of [...map.keys()]) if (key.startsWith(prefix)) map.delete(key);
    },
  };
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function indexedStore(factory: IDBFactory): OfflineStore {
  let opening: Promise<IDBDatabase> | null = null;
  const db = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error: unknown) => {
      opening = null;
      throw error;
    });
    return opening;
  };
  const store = async (mode: IDBTransactionMode) => (await db()).transaction(STORE, mode).objectStore(STORE);
  return {
    async get<T>(key: string) {
      return ((await done((await store("readonly")).get(key))) as Saved<T> | undefined) ?? null;
    },
    async put(key, value) {
      await done((await store("readwrite")).put(value, key));
    },
    async clear(prefix) {
      await done((await store("readwrite")).delete(IDBKeyRange.bound(prefix, `${prefix}￿`)));
    },
  };
}

/** Never throws: a store that fails behaves like an empty one, and the app falls back to the network. */
function quiet(inner: OfflineStore): OfflineStore {
  return {
    async get<T>(key: string) {
      try { return await inner.get<T>(key); } catch { return null; }
    },
    async put(key, value) {
      try { await inner.put(key, value); } catch { /* full or blocked: the next answer tries again */ }
    },
    async clear(prefix) {
      try { await inner.clear(prefix); } catch { /* nothing to clear */ }
    },
  };
}

export const offlineStore: OfflineStore = quiet(
  typeof indexedDB === "undefined" ? memoryStore() : indexedStore(indexedDB),
);
