import type { MainModule } from '@rdkit/rdkit';
import { exactLibraryMatch, LIBRARY, libraryToComponent, searchLibrary, type LibraryEntry } from './library';
import { isCas, searchByName, searchBySmiles, type PubChemHit } from './pubchem';
import { isValidSmiles, smilesInfo } from './rdkit';
import type { Component } from './stoich';

export type CompoundData = Omit<Component, 'id' | 'role' | 'equiv'>;

export const hasCjk = (s: string) => /[㐀-鿿]/.test(s);

/** A SMILES-looking token: no spaces, parses in RDKit, and not a plain word/CAS. */
export function looksLikeSmiles(rd: MainModule | null, q: string): boolean {
  const s = q.trim();
  if (!rd || !s || /\s/.test(s) || isCas(s) || hasCjk(s)) return false;
  return isValidSmiles(rd, s);
}

function canonical(rd: MainModule, smiles: string): string | null {
  const mol = rd.get_mol(smiles);
  if (!mol) return null;
  try {
    return mol.get_smiles();
  } finally {
    mol.delete();
  }
}

let libIndex: Map<string, LibraryEntry> | null = null;

/** Find a library entry with the same structure (canonical SMILES). */
export function libraryBySmiles(rd: MainModule, smiles: string): LibraryEntry | undefined {
  if (!libIndex) {
    libIndex = new Map();
    for (const e of LIBRARY) {
      const key = e.smiles && canonical(rd, e.smiles);
      // First entry wins (e.g. plain reagent before a solution of it).
      if (key && !libIndex.has(key)) libIndex.set(key, e);
    }
  }
  const key = canonical(rd, smiles);
  return key ? libIndex.get(key) : undefined;
}

/**
 * Fill in weighing data (density, commercial form) from the library when the
 * structure matches, keeping the given name if there is one.
 */
function withLibraryData(rd: MainModule | null, d: CompoundData, lang: 'zh' | 'en', keepName: boolean): CompoundData {
  const e = rd && d.smiles ? libraryBySmiles(rd, d.smiles) : undefined;
  if (!e) return d;
  const lib = libraryToComponent(e, lang);
  return { ...lib, cid: d.cid, name: keepName ? d.name : lib.name };
}

export function hitToData(h: PubChemHit, rd: MainModule | null, lang: 'zh' | 'en' = 'en'): CompoundData {
  return withLibraryData(rd, hitToDataRaw(h, rd), lang, true);
}

function hitToDataRaw(h: PubChemHit, rd: MainModule | null): CompoundData {
  const info = rd && h.smiles ? smilesInfo(rd, h.smiles) : null;
  return {
    name: h.title,
    smiles: h.smiles,
    formula: h.formula,
    cid: h.cid,
    mw: h.mw || info?.mw,
    purity: 100,
    form: 'neat',
  };
}

export function smilesToData(rd: MainModule, smiles: string, name?: string, lang: 'zh' | 'en' = 'en'): CompoundData {
  const info = smilesInfo(rd, smiles);
  const base: CompoundData = { name: name ?? info?.formula ?? smiles, smiles, formula: info?.formula, mw: info?.mw, purity: 100, form: 'neat' };
  return withLibraryData(rd, base, lang, name !== undefined);
}

export interface SearchResults {
  local: LibraryEntry[];
  pubchem: PubChemHit[];
  smiles?: string;
  error?: boolean;
}

export async function searchAll(q: string, rd: MainModule | null): Promise<SearchResults> {
  const local = searchLibrary(q);
  const smiles = looksLikeSmiles(rd, q) ? q.trim() : undefined;
  let pubchem: PubChemHit[] = [];
  let error = false;
  // PubChem can't search Chinese names; the local library covers those.
  if (!hasCjk(q)) {
    try {
      pubchem = smiles ? await searchBySmiles(smiles) : await searchByName(q);
      if (!pubchem.length && smiles === undefined && rd && isValidSmiles(rd, q.trim())) {
        pubchem = await searchBySmiles(q.trim());
      }
    } catch {
      error = true;
    }
  }
  return { local, pubchem, smiles, error };
}

/** Resolve a single token to the best compound data (used by reaction import). */
export async function resolveOne(q: string, rd: MainModule | null, lang: 'zh' | 'en'): Promise<CompoundData | null> {
  const lib = exactLibraryMatch(q);
  if (lib) return libraryToComponent(lib, lang);
  if (rd && looksLikeSmiles(rd, q)) {
    const base = smilesToData(rd, q.trim(), undefined, lang);
    if (libraryBySmiles(rd, q.trim())) return base;
    try {
      const [hit] = await searchBySmiles(q.trim());
      if (hit) return { ...base, name: hit.title, cid: hit.cid, formula: hit.formula, mw: hit.mw || base.mw };
    } catch {
      /* offline: keep RDKit-derived data */
    }
    return base;
  }
  if (hasCjk(q)) return null;
  try {
    const [hit] = await searchByName(q);
    return hit ? hitToData(hit, rd, lang) : null;
  } catch {
    return null;
  }
}

/** Split a reaction SMILES "A.B>C>D" (or "A.B>>D"). Parenthesised groups stay together. */
export function splitReactionSmiles(s: string): { reactants: string[]; agents: string[]; products: string[] } | null {
  const parts = s.trim().split('>');
  if (parts.length !== 3) return null;
  const split = (p: string) => {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of p) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === '.' && depth === 0) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => (x.startsWith('(') && x.endsWith(')') ? x.slice(1, -1) : x));
  };
  return { reactants: split(parts[0]), agents: split(parts[1]), products: split(parts[2]) };
}

/** Split a name-based reaction "A + B -> C" (also →, =, >>). */
export function splitNameReaction(s: string): { reactants: string[]; products: string[] } | null {
  const m = /(.+?)(?:->|→|⟶|=>|>>|=)(.+)/.exec(s);
  if (!m) return null;
  const list = (x: string) => x.split(/\s+\+\s*|\s*\+\s+|＋/).map((t) => t.trim()).filter(Boolean);
  return { reactants: list(m[1]), products: list(m[2]) };
}
