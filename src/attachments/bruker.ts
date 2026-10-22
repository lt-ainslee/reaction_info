// Bruker TopSpin datasets: find experiments in a selected folder, read the
// acquisition / processing parameters (JCAMP-style `##$KEY= value` files),
// and decode the processed 1D spectrum (pdata/<procno>/1r).

export type Params = Record<string, string>;

/** Parse a Bruker parameter file (acqus, procs, acqu2s…). Values keep their raw text; <…> is stripped. */
export function parseParams(text: string): Params {
  const out: Params = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^##\$?([A-Za-z0-9_]+)=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('<') && v.endsWith('>')) v = v.slice(1, -1);
    out[m[1].toUpperCase()] = v;
  }
  return out;
}

const num = (p: Params, k: string) => {
  const v = Number(p[k]);
  return Number.isFinite(v) ? v : undefined;
};

/** "13C" → "¹³C" for display. */
export function prettyNucleus(n: string | undefined): string | undefined {
  if (!n || n === 'off') return undefined;
  const sup: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  const m = /^(\d+)([A-Za-z]+)$/.exec(n);
  return m ? m[1].replace(/\d/g, (d) => sup[d]) + m[2] : n;
}

/** Solvent names as written in SI ("CDCl3" → "CDCl₃", "DMSO" → "DMSO-d₆"). */
export function prettySolvent(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const known: Record<string, string> = { DMSO: 'DMSO-d₆', ACETONE: 'acetone-d₆', MEOD: 'CD₃OD', CD3OD: 'CD₃OD', D2O: 'D₂O', C6D6: 'C₆D₆', CD3CN: 'CD₃CN', CD2CL2: 'CD₂Cl₂' };
  const k = s.toUpperCase();
  if (known[k]) return known[k];
  return s.replace(/(\d+)/g, (d) => d.replace(/\d/g, (x) => '₀₁₂₃₄₅₆₇₈₉'[Number(x)]));
}

export interface NmrMeta {
  /** Raw nucleus code, e.g. "1H"; for 2D the direct/indirect pair "1H/13C". */
  nucleus?: string;
  solvent?: string;
  /** Spectrometer frequency of the observed nucleus, MHz (SFO1). */
  frequency?: number;
  pulseProgram?: string;
  /** Experiment number (folder name) and sample (parent folder) name. */
  expno?: string;
  sample?: string;
  title?: string;
  /** Acquisition time, epoch ms. */
  acquiredAt?: number;
  dims: 1 | 2;
  /** Observed frequency rounded as written in SI: 400 MHz for ¹H, 101 MHz for ¹³C on the same magnet. */
  fieldMHz?: number;
  temperatureK?: number;
}

export function nmrMetaFrom(acqus: Params, acqu2s?: Params, title?: string): NmrMeta {
  const sfo1 = num(acqus, 'SFO1') ?? num(acqus, 'BF1');
  const n1 = acqus.NUC1;
  const n2 = acqu2s?.NUC1;
  const date = num(acqus, 'DATE');
  return {
    nucleus: acqu2s && n2 && n2 !== n1 ? `${n1}/${n2}` : n1,
    solvent: acqus.SOLVENT || undefined,
    frequency: sfo1,
    fieldMHz: sfo1 ? Math.round(sfo1) : undefined,
    pulseProgram: acqus.PULPROG || undefined,
    title: title?.trim().split(/\r?\n/)[0] || undefined,
    acquiredAt: date ? date * 1000 : undefined,
    dims: acqu2s ? 2 : 1,
    temperatureK: num(acqus, 'TE'),
  };
}

// ---- locating experiments in a selected folder ----

export interface PickedFile {
  /** Path relative to the selected folder, "/"-separated. */
  path: string;
  file: Blob;
}

export interface Experiment {
  /** Path of the experiment folder (the one containing acqus). */
  root: string;
  expno: string;
  sample?: string;
  files: PickedFile[];
}

const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** One entry per folder that contains an `acqus` file (nested experiments are separate). */
export function findExperiments(files: PickedFile[]): Experiment[] {
  const roots = files
    .filter((f) => basename(f.path) === 'acqus')
    .map((f) => dirname(f.path))
    .sort((a, b) => b.length - a.length); // deepest first, so a file belongs to its closest root
  const owner = new Map<PickedFile, string>();
  for (const f of files) {
    const root = roots.find((r) => r === '' || f.path.startsWith(r + '/'));
    if (root !== undefined) owner.set(f, root);
  }
  return roots
    .map((root) => {
      const parts = root.split('/').filter(Boolean);
      return {
        root,
        expno: parts[parts.length - 1] ?? '',
        sample: parts.length > 1 ? parts[parts.length - 2] : undefined,
        files: files.filter((f) => owner.get(f) === root),
      };
    })
    .sort((a, b) => a.root.localeCompare(b.root, undefined, { numeric: true }));
}

/** Paths inside an experiment (relative to its root) → whatever value. Picks the lowest procno with a 1r. */
export function pickProcno(relPaths: string[]): string | undefined {
  const procnos = relPaths
    .map((p) => /^pdata\/(\d+)\/1r$/.exec(p)?.[1])
    .filter((x): x is string => !!x)
    .sort((a, b) => Number(a) - Number(b));
  return procnos[0];
}

// ---- processed 1D spectrum ----

export interface Spectrum {
  /** Chemical shift of each point, ppm (decreasing). */
  ppm: Float64Array;
  intensity: Float64Array;
}

/** Decode pdata/x/1r using its procs (SI, OFFSET, SW_p, SF, BYTORDP, DTYPP, NC_proc). */
export function readSpectrum1r(data: ArrayBuffer, procs: Params): Spectrum {
  const si = num(procs, 'SI');
  const offset = num(procs, 'OFFSET');
  const swp = num(procs, 'SW_P');
  const sf = num(procs, 'SF');
  if (!si || offset === undefined || !swp || !sf) throw new Error('procs is missing SI / OFFSET / SW_p / SF');
  const little = (num(procs, 'BYTORDP') ?? 0) === 0;
  const double = (num(procs, 'DTYPP') ?? 0) === 2;
  const scale = Math.pow(2, num(procs, 'NC_PROC') ?? 0);
  const view = new DataView(data);
  const bytes = double ? 8 : 4;
  const n = Math.min(si, Math.floor(data.byteLength / bytes));
  const intensity = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = double ? view.getFloat64(i * 8, little) : view.getInt32(i * 4, little);
    intensity[i] = v * scale;
  }
  const step = swp / sf / si;
  const ppm = new Float64Array(n);
  for (let i = 0; i < n; i++) ppm[i] = offset - i * step;
  return { ppm, intensity };
}

/**
 * Reduce to ~2×`buckets` points for drawing, keeping each bucket's min and
 * max so narrow peaks survive. Optionally restricted to a ppm window.
 */
export function downsample(s: Spectrum, buckets: number, window?: [number, number]): { x: number[]; y: number[] } {
  let start = 0;
  let end = s.ppm.length;
  if (window) {
    const [hi, lo] = window[0] > window[1] ? window : [window[1], window[0]];
    while (start < end && s.ppm[start] > hi) start++;
    while (end > start && s.ppm[end - 1] < lo) end--;
  }
  const n = end - start;
  const x: number[] = [];
  const y: number[] = [];
  if (n <= 0) return { x, y };
  const size = Math.max(1, Math.ceil(n / buckets));
  for (let b = start; b < end; b += size) {
    let iMin = b;
    let iMax = b;
    for (let i = b; i < Math.min(b + size, end); i++) {
      if (s.intensity[i] < s.intensity[iMin]) iMin = i;
      if (s.intensity[i] > s.intensity[iMax]) iMax = i;
    }
    for (const i of iMin < iMax ? [iMin, iMax] : iMax < iMin ? [iMax, iMin] : [iMin]) {
      x.push(s.ppm[i]);
      y.push(s.intensity[i]);
    }
  }
  return { x, y };
}

/** Start of an SI line, e.g. "¹H NMR (400 MHz, CDCl₃) δ ". */
export function siPrefix(m: NmrMeta): string | undefined {
  if (m.dims !== 1 || !m.nucleus) return undefined;
  const nuc = prettyNucleus(m.nucleus);
  const parts = [m.fieldMHz && `${m.fieldMHz} MHz`, prettySolvent(m.solvent)].filter(Boolean);
  return `${nuc} NMR${parts.length ? ` (${parts.join(', ')})` : ''} δ `;
}
