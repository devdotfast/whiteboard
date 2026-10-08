/**
 * diffr's results kept in this browser (IndexedDB), so opening a comparison again shows its files
 * without fetching, diffing or summarizing them again. Each entry is named by everything its result
 * depends on (the commits, the file, the engine build and its configuration), so nothing in it goes
 * stale; past a limit the entries read longest ago go first.
 */
import type { Diffed, FileEvent } from "./engine/engine.js";

/** What is kept: a file's diff, or its summarized record. */
export type CachedResult = Omit<Diffed, "ms"> | FileEvent;

const DB = "diffr-cache";

const ENTRIES = "entries";

/** Per entry, its size and when it was last read, so totals and eviction need not load results. */
const META = "meta";

const LIMIT = 512 * 1024 * 1024;

interface Meta {
  bytes: number;
  at: number;
}

export interface CacheUsage {
  entries: number;
  /** About this many bytes: results are stored as JSON, counted in characters. */
  bytes: number;
}

const usage: CacheUsage = { entries: 0, bytes: 0 };

const listeners = new Set<() => void>();

const changed = () => listeners.forEach((listener) => listener());

export function cacheUsage(): Readonly<CacheUsage> {
  return usage;
}

export function onCacheChange(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB"));
  });

const committed = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB"));
  });

let opened: Promise<IDBDatabase | undefined> | undefined;

/** The database, with the totals read; none where the browser keeps no storage (private windows). */
function database(): Promise<IDBDatabase | undefined> {
  return (opened ??= (async () => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(ENTRIES);
        request.result.createObjectStore(META);
      };

      const db = await done(request);

      // SAFETY: put writes only Meta to META.
      const metas = (await done(
        db.transaction(META).objectStore(META).getAll(),
      )) as Meta[];

      usage.entries = metas.length;
      usage.bytes = metas.reduce((sum, meta) => sum + meta.bytes, 0);
      changed();

      return db;
    } catch {
      return undefined;
    }
  })());
}

/** Read the totals, for a page that shows them before anything is cached. */
export function loadCacheUsage(): void {
  void database();
}

/** Name an entry by what its result depends on. */
export async function cacheKey(parts: unknown[]): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(parts)),
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function cached<T extends CachedResult>(
  key: string,
): Promise<T | undefined> {
  const db = await database();

  if (!db) return undefined;

  try {
    // SAFETY: cache writes only JSON strings to ENTRIES.
    const json = (await done(
      db.transaction(ENTRIES).objectStore(ENTRIES).get(key),
    )) as string | undefined;

    if (json === undefined) return undefined;
    const transaction = db.transaction(META, "readwrite");
    const meta = transaction.objectStore(META);
    // SAFETY: put writes only Meta to META.
    const entry = (await done(meta.get(key))) as Meta | undefined;

    if (entry) meta.put({ ...entry, at: Date.now() } satisfies Meta, key);

    // SAFETY: put wrote it from a T under this key.
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

export async function cache(key: string, value: CachedResult): Promise<void> {
  const db = await database();

  if (!db) return;
  const json = JSON.stringify(value);

  // One result this large would push out everything else.
  if (json.length > LIMIT / 8) return;

  try {
    const transaction = db.transaction([ENTRIES, META], "readwrite");
    const meta = transaction.objectStore(META);
    // SAFETY: put writes only Meta to META.
    const previous = (await done(meta.get(key))) as Meta | undefined;
    transaction.objectStore(ENTRIES).put(json, key);
    meta.put({ bytes: json.length, at: Date.now() } satisfies Meta, key);
    await committed(transaction);
    usage.entries += previous ? 0 : 1;
    usage.bytes += json.length - (previous?.bytes ?? 0);
  } catch {
    // Out of quota, most likely: the result is still shown, just not kept.
    return;
  }

  if (usage.bytes > LIMIT) await evict(db);
  changed();
}

/** Drop the entries read longest ago until the rest fit in three quarters of the limit. */
async function evict(db: IDBDatabase): Promise<void> {
  const keys = await done(db.transaction(META).objectStore(META).getAllKeys());

  // SAFETY: put writes only Meta to META, in the same order getAllKeys reads the keys.
  const metas = (await done(
    db.transaction(META).objectStore(META).getAll(),
  )) as Meta[];

  const oldest = keys
    .map((key, index) => ({ key, ...metas[index]! }))
    .sort((a, b) => a.at - b.at);

  const transaction = db.transaction([ENTRIES, META], "readwrite");

  for (const { key, bytes } of oldest) {
    if (usage.bytes <= LIMIT * 0.75) break;
    transaction.objectStore(ENTRIES).delete(key);
    transaction.objectStore(META).delete(key);
    usage.entries--;
    usage.bytes -= bytes;
  }

  await committed(transaction);
}

export async function clearCache(): Promise<void> {
  const db = await database();

  if (!db) return;
  const transaction = db.transaction([ENTRIES, META], "readwrite");
  transaction.objectStore(ENTRIES).clear();
  transaction.objectStore(META).clear();
  await committed(transaction);
  usage.entries = 0;
  usage.bytes = 0;
  changed();
}
