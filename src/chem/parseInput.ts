// Turn pasted / dropped text (ChemDraw CDXML, MDL RXN / Molfile / SDF, InChI,
// reaction SMILES, SMILES or names) into a list of species with roles.

import type { MainModule } from '@rdkit/rdkit';
import { parseCdxml, type CdxmlEntry } from './cdxml';

export type Source = 'cdxml' | 'rxn' | 'molfile' | 'inchi' | 'smiles' | 'names';

/** A structure (SMILES) or a free-text label (name, "K2CO3 (2 equiv)", "90 °C"). */
export interface Species { smiles?: string; text?: string }

export interface ParsedInput {
  source: Source;
  isReaction: boolean;
  reactants: Species[];
  agents: Species[];
  products: Species[];
  /** Species without a role (no arrow). */
  molecules: Species[];
}

export function detectFormat(text: string): Source {
  const s = text.trim();
  if (/<CDXML[\s>]/i.test(s)) return 'cdxml';
  if (/^\$RXN/m.test(s)) return 'rxn';
  if (/M {2}END/.test(s) && /V[23]000/.test(s)) return 'molfile';
  if (/^InChI=/m.test(s)) return 'inchi';
  // Reaction SMILES has no whitespace before its first '>'.
  return /^\S*>\S*>/.test(s) ? 'smiles' : 'names';
}

/** Net formal charge of a SMILES fragment, from bracket atoms. */
export function fragmentCharge(smiles: string): number {
  let total = 0;
  for (const m of smiles.matchAll(/\[([^\]]+)\]/g)) {
    const c = /(\++|-+)(\d*)(?::\d+)?$/.exec(m[1]);
    if (!c) continue;
    const n = c[2] ? Number(c[2]) : c[1].length;
    total += c[1][0] === '+' ? n : -n;
  }
  return total;
}

/**
 * Split a dot-disconnected SMILES into species: neutral fragments separately,
 * all ions together (so K2CO3 or a hydrochloride counter-ion stays one species).
 */
export function groupFragments(smiles: string): string[] {
  const frags = smiles.split('.').filter(Boolean);
  const neutral = frags.filter((f) => fragmentCharge(f) === 0);
  const ions = frags.filter((f) => fragmentCharge(f) !== 0);
  return ions.length ? [...neutral, ions.join('.')] : neutral;
}

function molblockToSmiles(rd: MainModule, mb: string): string | null {
  const mol = rd.get_mol(mb);
  if (!mol) return null;
  try {
    return mol.get_smiles() || null;
  } finally {
    mol.delete();
  }
}

/**
 * Rebuild a clean molblock: exactly 3 header lines before the counts line
 * (pasted text often loses the blank first line) and nothing after "M  END".
 */
export function normalizeMolblock(block: string): string | null {
  const lines = block.replace(/\r/g, '').split('\n');
  const counts = lines.findIndex((l) => /V[23]000\s*$/.test(l));
  const end = lines.findIndex((l, i) => i > counts && l.startsWith('M  END'));
  if (counts < 0 || end < 0) return null;
  const header = lines.slice(Math.max(0, counts - 3), counts);
  while (header.length < 3) header.unshift('');
  return [...header, ...lines.slice(counts, end + 1)].join('\n');
}

const speciesFromMolblock = (rd: MainModule, block: string): Species[] => {
  const mb = normalizeMolblock(block);
  const smi = mb && molblockToSmiles(rd, mb);
  return smi ? groupFragments(smi).map((smiles) => ({ smiles })) : [];
};

/** Split an MDL RXN file (V2000 or V3000) into molblocks per role. */
export function parseRxnBlock(text: string): { reactants: string[]; products: string[]; agents: string[] } | null {
  const lines = text.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => l.startsWith('$RXN'));
  if (start < 0) return null;

  if (/V3000/.test(lines[start])) {
    const out = { reactants: [] as string[], products: [] as string[], agents: [] as string[] };
    const body = lines.slice(start).join('\n');
    for (const [key, tag] of [['reactants', 'REACTANT'], ['products', 'PRODUCT'], ['agents', 'AGENT']] as const) {
      const block = new RegExp(`M {2}V30 BEGIN ${tag}\\n([\\s\\S]*?)M {2}V30 END ${tag}`).exec(body);
      if (!block) continue;
      for (const ctab of block[1].matchAll(/M {2}V30 BEGIN CTAB\n[\s\S]*?M {2}V30 END CTAB/g)) {
        out[key].push(`\n  rxn\n\n  0  0  0     0  0            999 V3000\n${ctab[0]}\nM  END`);
      }
    }
    return out;
  }

  const counts = lines[start + 4] ?? '';
  const nR = Number(counts.slice(0, 3)) || 0;
  const nP = Number(counts.slice(3, 6)) || 0;
  const nA = Number(counts.slice(6, 9)) || 0;
  const mols: string[] = [];
  let cur: string[] | null = null;
  for (const l of lines.slice(start + 5)) {
    if (l.startsWith('$MOL')) {
      if (cur) mols.push(cur.join('\n'));
      cur = [];
    } else cur?.push(l);
  }
  if (cur) mols.push(cur.join('\n'));
  return { reactants: mols.slice(0, nR), products: mols.slice(nR, nR + nP), agents: mols.slice(nR + nP, nR + nP + nA) };
}

/** Split reaction SMILES "A.B>C>D" (parenthesised groups stay together). */
export function splitReactionSmiles(s: string): { reactants: string[]; agents: string[]; products: string[] } | null {
  const parts = s.trim().split(/\s+/)[0].split('>');
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
    // Keep order; bare ions are merged into one species at the first ion's position.
    const result: string[] = [];
    const ions: string[] = [];
    let ionSlot = -1;
    for (const x of out.map((y) => y.trim()).filter(Boolean)) {
      if (x.startsWith('(') && x.endsWith(')')) result.push(x.slice(1, -1));
      else if (fragmentCharge(x) !== 0) {
        if (ionSlot < 0) ionSlot = result.push('') - 1;
        ions.push(x);
      } else result.push(x);
    }
    if (ionSlot >= 0) result[ionSlot] = ions.join('.');
    return result;
  };
  return { reactants: split(parts[0]), agents: split(parts[1]), products: split(parts[2]) };
}

/** Split a name-based reaction "A + B -> C" (also →, =>). A bare "=" is not an arrow: SMILES use it. */
export function splitNameReaction(s: string): { reactants: string[]; products: string[] } | null {
  const m = /(.+?)(?:->|→|⟶|=>)(.+)/.exec(s);
  if (!m) return null;
  const list = (x: string) => x.split(/\s+\+\s*|\s*\+\s+|＋/).map((t) => t.trim()).filter(Boolean);
  return { reactants: list(m[1]), products: list(m[2]) };
}

const empty = (source: Source): ParsedInput => ({ source, isReaction: false, reactants: [], agents: [], products: [], molecules: [] });

export function parseInputText(rd: MainModule | null, text: string): ParsedInput | null {
  const s = text.trim();
  if (!s) return null;
  const source = detectFormat(s);

  if (source === 'cdxml') {
    if (!rd) return null;
    const r = parseCdxml(s);
    if (!r) return null;
    const conv = (es: CdxmlEntry[]): Species[] =>
      es.flatMap((e) => (e.molblock ? speciesFromMolblock(rd, e.molblock) : e.text ? [{ text: e.text }] : []));
    const out = empty('cdxml');
    if (r.isReaction) {
      out.isReaction = true;
      out.reactants = conv(r.reactants);
      out.products = conv(r.products);
      out.agents = [...conv(r.above), ...conv(r.below)];
    } else {
      // Without an arrow, free text is usually captions — keep structures only.
      out.molecules = conv(r.all.filter((e) => e.molblock));
    }
    return out;
  }

  if (source === 'rxn') {
    if (!rd) return null;
    const r = parseRxnBlock(s);
    if (!r) return null;
    const conv = (mbs: string[]) => mbs.flatMap((mb) => speciesFromMolblock(rd, mb));
    return { ...empty('rxn'), isReaction: true, reactants: conv(r.reactants), products: conv(r.products), agents: conv(r.agents) };
  }

  if (source === 'molfile') {
    if (!rd) return null;
    const blocks = text.split(/^\$\$\$\$\s*$/m).filter((b) => /M {2}END/.test(b));
    const molecules = blocks.flatMap((b) => speciesFromMolblock(rd, b));
    return { ...empty('molfile'), molecules };
  }

  if (source === 'inchi') {
    return { ...empty('inchi'), molecules: s.split(/\s*\n\s*/).filter((l) => l.startsWith('InChI=')).map((text) => ({ text })) };
  }

  if (source === 'smiles') {
    const rx = splitReactionSmiles(s);
    if (rx) {
      const sp = (xs: string[]) => xs.map((smiles) => ({ smiles }));
      return { ...empty('smiles'), isReaction: true, reactants: sp(rx.reactants), agents: sp(rx.agents), products: sp(rx.products) };
    }
  }

  const nm = splitNameReaction(s);
  if (nm) {
    const sp = (xs: string[]) => xs.map((text) => ({ text }));
    return { ...empty('names'), isReaction: true, reactants: sp(nm.reactants), products: sp(nm.products) };
  }
  // One SMILES, name or CAS per line; the resolver decides which.
  return { ...empty('names'), molecules: s.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((text) => ({ text })) };
}

// ---- agent text ("Pd(PPh3)4 (5 mol%), K2CO3 (2.0 equiv)", "dioxane/H2O, 90 °C, 12 h") ----

export interface AgentToken {
  name?: string;
  equiv?: number;
  /** mol% given (catalyst). */
  molPercent?: boolean;
  /** A reaction condition (temperature, time, atmosphere…) or unresolvable text. */
  condition?: string;
}

const CONDITION_RE =
  /(-?\d+(\.\d+)?\s*(°\s*C|℃|K\b)|°C|℃|\brt\b|r\.\s*t\.|room\s+temp|reflux|回流|室温|冰浴|\d+(\.\d+)?\s*(h|hr|hrs|min|mins|d|days?|s)\b|overnight|过夜|小时|分钟|\bN2\b|\bAr\b|argon|nitrogen|氮气|氩气|microwave|微波|\bMW\b|hν|\bLED\b|blue light|\bh\s*v\b|\d+\s*(atm|psi|bar|MPa)\b|\bair\b|\bO2\s*\(|\bH2\s*\(|balloon|\d+\s*%\s*$|yield|产率)/i;

export function parseAgentText(text: string): AgentToken[] {
  const out: AgentToken[] = [];
  for (const raw of text.split(/[\n,;，；、]+/)) {
    let t = raw.trim();
    if (!t) continue;
    if (CONDITION_RE.test(t) && !/equiv|eq\b|mol\s*%/i.test(t)) {
      out.push({ condition: t });
      continue;
    }
    let equiv: number | undefined;
    let molPercent = false;
    const mp = /\(?\s*(\d+(?:\.\d+)?)\s*mol\s*%\s*\)?/i.exec(t);
    const eq = /\(?\s*(\d+(?:\.\d+)?)\s*(?:equiv\.?|eq\.?|当量)\s*\)?/i.exec(t);
    if (mp) {
      equiv = Number(mp[1]) / 100;
      molPercent = true;
      t = t.replace(mp[0], ' ');
    } else if (eq) {
      equiv = Number(eq[1]);
      t = t.replace(eq[0], ' ');
    }
    // Leading amount "1.2 equiv K2CO3" handled above; drop ratio "(4:1)" and stray brackets.
    t = t.replace(/\(\s*\d+(\.\d+)?\s*:\s*\d+(\.\d+)?\s*\)/g, ' ').replace(/\(\s*\)/g, ' ').trim();
    if (t) out.push({ name: t, equiv, molPercent });
  }
  return out;
}
