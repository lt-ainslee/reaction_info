// One row of the abbreviation table (shared with the Worker: no browser deps).

export interface AbbrEntry {
  id: string;
  abbr: string;
  /** The compound: name and whatever identifies it (structure / CAS). */
  name: string;
  smiles?: string;
  cas?: string;
  formula?: string;
  mw?: number;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function normalizeAbbr(raw: unknown): AbbrEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const abbr = str(r.abbr);
  const name = str(r.name);
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.id) || !abbr || !name || abbr.length > 40) return null;
  const now = Date.now();
  return {
    id: r.id,
    abbr,
    name,
    smiles: str(r.smiles),
    cas: str(r.cas),
    formula: str(r.formula),
    mw: num(r.mw),
    note: str(r.note),
    createdAt: num(r.createdAt) ?? now,
    updatedAt: num(r.updatedAt) ?? now,
  };
}
