// "Export all data" / "Restore from backup": every saved reaction, the
// reagent lot library and the abbreviation table in one JSON file. Spectrum files are not included
// (they stay in R2). Restoring adds what is missing and never overwrites.
// Backups of the browser-only derived version ("reaction-notebook-backup")
// are read too: their reactions, with supplier labels turned into lots.
import { normalizeAbbr, type AbbrEntry } from '../chem/abbr';
import { normalizeLot, type LotSnapshot, type ReagentLot } from '../chem/lots';
import type { Reaction } from '../chem/stoich';
import { abbrRepo, refreshAbbrs } from './abbrs';
import { apiRepo } from './apiRepo';
import { repo, repoReady } from './index';
import { localRepo } from './localRepo';
import { lotRepo } from './lots';
import { normalizeReaction } from './schema';

export const BACKUP_TAG = 'reaction-info-backup';

interface BackupEntry {
  id: string;
  title: string;
  updatedAt: number;
  reaction: Reaction;
}

export async function exportAll(onProgress?: (done: number, total: number) => void) {
  const list = await repo.list();
  const reactions: BackupEntry[] = [];
  for (const [i, s] of list.entries()) {
    const full = await repo.get(s.id);
    if (full) reactions.push({ id: full.id, title: full.title, updatedAt: full.updatedAt, reaction: full.reaction });
    onProgress?.(i + 1, list.length);
  }
  const lots = await lotRepo.list();
  const abbrs = await abbrRepo.list();
  const data = { app: BACKUP_TAG, version: 1, exportedAt: new Date().toISOString(), reactions, lots, abbrs };
  return {
    blob: new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }),
    reactions: reactions.length,
    lots: lots.length,
    abbrs: abbrs.length,
  };
}

/** The derived version stores supplier labels as `procurement` on components. */
function fromProcurement(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.components)) return raw;
  return {
    ...r,
    components: r.components.map((c) => {
      if (typeof c !== 'object' || c === null) return c;
      const { procurement, ...rest } = c as Record<string, unknown>;
      if (typeof procurement !== 'object' || procurement === null || rest.lot) return rest;
      const p = procurement as Record<string, unknown>;
      const lot: LotSnapshot = {
        supplier: typeof p.supplier === 'string' ? p.supplier : undefined,
        spec: typeof p.specification === 'string' ? p.specification : undefined,
        catalogNumber: typeof p.catalogNumber === 'string' ? p.catalogNumber : undefined,
        lotNumber: typeof p.lotNumber === 'string' ? p.lotNumber : undefined,
      };
      return { ...rest, lot, ...(typeof p.actual === 'string' && !rest.actualNote ? { actualNote: p.actual } : {}) };
    }),
  };
}

function entriesOf(data: Record<string, unknown>): { entries: BackupEntry[]; lots: ReagentLot[]; abbrs: AbbrEntry[] } | null {
  const entries: BackupEntry[] = [];
  const take = (id: unknown, raw: unknown, updatedAt: unknown) => {
    const reaction = normalizeReaction(fromProcurement(raw));
    if (!reaction) return;
    entries.push({
      id: typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : crypto.randomUUID(),
      title: reaction.title,
      updatedAt: typeof updatedAt === 'number' ? updatedAt : Date.now(),
      reaction,
    });
  };
  if (data.app === BACKUP_TAG && Array.isArray(data.reactions)) {
    for (const e of data.reactions as Record<string, unknown>[]) take(e?.id, e?.reaction, e?.updatedAt);
    const lots = Array.isArray(data.lots) ? data.lots.map(normalizeLot).filter((x): x is ReagentLot => !!x) : [];
    const abbrs = Array.isArray(data.abbrs) ? data.abbrs.map(normalizeAbbr).filter((x): x is AbbrEntry => !!x) : [];
    return { entries, lots, abbrs };
  }
  if (data.app === 'reaction-notebook-backup' && typeof data.data === 'object' && data.data) {
    const d = data.data as Record<string, unknown>;
    for (const e of (Array.isArray(d.saved) ? d.saved : []) as Record<string, unknown>[]) {
      take(e?.id, e?.reaction ?? e, e?.updatedAt ?? e?.savedAt);
    }
    return { entries, lots: [], abbrs: [] };
  }
  return null;
}

/** Add reactions, lots and abbreviations from a backup that aren't stored yet (by id). */
export async function restore(text: string): Promise<{ reactions: number; lots: number; abbrs: number } | null> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = entriesOf(data);
  if (!parsed) return null;
  const kind = await repoReady;
  const have = new Set((await repo.list()).map((s) => s.id));
  let reactions = 0;
  for (const e of parsed.entries) {
    if (have.has(e.id)) continue;
    const ok = kind === 'remote' ? await apiRepo.importEntry(e.id, e.reaction) : await localRepo.importEntry(e.id, e.reaction, e.updatedAt);
    if (ok) reactions++;
  }
  const haveLots = new Set((await lotRepo.list()).map((l) => l.id));
  let lots = 0;
  for (const l of parsed.lots) {
    if (haveLots.has(l.id)) continue;
    const { attachments: _a, ...lot } = l;
    await lotRepo.save(lot);
    lots++;
  }
  const haveAbbrs = new Set((await abbrRepo.list()).map((e) => e.id));
  let abbrs = 0;
  for (const e of parsed.abbrs) {
    if (haveAbbrs.has(e.id)) continue;
    await abbrRepo.save(e);
    abbrs++;
  }
  if (abbrs) await refreshAbbrs();
  return { reactions, lots, abbrs };
}
