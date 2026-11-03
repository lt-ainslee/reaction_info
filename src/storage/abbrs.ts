// Abbreviation table: on the server (/api/abbrs) when available, else in this
// browser (see collection.ts). Every change is also pushed to chem/abbr so
// drawing and equation parsing see it.
import type { MainModule } from '@rdkit/rdkit';
import { entryFor, normalizeAbbr, sameCompound, setAbbrTable, type AbbrEntry } from '../chem/abbr';
import type { Component } from '../chem/stoich';
import type { Access, Visibility } from './access';
import { currentAccount } from './auth';
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
export const saveAbbr = (e: AbbrEntry, visibility?: Visibility) => abbrs.save(e, undefined, visibility);
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
  // Someone else's entry shared read-only is not changed: this makes one's own.
  const found = self ?? entryFor(rd, c, list);
  const own = found && (!found.access || found.access.canEdit) ? found : undefined;
  const ownerOf = (a?: Access) => (!a ? 'local' : a.mine ? 'me' : a.ownerName ? `other:${a.ownerName}` : 'group');
  const saving = own ? ownerOf(own.access) : currentAccount() ? 'me' : 'local';
  // Abbreviations are unique per owner: only an entry of the same owner clashes.
  const clash = list.filter((e) => e.abbr === abbr && e.id !== own?.id && !sameCompound(rd, e, c));
  const other = clash.find((e) => ownerOf(e.access) === saving);
  if (other && !ask(other)) return null;
  // Entries of others this one hides from the table (reload to show the right one).
  const shadows = clash.length > (other ? 1 : 0) || (found && found !== own);
  const now = Date.now();
  try {
    const saved = await abbrs.save(
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
    if (shadows) await abbrs.refresh();
    return saved;
  } catch (e) {
    if (!isStatus(e, 409)) throw e;
    await abbrs.refresh();
    throw new AbbrTakenError(abbr);
  }
}
