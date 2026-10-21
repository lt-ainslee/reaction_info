import type { MainModule } from '@rdkit/rdkit';
import { exactLibraryMatch, isLibrarySolvent, LIBRARY, libraryToComponent, searchLibrary, type LibraryEntry } from './library';
import { parseAgentText, type ParsedInput, type Species } from './parseInput';
import { isCas, searchByInchi, searchByName, searchBySmiles, type PubChemHit } from './pubchem';
import { isValidSmiles, smilesInfo } from './rdkit';
import type { Component, Role } from './stoich';

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
    const [hit] = q.trim().startsWith('InChI=') ? await searchByInchi(q.trim()) : await searchByName(q);
    return hit ? hitToData(hit, rd, lang) : null;
  } catch {
    return null;
  }
}

// ---- resolving parsed input (paste / file / text) ----

export interface ResolvedItem { data: CompoundData; role: Role; equiv?: number }

export interface Resolved {
  items: ResolvedItem[];
  /** Reaction conditions found in arrow text (temperature, time, atmosphere, unknown labels). */
  conditions: string[];
  failed: string[];
  /** The input described agents (reagents/catalysts/solvents) explicitly. */
  hasAgents: boolean;
}

const CATALYST_METALS = /(Pd|Pt|Rh|Ru|Ir|Au|Os)(?![a-z])/;

function guessAgentRole(rd: MainModule | null, d: CompoundData, molPercent: boolean): Role {
  if (molPercent) return 'catalyst';
  const lib = (d.cas && LIBRARY.find((e) => e.cas === d.cas)) || (rd && d.smiles ? libraryBySmiles(rd, d.smiles) : undefined);
  if (lib && isLibrarySolvent(lib)) return 'solvent';
  if (d.formula && CATALYST_METALS.test(d.formula)) return 'catalyst';
  return 'reagent';
}

export async function resolveParsed(
  p: ParsedInput,
  rd: MainModule | null,
  lang: 'zh' | 'en',
  defaultRole: Role = 'reactant',
): Promise<Resolved> {
  const out: Resolved = { items: [], conditions: [], failed: [], hasAgents: p.agents.length > 0 };

  const one = async (s: Species) => {
    const q = s.smiles ?? s.text ?? '';
    const d = await resolveOne(q, rd, lang);
    if (!d) out.failed.push(q);
    return d;
  };

  for (const [list, role] of [[p.reactants, 'reactant'], [p.molecules, defaultRole]] as const) {
    for (const s of list) {
      const d = await one(s);
      if (d) out.items.push({ data: d, role });
    }
  }

  for (const s of p.agents) {
    if (s.smiles) {
      const d = await one(s);
      if (d) out.items.push({ data: d, role: guessAgentRole(rd, d, false) });
      continue;
    }
    for (const tok of parseAgentText(s.text ?? '')) {
      if (tok.condition) {
        out.conditions.push(tok.condition);
        continue;
      }
      const name = tok.name!;
      let found = await resolveOne(name, rd, lang).then((d) => (d ? [d] : []));
      // "THF/H2O", "dioxane/water" → several solvents (but not "Pd/C").
      if (!found.length && name.includes('/')) {
        const parts = await Promise.all(name.split('/').map((x) => resolveOne(x.trim(), rd, lang)));
        if (parts.every(Boolean)) found = parts as CompoundData[];
      }
      if (!found.length) {
        out.conditions.push(name);
        continue;
      }
      for (const d of found) {
        const role = guessAgentRole(rd, d, !!tok.molPercent);
        out.items.push({ data: d, role, equiv: role === 'solvent' ? undefined : tok.equiv });
      }
    }
  }

  for (const s of p.products) {
    const d = await one(s);
    if (d) out.items.push({ data: d, role: 'product' });
  }
  return out;
}

/** Key used to match pasted compounds with existing ones when updating a reaction. */
export function compoundKey(rd: MainModule | null, c: { smiles?: string; name: string; cas?: string }): string {
  if (rd && c.smiles) {
    const can = canonical(rd, c.smiles);
    if (can) return 'smi:' + can;
  }
  return c.cas ? 'cas:' + c.cas : 'name:' + c.name.trim().toLowerCase();
}
