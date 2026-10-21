import type { Phase } from './stoich';

// PubChem PUG REST / PUG View client (CORS-enabled, called from the browser).
// Docs: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest

const REST = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const VIEW = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound';
const PROPS = 'Title,IUPACName,MolecularFormula,MolecularWeight,IsomericSMILES';

export interface PubChemHit {
  cid: number;
  title: string;
  iupac?: string;
  formula: string;
  mw: number;
  smiles?: string;
}

export interface PubChemPhysical {
  density?: number;
  densityText?: string;
  phase?: Phase;
  description: string[];
  meltingPoint: string[];
  boilingPoint: string[];
}

export interface PubChemDetails extends PubChemPhysical {
  cas?: string;
  meltingPoint: string[];
  boilingPoint: string[];
  flashPoint: string[];
  solubility: string[];
  ghsPictograms: string[];
  hazards: string[];
}

// Simple client-side rate limiting: PubChem allows at most 5 requests/second.
let last = 0;
async function throttledFetch(url: string, init?: RequestInit): Promise<Response> {
  const wait = Math.max(0, last + 220 - Date.now());
  last = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return fetch(url, init);
}

const CAS_RE = /^\d{2,7}-\d{2}-\d$/;
export const isCas = (s: string) => CAS_RE.test(s.trim());

interface PropRow {
  CID: number;
  Title?: string;
  IUPACName?: string;
  MolecularFormula: string;
  MolecularWeight: string | number;
  IsomericSMILES?: string;
  SMILES?: string;
}

function toHit(p: PropRow): PubChemHit {
  return {
    cid: p.CID,
    title: p.Title ?? p.IUPACName ?? `CID ${p.CID}`,
    iupac: p.IUPACName,
    formula: p.MolecularFormula,
    mw: Number(p.MolecularWeight),
    smiles: p.SMILES ?? p.IsomericSMILES,
  };
}

async function readProps(res: Response): Promise<PubChemHit[]> {
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`PubChem HTTP ${res.status}`);
  const data = (await res.json()) as { PropertyTable?: { Properties: PropRow[] } };
  return (data.PropertyTable?.Properties ?? []).map(toHit);
}

/** Search by name, CAS number or synonym. */
export async function searchByName(name: string): Promise<PubChemHit[]> {
  const res = await throttledFetch(`${REST}/compound/name/${encodeURIComponent(name.trim())}/property/${PROPS}/JSON`);
  return (await readProps(res)).slice(0, 5);
}

/** Exact-structure lookup by SMILES (POST so that '/' and '#' survive). */
export async function searchBySmiles(smiles: string): Promise<PubChemHit[]> {
  const res = await throttledFetch(`${REST}/compound/smiles/property/${PROPS}/JSON`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ smiles }),
  });
  return (await readProps(res)).filter((h) => h.cid > 0);
}

/** Lookup by InChI (POST). */
export async function searchByInchi(inchi: string): Promise<PubChemHit[]> {
  const res = await throttledFetch(`${REST}/compound/inchi/property/${PROPS}/JSON`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ inchi }),
  });
  return (await readProps(res)).filter((h) => h.cid > 0);
}

// ---- PUG View (experimental properties, safety) ----

interface Markup { Type?: string; Extra?: string }
interface Info {
  Value?: {
    StringWithMarkup?: { String: string; Markup?: Markup[] }[];
    Number?: number[];
    Unit?: string;
  };
}
interface Section { TOCHeading?: string; Section?: Section[]; Information?: Info[] }

async function viewHeading(cid: number, heading: string): Promise<Info[]> {
  const res = await throttledFetch(`${VIEW}/${cid}/JSON?heading=${encodeURIComponent(heading)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { Record?: Section };
  const out: Info[] = [];
  const walk = (s: Section) => {
    if (s.Information) out.push(...s.Information);
    s.Section?.forEach(walk);
  };
  if (data.Record) walk(data.Record);
  return out;
}

function infoStrings(infos: Info[]): string[] {
  const out: string[] = [];
  for (const i of infos) {
    const v = i.Value;
    if (!v) continue;
    v.StringWithMarkup?.forEach((s) => out.push(s.String));
    if (v.Number?.length) out.push(`${v.Number.join(', ')}${v.Unit ? ' ' + v.Unit : ''}`);
  }
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}

/** Pick a density in g/mL from PubChem's free-text entries. */
export function parseDensity(texts: string[]): { value: number; text: string } | undefined {
  for (const text of texts) {
    if (/vapou?r|air\s*=\s*1|gas/i.test(text)) continue;
    const m = /(\d+(?:\.\d+)?)/.exec(text);
    if (!m) continue;
    let value = Number(m[1]);
    if (/kg\s*\/\s*(m3|m\^3|cu\s*m)/i.test(text)) value /= 1000;
    if (value > 0.1 && value < 25) return { value, text };
  }
  return undefined;
}

/** First temperature in °C in a PubChem text ("122 °C", "13-14 °C", "252 °F (NTP, 1992)"). */
export function parseTempC(text: string): number | undefined {
  const m = /(-?\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?))?\s*(?:°|º|deg\.?)\s*([CF])(?![a-z])/i.exec(text);
  if (!m) return undefined;
  const v = m[2] !== undefined ? (Number(m[1]) + Number(m[2])) / 2 : Number(m[1]);
  return m[3].toUpperCase() === 'F' ? ((v - 32) * 5) / 9 : v;
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** State at ~25 °C from melting / boiling points, else from the physical description. */
export function inferPhase(description: string[], meltingPoint: string[], boilingPoint: string[]): Phase | undefined {
  const temps = (xs: string[]) => xs.map(parseTempC).filter((x): x is number => x !== undefined);
  const mp = median(temps(meltingPoint));
  const bp = median(temps(boilingPoint));
  if (bp !== undefined && bp < 15) return 'gas';
  if (mp !== undefined && mp > 35) return 'solid';
  if (mp !== undefined && mp < 15) return 'liquid';

  const votes = { solid: 0, liquid: 0, gas: 0 };
  for (const d of description) {
    if (/\b(liquid|oil|oily)\b/i.test(d)) votes.liquid++;
    if (/solid|crystal|powder|needles|flakes|prisms|plates|granul|leaflets|lumps|pellets|waxy/i.test(d)) votes.solid++;
    if (/\bgas\b/i.test(d)) votes.gas++;
  }
  const best = (Object.entries(votes) as [Phase, number][]).sort((a, b) => b[1] - a[1]);
  if (best[0][1] > 0 && best[0][1] > best[1][1]) return best[0][0];
  if (mp !== undefined) return mp > 25 ? 'solid' : 'liquid';
  return undefined;
}

/** Physical state, density, mp and bp: what is needed to dispense a compound. */
export async function fetchPhysical(cid: number): Promise<PubChemPhysical> {
  const [desc, density, mp, bp] = [
    await viewHeading(cid, 'Physical Description').catch(() => []),
    await viewHeading(cid, 'Density').catch(() => []),
    await viewHeading(cid, 'Melting Point').catch(() => []),
    await viewHeading(cid, 'Boiling Point').catch(() => []),
  ];
  const description = infoStrings(desc);
  const meltingPoint = infoStrings(mp);
  const boilingPoint = infoStrings(bp);
  const d = parseDensity(infoStrings(density));
  return {
    density: d?.value,
    densityText: d?.text,
    phase: inferPhase(description, meltingPoint, boilingPoint),
    description: description.slice(0, 3),
    meltingPoint: meltingPoint.slice(0, 3),
    boilingPoint: boilingPoint.slice(0, 3),
  };
}

export async function fetchDetails(cid: number): Promise<PubChemDetails> {
  const phys = await getPhysicalCached(cid);
  const headings = ['CAS', 'Flash Point', 'Solubility', 'GHS Classification'];
  const results: Info[][] = [];
  for (const h of headings) results.push(await viewHeading(cid, h).catch(() => []));
  const [cas, fp, sol, ghs] = results;

  const casList = infoStrings(cas).filter(isCas);

  const pictograms = new Set<string>();
  const hazards = new Set<string>();
  for (const i of ghs) {
    for (const s of i.Value?.StringWithMarkup ?? []) {
      s.Markup?.forEach((m) => m.Type === 'Icon' && m.Extra && pictograms.add(m.Extra));
      if (/^H\d{3}/.test(s.String)) hazards.add(s.String.replace(/\s*\[.*?\]\s*$/, ''));
    }
  }

  const top = (infos: Info[], n = 3) => infoStrings(infos).slice(0, n);
  return {
    ...phys,
    cas: casList[0],
    flashPoint: top(fp),
    solubility: top(sol),
    ghsPictograms: [...pictograms],
    hazards: [...hazards].slice(0, 12),
  };
}

// ---- cache (localStorage) ----

function cached<T>(key: string, fetcher: (cid: number) => Promise<T>) {
  return async (cid: number): Promise<T> => {
    let cache: Record<string, T> = {};
    try {
      cache = JSON.parse(localStorage.getItem(key) ?? '{}');
    } catch {
      /* ignore */
    }
    if (cache[cid]) return cache[cid];
    const d = await fetcher(cid);
    try {
      cache[cid] = d;
      const keys = Object.keys(cache);
      if (keys.length > 300) delete cache[keys[0]];
      localStorage.setItem(key, JSON.stringify(cache));
    } catch {
      /* storage full / disabled */
    }
    return d;
  };
}

export const getPhysicalCached = cached('pubchem-physical-v1', fetchPhysical);
export const getDetailsCached = cached('pubchem-details-v2', fetchDetails);

export const pubchemUrl = (cid: number) => `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;
