// Abbreviations of compounds (THF, Boc2O, SM-1, 1a…). Where a compound's
// abbreviation comes from, first match wins:
//   1. the component itself (`abbr`, typed in its properties panel; '' = none);
//   2. the abbreviation table (user-defined, shared like the reagent inventory);
//   3. the built-in library (THF, DCM, Et3N… from its aliases).
// The table also resolves abbreviations typed in an equation ("SM-1 + Boc2O -> P").
import type { MainModule } from '@rdkit/rdkit';
import { formulaMass } from './formula';
import { LIBRARY, libraryBySmiles, type LibraryEntry } from './library';
import { canonicalSmiles } from './rdkit';
import type { Component, Reaction } from './stoich';
import type { AbbrEntry } from './abbrEntry';

export { normalizeAbbr, type AbbrEntry } from './abbrEntry';

/** Abbreviation from a library entry's aliases: THF, Et3N, MeOH — not "Dioxane" or "氯仿". */
export function builtinAbbr(e: LibraryEntry): string | undefined {
  return e.aliases?.find((a) => /^[\x21-\x7E]{2,10}$/.test(a) && !/^[A-Z]?[a-z-]+$/.test(a));
}

// ---- the user table (set by the storage layer, read by resolve / display) ----

let table: AbbrEntry[] = [];
/** Replace the in-memory table (most recently updated first). */
export function setAbbrTable(list: AbbrEntry[]) {
  table = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}
export const abbrTable = () => table;

const canonOf = (rd: MainModule | null, smiles?: string) => (rd && smiles ? canonicalSmiles(rd, smiles) ?? undefined : undefined);

type Ident = Pick<Component, 'name' | 'smiles' | 'cas'>;

/** Same compound: structure, else CAS, else name (case-insensitive). */
export function sameCompound(rd: MainModule | null, a: Ident, b: Ident): boolean {
  const sa = canonOf(rd, a.smiles);
  const sb = canonOf(rd, b.smiles);
  if (sa && sb) return sa === sb;
  if (a.cas && b.cas) return a.cas === b.cas;
  return !!a.name && a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

/** Table entry for a compound. */
export const entryFor = (rd: MainModule | null, c: Ident, list = table) => list.find((e) => sameCompound(rd, e, c));

/** Table entry with this abbreviation (exact case first: "Bn" ≠ "BN"). */
export function entryByAbbr(text: string, list = table): AbbrEntry | undefined {
  const q = text.trim();
  if (!q) return undefined;
  return list.find((e) => e.abbr === q) ?? list.find((e) => e.abbr.toLowerCase() === q.toLowerCase());
}

/** Abbreviation the table / library gives a compound (ignoring its own `abbr`). */
export function autoAbbr(rd: MainModule | null, c: Ident, list = table): string | undefined {
  const e = entryFor(rd, c, list);
  if (e) return e.abbr;
  const lib = (c.cas && LIBRARY.find((x) => x.cas === c.cas)) || (rd && c.smiles ? libraryBySmiles(rd, c.smiles) : undefined);
  const b = lib ? builtinAbbr(lib) : undefined;
  // Not when it only repeats the name (e.g. a compound named "THF").
  return b && b.toLowerCase() !== c.name.trim().toLowerCase() ? b : undefined;
}

/** The abbreviation shown for a component, or undefined. */
export function abbrOf(rd: MainModule | null, c: Component, list = table): string | undefined {
  if (c.abbr !== undefined) return c.abbr || undefined;
  return autoAbbr(rd, c, list);
}

/** Every component with its effective abbreviation filled in ('' = none), for drawing and reports. */
export function withAbbrs(rd: MainModule | null, rxn: Reaction, list = table): Reaction {
  return { ...rxn, components: rxn.components.map((c) => ({ ...c, abbr: abbrOf(rd, c, list) ?? '' })) };
}

/** "Tetrahydrofuran (THF)"; just the name when there is no (different) abbreviation. */
export function nameWithAbbr(c: Pick<Component, 'name' | 'abbr'>): string {
  return c.abbr && c.abbr !== c.name ? `${c.name} (${c.abbr})` : c.name;
}

/** Compound data for an abbreviation typed in an equation or the search box. */
export function entryToData(e: AbbrEntry): Omit<Component, 'id' | 'role' | 'equiv'> {
  return {
    name: e.name,
    smiles: e.smiles,
    cas: e.cas,
    formula: e.formula,
    mw: e.mw ?? (e.formula ? formulaMass(e.formula) ?? undefined : undefined),
    purity: 100,
    form: 'neat',
  };
}

/** Entries whose abbreviation or name matches a search (abbreviation prefix first). */
export function searchAbbrs(query: string, limit = 6, list = table): AbbrEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (e: AbbrEntry) => {
    const a = e.abbr.toLowerCase();
    const n = e.name.toLowerCase();
    return a === q ? 4 : a.startsWith(q) ? 3 : n === q || e.cas === query.trim() ? 2 : a.includes(q) || n.includes(q) ? 1 : 0;
  };
  return list
    .map((e) => [score(e), e] as const)
    .filter(([s]) => s > 0)
    .sort((x, y) => y[0] - x[0])
    .slice(0, limit)
    .map(([, e]) => e);
}
