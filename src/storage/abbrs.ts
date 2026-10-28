// Abbreviation table: on the server (/api/abbrs) when available, else in this
// browser — same choice as saved reactions. One shared, cached copy for the
// page; every change is also pushed to chem/abbr so drawing and equation
// parsing see it.
import { useEffect, useSyncExternalStore } from 'react';
import type { MainModule } from '@rdkit/rdkit';
import { entryFor, normalizeAbbr, sameCompound, setAbbrTable, type AbbrEntry } from '../chem/abbr';
import type { Component } from '../chem/stoich';
import { newId } from './ids';
import { repoReady } from './index';

export interface AbbrRepo {
  list(): Promise<AbbrEntry[]>;
  /** Create or replace. */
  save(e: AbbrEntry): Promise<AbbrEntry>;
  remove(id: string): Promise<void>;
}

const KEY = 'abbreviations-v1';
const valid = (list: unknown[]) => list.map(normalizeAbbr).filter((x): x is AbbrEntry => !!x);

function readLocal(): AbbrEntry[] {
  try {
    return valid((JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[]) ?? []);
  } catch {
    return [];
  }
}
const writeLocal = (list: AbbrEntry[]) => localStorage.setItem(KEY, JSON.stringify(list));

export const localAbbrs: AbbrRepo = {
  async list() {
    return readLocal();
  },
  async save(e) {
    const all = readLocal();
    const prev = all.find((x) => x.id === e.id);
    const next = { ...e, createdAt: prev?.createdAt ?? e.createdAt, updatedAt: Date.now() };
    writeLocal([next, ...all.filter((x) => x.id !== e.id)]);
    return next;
  },
  async remove(id) {
    writeLocal(readLocal().filter((x) => x.id !== id));
  },
};

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers }, credentials: 'same-origin' });
  const body = res.status === 204 ? (undefined as T) : ((await res.json().catch(() => null)) as T);
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
  return { status: res.status, body };
}

const one = (x: unknown) => {
  const e = normalizeAbbr(x);
  if (!e) throw new Error('invalid abbreviation from server');
  return e;
};

export const apiAbbrs: AbbrRepo = {
  async list() {
    const { body } = await call<unknown[]>('/api/abbrs');
    return valid(body ?? []);
  },
  async save(e) {
    const put = await call<unknown>(`/api/abbrs/${encodeURIComponent(e.id)}`, { method: 'PUT', body: JSON.stringify({ entry: e }) });
    if (put.status !== 404) return one(put.body);
    const post = await call<unknown>('/api/abbrs', { method: 'POST', body: JSON.stringify({ entry: e }) });
    if (post.status === 404) throw new Error('HTTP 404');
    return one(post.body);
  },
  async remove(id) {
    await call<void>(`/api/abbrs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

const pick = () => repoReady.then((k) => (k === 'remote' ? apiAbbrs : localAbbrs));

export const abbrRepo: AbbrRepo = {
  list: () => pick().then((r) => r.list()),
  save: (e) => pick().then((r) => r.save(e)),
  remove: (id) => pick().then((r) => r.remove(id)),
};

// ---- shared cached copy ----

let entries: AbbrEntry[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const set = (list: AbbrEntry[]) => {
  entries = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  setAbbrTable(entries);
  listeners.forEach((f) => f());
};

export function refreshAbbrs(): Promise<void> {
  loading = abbrRepo.list().then(set, () => set(entries ?? []));
  return loading;
}

export async function saveAbbr(e: AbbrEntry): Promise<AbbrEntry> {
  const saved = await abbrRepo.save(e);
  set([saved, ...(entries ?? []).filter((x) => x.id !== saved.id)]);
  return saved;
}

export async function removeAbbr(id: string) {
  await abbrRepo.remove(id);
  set((entries ?? []).filter((x) => x.id !== id));
}

/**
 * Give a compound an abbreviation in the table (updating its entry, or `self`).
 * When another compound already has the abbreviation, `ask` decides whether it
 * moves to this one; returns null when that is declined.
 */
export async function assignAbbr(
  rd: MainModule | null,
  c: Pick<Component, 'name' | 'smiles' | 'cas' | 'formula' | 'mw'>,
  abbr: string,
  ask: (other: AbbrEntry) => boolean,
  self?: AbbrEntry,
): Promise<AbbrEntry | null> {
  const list = entries ?? [];
  const own = self ?? entryFor(rd, c, list);
  const other = list.find((e) => e.abbr === abbr && e.id !== own?.id && !sameCompound(rd, e, c));
  if (other && !ask(other)) return null;
  const now = Date.now();
  const saved = await saveAbbr({
    id: own?.id ?? newId(),
    abbr,
    name: c.name,
    smiles: c.smiles,
    cas: c.cas,
    formula: c.formula,
    mw: c.mw,
    note: own?.note,
    createdAt: own?.createdAt ?? now,
    updatedAt: now,
  });
  if (other) await removeAbbr(other.id);
  return saved;
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

/** The abbreviation table (null while loading the first time). */
export function useAbbrs(): AbbrEntry[] | null {
  const value = useSyncExternalStore(subscribe, () => entries);
  useEffect(() => {
    if (!entries && !loading) refreshAbbrs();
  }, []);
  return value;
}
