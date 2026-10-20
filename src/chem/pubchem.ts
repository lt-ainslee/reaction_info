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

export interface PubChemDetails {
  cas?: string;
  density?: number;
  densityText?: string;
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

export async function fetchDetails(cid: number): Promise<PubChemDetails> {
  const headings = ['CAS', 'Density', 'Melting Point', 'Boiling Point', 'Flash Point', 'Solubility', 'GHS Classification'];
  const results: Info[][] = [];
  for (const h of headings) results.push(await viewHeading(cid, h).catch(() => []));
  const [cas, density, mp, bp, fp, sol, ghs] = results;

  const casList = infoStrings(cas).filter(isCas);
  const d = parseDensity(infoStrings(density));

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
    cas: casList[0],
    density: d?.value,
    densityText: d?.text,
    meltingPoint: top(mp),
    boilingPoint: top(bp),
    flashPoint: top(fp),
    solubility: top(sol),
    ghsPictograms: [...pictograms],
    hazards: [...hazards].slice(0, 12),
  };
}

// ---- cache (localStorage) ----

const CACHE_KEY = 'pubchem-details-v1';

export async function getDetailsCached(cid: number): Promise<PubChemDetails> {
  let cache: Record<string, PubChemDetails> = {};
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
  } catch {
    /* ignore */
  }
  if (cache[cid]) return cache[cid];
  const d = await fetchDetails(cid);
  try {
    cache[cid] = d;
    const keys = Object.keys(cache);
    if (keys.length > 200) delete cache[keys[0]];
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage full / disabled */
  }
  return d;
}

export const pubchemUrl = (cid: number) => `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;
