// Abbreviation table: on the server (/api/abbrs) when available, else in this
// browser (see collection.ts). Every change is also pushed to chem/abbr so
// drawing and equation parsing see it.
import type { MainModule } from '@rdkit/rdkit';
import { entryFor, normalizeAbbr, sameCompound, setAbbrTable, type AbbrEntry } from '../chem/abbr';
import type { Component } from '../chem/stoich';
import { createCollection } from './collection';
import { isStatus } from './http';
import { newId } from './ids';

const abbrs = createCollection<AbbrEntry>({
  localKey: 'abbreviations-v1',
  path: '/api/abbrs',
  field: 'entry',
  normalize: normalizeAbbr,
  onChange: setAbbrTable,
});

/** Direct storage access (no cache): backup and restore. */
export const abbrRepo = abbrs.repo;
export const refreshAbbrs = abbrs.refresh;
export const saveAbbr = (e: AbbrEntry) => abbrs.save(e);
export const removeAbbr = abbrs.remove;
/** The abbreviation table (null while loading the first time). */
export const useAbbrs = abbrs.useAll;

/** The abbreviation was taken by another compound on the server in the meantime. */
export class AbbrTakenError extends Error {
  constructor(readonly abbr: string) {
    super('abbr_taken');
    this.name = 'AbbrTakenError';
  }
}

/**
 * Give a compound an abbreviation in the table (updating its entry, or `self`).
 * When another compound already has the abbreviation, `ask` decides whether it
 * moves to this one (their entry is deleted in the same step); returns null
 * when that is declined.
 */
export async function assignAbbr(
  rd: MainModule | null,
  c: Pick<Component, 'name' | 'smiles' | 'cas' | 'formula' | 'mw'>,
  abbr: string,
  ask: (other: AbbrEntry) => boolean,
  self?: AbbrEntry,
): Promise<AbbrEntry | null> {
  const list = abbrs.current() ?? [];
  const own = self ?? entryFor(rd, c, list);
  const other = list.find((e) => e.abbr === abbr && e.id !== own?.id && !sameCompound(rd, e, c));
  if (other && !ask(other)) return null;
  const now = Date.now();
  try {
    return await abbrs.save(
      {
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
      },
      other?.id,
    );
  } catch (e) {
    if (!isStatus(e, 409)) throw e;
    await abbrs.refresh();
    throw new AbbrTakenError(abbr);
  }
}
