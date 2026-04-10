/**
 * Generic localStorage helper with in-memory cache.
 *
 * Avoids repeated JSON.parse/stringify on every read and provides
 * optional debounced writes for high-frequency updates (e.g. streaming tokens).
 */

type Listener<T> = (items: T[]) => void;

export interface StorageHelper<T> {
  /** Read all items (from memory cache, never re-parses unless externally changed) */
  load(): T[];
  /** Overwrite the entire list */
  save(items: T[]): void;
  /** Find a single item */
  find(predicate: (item: T) => boolean): T | undefined;
  /** Insert or update an item by id. Returns the new full list. */
  upsert(item: T, getId: (item: T) => string): T[];
  /** Remove an item by predicate. Returns the new full list. */
  remove(predicate: (item: T) => boolean): T[];
  /** Subscribe to changes (triggered by save/upsert/remove on this instance) */
  subscribe(fn: Listener<T>): () => void;
  /**
   * Schedule a debounced write. The data is updated in-memory immediately
   * but only flushed to localStorage after `ms` milliseconds of inactivity.
   * Ideal for streaming scenarios where tokens arrive every few ms.
   */
  debouncedSave(items: T[], ms?: number): void;
  /** Force-flush any pending debounced write */
  flush(): void;
}

export function createStorageHelper<T>(key: string, fallback: T[] = []): StorageHelper<T> {
  let cache: T[] | null = null;
  let dirty = false;
  const listeners = new Set<Listener<T>>();

  // Debounce state
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingItems: T[] | null = null;

  function parse(): T[] {
    if (cache !== null) return cache;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          cache = parsed;
          return cache;
        }
      }
    } catch { /* ignore */ }
    cache = fallback;
    return cache;
  }

  function persist(items: T[]) {
    cache = items;
    localStorage.setItem(key, JSON.stringify(items));
    notify(items);
  }

  function notify(items: T[]) {
    for (const fn of listeners) {
      try { fn(items); } catch { /* ignore */ }
    }
  }

  function flush() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (pendingItems !== null) {
      persist(pendingItems);
      pendingItems = null;
    }
  }

  return {
    load: parse,

    save(items: T[]) {
      // Cancel any pending debounced write
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
        pendingItems = null;
      }
      persist(items);
    },

    find(predicate) {
      return parse().find(predicate);
    },

    upsert(item, getId) {
      const items = [...parse()];
      const id = getId(item);
      const idx = items.findIndex((entry) => getId(entry) === id);
      if (idx >= 0) items[idx] = item;
      else items.unshift(item);
      persist(items);
      return items;
    },

    remove(predicate) {
      const items = parse().filter((entry) => !predicate(entry));
      persist(items);
      return items;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },

    debouncedSave(items: T[], ms = 500) {
      // Update in-memory cache immediately so reads are always fresh
      cache = items;
      pendingItems = items;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (pendingItems !== null) {
          localStorage.setItem(key, JSON.stringify(pendingItems));
          notify(pendingItems);
          pendingItems = null;
        }
      }, ms);
    },

    flush,
  };
}

/**
 * Group items by recency (今天 / 昨天 / 更早).
 * Replaces the duplicated groupConversations / groupDebates / groupCompares functions.
 */
export function groupByRecency<T>(
  items: T[],
  getTimestamp: (item: T) => number,
  toEntry?: (item: T) => { id: string; title: string },
): { label: string; items: (T extends { id: string; title: string } ? T : { id: string; title: string })[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const sorted = [...items].sort((a, b) => getTimestamp(b) - getTimestamp(a));

  const mapper = toEntry ?? ((item: T) => item as unknown as { id: string; title: string });
  type Entry = ReturnType<typeof mapper>;

  const todayItems: Entry[] = [];
  const yesterdayItems: Entry[] = [];
  const earlierItems: Entry[] = [];

  for (const item of sorted) {
    const ts = getTimestamp(item);
    const entry = mapper(item);
    if (ts >= todayStart) todayItems.push(entry);
    else if (ts >= yesterdayStart) yesterdayItems.push(entry);
    else earlierItems.push(entry);
  }

  const groups: { label: string; items: Entry[] }[] = [];
  if (todayItems.length) groups.push({ label: "今天", items: todayItems });
  if (yesterdayItems.length) groups.push({ label: "昨天", items: yesterdayItems });
  if (earlierItems.length) groups.push({ label: "更早", items: earlierItems });
  return groups as any;
}
