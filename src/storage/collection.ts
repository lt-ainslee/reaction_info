// A small library of records (reagent lots, abbreviations) kept on the server
// when /api is reachable, else in this browser — the same choice as saved
// reactions (see index.ts) — plus one shared, cached copy for the page.
import { useEffect, useSyncExternalStore } from 'react';
import { api, isStatus } from './http';
import { repoReady } from './index';

export interface Item {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface Repo<T extends Item> {
  /** Most recently updated first. */
  list(): Promise<T[]>;
  /** Create or replace; `replaces` is deleted in the same step (server: one transaction). */
  save(x: T, replaces?: string): Promise<T>;
  remove(id: string): Promise<void>;
}

export interface CollectionOptions<T extends Item> {
  /** localStorage key. */
  localKey: string;
  /** API collection path, e.g. "/api/lots". */
  path: string;
  /** Request body field holding the record ({ lot } / { entry }). */
  field: string;
  /** Validate data from storage or the server; null drops it. */
  normalize: (raw: unknown) => T | null;
  /** Called with the cached list whenever it changes. */
  onChange?: (list: T[]) => void;
  /** Combine a saved record with the cached one (e.g. keep counts the server adds). */
  merge?: (next: T, prev: T | undefined) => T;
}

const newestFirst = <T extends Item>(list: T[]) => [...list].sort((a, b) => b.updatedAt - a.updatedAt);

export function createCollection<T extends Item>(o: CollectionOptions<T>) {
  const valid = (list: unknown) => (Array.isArray(list) ? list : []).map(o.normalize).filter((x): x is T => !!x);
  const one = (raw: unknown) => {
    const x = o.normalize(raw);
    if (!x) throw new Error(`invalid record from ${o.path}`);
    return x;
  };

  // ---- this browser ----
  const read = (): T[] => {
    try {
      return valid(JSON.parse(localStorage.getItem(o.localKey) ?? '[]'));
    } catch {
      return [];
    }
  };
  const write = (list: T[]) => localStorage.setItem(o.localKey, JSON.stringify(list));
  const local: Repo<T> = {
    async list() {
      return newestFirst(read());
    },
    async save(x, replaces) {
      const all = read();
      const prev = all.find((y) => y.id === x.id);
      const next = { ...x, createdAt: prev?.createdAt ?? x.createdAt ?? Date.now(), updatedAt: Date.now() };
      write([next, ...all.filter((y) => y.id !== x.id && y.id !== replaces)]);
      return next;
    },
    async remove(id) {
      write(read().filter((y) => y.id !== id));
    },
  };

  // ---- the server ----
  const item = (id: string) => `${o.path}/${encodeURIComponent(id)}`;
  const remote: Repo<T> = {
    async list() {
      return valid(await api<unknown[]>(o.path));
    },
    async save(x, replaces) {
      const body = JSON.stringify({ [o.field]: x, ...(replaces ? { replaces } : {}) });
      try {
        return one(await api(item(x.id), { method: 'PUT', body }));
      } catch (e) {
        if (!isStatus(e, 404)) throw e;
      }
      // Not on the server yet.
      return one(await api(o.path, { method: 'POST', body }));
    },
    async remove(id) {
      await api<void>(item(id), { method: 'DELETE' });
    },
  };

  const pick = () => repoReady.then((k) => (k === 'remote' ? remote : local));
  const repo: Repo<T> = {
    list: () => pick().then((r) => r.list()),
    save: (x, replaces) => pick().then((r) => r.save(x, replaces)),
    remove: (id) => pick().then((r) => r.remove(id)),
  };

  // ---- shared cached copy ----
  let cached: T[] | null = null;
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const set = (list: T[]) => {
    cached = newestFirst(list);
    o.onChange?.(cached);
    listeners.forEach((f) => f());
  };
  const subscribe = (f: () => void) => {
    listeners.add(f);
    return () => listeners.delete(f);
  };
  const refresh = (): Promise<void> => {
    loading = repo.list().then(set, () => set(cached ?? []));
    return loading;
  };

  return {
    /** Direct storage access (backup / restore). */
    repo,
    local,
    remote,
    /** Reload the cached list. */
    refresh,
    /** The cached list right now (null before the first load). */
    current: () => cached,
    /** Save and update the cached list. */
    async save(x: T, replaces?: string): Promise<T> {
      const saved = await repo.save(x, replaces);
      const prev = cached?.find((y) => y.id === saved.id);
      const next = o.merge ? o.merge(saved, prev) : saved;
      set([next, ...(cached ?? []).filter((y) => y.id !== saved.id && y.id !== replaces)]);
      return next;
    },
    /** Delete and update the cached list. */
    async remove(id: string): Promise<void> {
      await repo.remove(id);
      set((cached ?? []).filter((y) => y.id !== id));
    },
    /** The cached list in a component (null while loading the first time). */
    useAll(): T[] | null {
      const value = useSyncExternalStore(subscribe, () => cached);
      useEffect(() => {
        if (!cached && !loading) void refresh();
      }, []);
      return value;
    },
  };
}
