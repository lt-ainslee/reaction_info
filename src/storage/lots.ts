// Reagent lot library: on the server (/api/lots) when available, else in this
// browser. Same choice as saved reactions (see index.ts).
import { normalizeLot, type ReagentLot } from '../chem/lots';
import { repoReady } from './index';

export interface LotRepo {
  /** Lots of one compound (by compoundKey), or all; most recently updated first. */
  list(key?: string): Promise<ReagentLot[]>;
  /** Create or replace. */
  save(lot: ReagentLot): Promise<ReagentLot>;
  remove(id: string): Promise<void>;
}

const KEY = 'reagent-lots-v1';

function readLocal(): ReagentLot[] {
  try {
    return ((JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[]) ?? []).map(normalizeLot).filter((x): x is ReagentLot => !!x);
  } catch {
    return [];
  }
}

const writeLocal = (list: ReagentLot[]) => localStorage.setItem(KEY, JSON.stringify(list));

export const localLots: LotRepo = {
  async list(key) {
    return readLocal()
      .filter((l) => !key || l.key === key)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async save(lot) {
    const all = readLocal();
    const prev = all.find((l) => l.id === lot.id);
    const next = { ...lot, createdAt: prev?.createdAt ?? lot.createdAt ?? Date.now(), updatedAt: Date.now() };
    writeLocal([next, ...all.filter((l) => l.id !== lot.id)]);
    return next;
  },
  async remove(id) {
    writeLocal(readLocal().filter((l) => l.id !== id));
  },
};

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers }, credentials: 'same-origin' });
  const body = res.status === 204 ? (undefined as T) : ((await res.json().catch(() => null)) as T);
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
  return { status: res.status, body };
}

const valid = (x: unknown) => {
  const l = normalizeLot(x);
  if (!l) throw new Error('invalid lot from server');
  return l;
};

export const apiLots: LotRepo = {
  async list(key) {
    const { body } = await call<unknown[]>(`/api/lots${key ? `?key=${encodeURIComponent(key)}` : ''}`);
    return (body ?? []).map(normalizeLot).filter((x): x is ReagentLot => !!x);
  },
  async save(lot) {
    const put = await call<unknown>(`/api/lots/${encodeURIComponent(lot.id)}`, { method: 'PUT', body: JSON.stringify({ lot }) });
    if (put.status !== 404) return valid(put.body);
    const post = await call<unknown>('/api/lots', { method: 'POST', body: JSON.stringify({ lot }) });
    if (post.status === 404) throw new Error('HTTP 404');
    return valid(post.body);
  },
  async remove(id) {
    await call<void>(`/api/lots/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

const pick = () => repoReady.then((k) => (k === 'remote' ? apiLots : localLots));

export const lotRepo: LotRepo = {
  list: (key) => pick().then((r) => r.list(key)),
  save: (lot) => pick().then((r) => r.save(lot)),
  remove: (id) => pick().then((r) => r.remove(id)),
};
