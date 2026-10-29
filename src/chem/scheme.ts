// Publication-style reaction scheme (black & white, ChemDraw / ACS 1996
// proportions): one layout, written out as SVG (screen + export, PNG via the
// browser) or CDXML (opens in ChemDraw with editable structures), plus an MDL
// RXN file of the structures.
//
// Lengths are in drawing units with a bond = 30 units. ACS 1996: bond 14.4 pt,
// line 0.6 pt, labels Arial 10 pt — so 1 unit = 0.48 pt.

import type { MainModule } from '@rdkit/rdkit';
import { formulaSubscripts } from '../procedure/chemText';
import { SYMBOL_BY_Z } from './elements';
import { smilesToSvg } from './rdkit';
import type { Component, Reaction } from './stoich';

const BOND = 30;
const PT = 14.4 / BOND;
const FS = 10 / PT; // text size: 10 pt
const LINE_H = FS * 1.2;
const ASC = FS * 0.75;
const DESC = FS * 0.25;
const GAP = BOND * 0.6; // between molecules and "+"
const MAX_TEXT_W = BOND * 9; // wrap width above / below the arrow
const FONT = 'Arial, Helvetica, sans-serif';

// ---- rich text (formula digits as subscripts) ----

export interface TextRun {
  text: string;
  sub?: boolean;
  /** Component the run belongs to (clickable on screen). */
  cid?: string;
}
type Line = TextRun[];

/** Split a label into runs, subscripting digits of formula-like words (Pd(PPh3)4, K2CO3). */
export function richText(text: string, cid?: string): TextRun[] {
  const out: TextRun[] = [];
  const push = (s: string, sub?: boolean) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last && !!last.sub === !!sub) last.text += s;
    else out.push({ text: s, ...(sub ? { sub } : {}), ...(cid ? { cid } : {}) });
  };
  for (const tok of text.split(/(\s+|[,;，；、/·])/)) {
    const subs = formulaSubscripts(tok);
    if (!subs) {
      push(tok);
      continue;
    }
    const set = new Set(subs);
    let i = 0;
    while (i < tok.length) {
      const sub = set.has(i);
      let j = i;
      while (j < tok.length && set.has(j) === sub) j++;
      push(tok.slice(i, j), sub);
      i = j;
    }
  }
  return out;
}

let ctx: CanvasRenderingContext2D | null | undefined;
function charWidth(ch: string): number {
  if (/[⺀-￿]/.test(ch) && !/[‐-‧°±×→]/.test(ch)) return 1;
  if (/[A-Z]/.test(ch)) return /[IJ]/.test(ch) ? 0.3 : /[MW]/.test(ch) ? 0.85 : 0.68;
  if (/[a-z]/.test(ch)) return /[ijlft]/.test(ch) ? 0.26 : /[mw]/.test(ch) ? 0.8 : 0.53;
  if (/\d/.test(ch)) return 0.556;
  if (ch === ' ') return 0.28;
  return 0.36;
}
/** Width of a text run at size `size` (canvas when available, else Arial-like estimates). */
function textWidth(text: string, size: number): number {
  if (ctx === undefined) {
    try {
      ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      ctx = null;
    }
  }
  if (ctx) {
    ctx.font = `${size}px ${FONT}`;
    const w = ctx.measureText(text).width;
    if (w > 0) return w;
  }
  return [...text].reduce((s, ch) => s + charWidth(ch) * size, 0);
}
const SUB = 0.7;
const lineWidth = (l: Line) => l.reduce((s, r) => s + textWidth(r.text, r.sub ? FS * SUB : FS), 0);

/** Greedy wrap of items (each a run list) joined by `sep`, then of long items at spaces. */
function wrap(items: TextRun[][], maxW: number, sep = ', '): Line[] {
  const lines: Line[] = [];
  let cur: Line = [];
  for (const item of items) {
    const next = cur.length ? [...cur, { text: sep }, ...item] : item;
    if (!cur.length || lineWidth(next) <= maxW) {
      cur = next;
      continue;
    }
    lines.push(cur);
    cur = item;
  }
  if (cur.length) lines.push(cur);
  // Break any still-too-long line at spaces.
  return lines.flatMap((l) => {
    if (lineWidth(l) <= maxW) return [l];
    const words: Line[] = [];
    let open = false; // last word not yet ended by a space
    for (const r of l) {
      for (const part of r.text.split(/(?<= )/)) {
        const run = { ...r, text: part };
        if (open) words[words.length - 1].push(run);
        else words.push([run]);
        open = !part.endsWith(' ');
      }
    }
    const out: Line[] = [];
    let line: Line = [];
    for (const w of words) {
      if (line.length && lineWidth([...line, ...w]) > maxW) {
        out.push(trimEnd(line));
        line = [];
      }
      line = [...line, ...w];
    }
    if (line.length) out.push(trimEnd(line));
    return out;
  });
}
function trimEnd(l: Line): Line {
  const last = l[l.length - 1];
  return last ? [...l.slice(0, -1), { ...last, text: last.text.replace(/\s+$/, '') }] : l;
}

// ---- layout ----

export interface SchemeItem {
  c: Component;
  w: number;
  h: number;
  /** Lines under the structure (its name). */
  name: Line[];
}

interface Placed extends SchemeItem {
  x: number;
  y: number;
  /** Baseline of the first name line (the same for every structure). */
  nameY: number;
}

export interface SchemeLayout {
  width: number;
  height: number;
  items: Placed[];
  plus: { x: number; y: number }[];
  arrow: { x1: number; x2: number; y: number };
  above: { lines: Line[]; ys: number[] };
  below: { lines: Line[]; ys: number[] };
}

/**
 * Drawing style: the ChemDraw / ACS layout in black and white ('mono') or with
 * atoms coloured by element ('cdcolor'), or the classic look ('color') — each
 * structure as a coloured RDKit drawing in a box of the same size.
 */
export type ReportLook = 'mono' | 'cdcolor' | 'color';
export const REPORT_LOOKS: readonly ReportLook[] = ['mono', 'cdcolor', 'color'];

/** Classic structure box (the reports' former 34 mm drawings, scaled to 10 pt text). */
const CLASSIC = { w: 250, h: 181, src: { w: 200, h: 145 } };

/** 'abbr': write a compound's abbreviation (`abbr`, when set) instead of its name. */
export type SchemeLabels = 'abbr' | 'name';

const labelOf = (c: Component, labels: SchemeLabels) => (labels === 'abbr' && c.abbr) || c.name;
/** Text drawn in place of a missing structure. */
const standIn = (c: Component, labels: SchemeLabels) => (labels === 'abbr' && c.abbr) || c.formula || c.name;

const agentLabel = (c: Component, labels: SchemeLabels) =>
  c.role === 'catalyst' ? `${labelOf(c, labels)} (${+(c.equiv * 100).toFixed(2)} mol%)` : labelOf(c, labels);

export function schemeText(rxn: Reaction, labels: SchemeLabels = 'abbr'): { above: Line[]; below: Line[] } {
  const above = rxn.components.filter((c) => c.role === 'reagent' || c.role === 'catalyst').map((c) => richText(agentLabel(c, labels), c.id));
  const below = rxn.components.filter((c) => c.role === 'solvent').map((c) => richText(labelOf(c, labels), c.id));
  const belowLines = wrap(below, MAX_TEXT_W);
  if (rxn.conditions?.trim()) belowLines.push(...wrap([richText(rxn.conditions.trim())], MAX_TEXT_W));
  return { above: wrap(above, MAX_TEXT_W), below: belowLines };
}

/** Label lines under a structure at most `w` wide (at least ~5 bonds). */
export function nameLines(c: Component, w: number, labels: SchemeLabels = 'abbr'): Line[] {
  const text = labelOf(c, labels);
  return text ? wrap([richText(text, c.id)], Math.max(w, BOND * 5)) : [];
}

/** Layout item for a compound: its structure box, or (none) its abbreviation / formula / name as text. */
function itemFor(c: Component, labels: SchemeLabels, box: { w: number; h: number } | null): SchemeItem {
  if (box) return { c, ...box, name: nameLines(c, box.w, labels) };
  const w = lineWidth(richText(standIn(c, labels))) + BOND * 0.4;
  return { c, w, h: BOND * 1.4, name: standIn(c, labels) !== labelOf(c, labels) ? nameLines(c, w, labels) : [] };
}

/** Reactants, products and arrow text; null when there is nothing to draw. */
function schemeParts(rxn: Reaction, labels: SchemeLabels) {
  const left = rxn.components.filter((c) => c.role === 'reactant');
  const right = rxn.components.filter((c) => c.role === 'product');
  const { above, below } = schemeText(rxn, labels);
  return left.length || right.length || above.length || below.length ? { left, right, above, below } : null;
}

export function layoutScheme(left: SchemeItem[], right: SchemeItem[], above: Line[], below: Line[], minArrow = BOND * 3.5): SchemeLayout {
  const textW = Math.max(0, ...above.map(lineWidth), ...below.map(lineWidth));
  const arrowLen = Math.max(minArrow, textW + BOND * 0.8);
  const all = [...left, ...right];
  const halfH = Math.max(BOND, ...all.map((it) => it.h / 2));

  // Horizontal pass, y measured from the arrow (y = 0).
  const items: Placed[] = [];
  const plus: { x: number; y: number }[] = [];
  let x = 0;
  const side = (list: SchemeItem[]) =>
    list.forEach((it, i) => {
      if (i) {
        plus.push({ x: x + GAP + FS * 0.3, y: 0 });
        x += GAP * 2 + FS * 0.6;
      }
      const nameW = Math.max(0, ...it.name.map(lineWidth));
      const slot = Math.max(it.w, nameW);
      items.push({ ...it, x: x + (slot - it.w) / 2, y: -it.h / 2, nameY: halfH + FS * 0.35 + ASC }); // names share one baseline
      x += slot;
    });
  side(left);
  if (left.length) x += GAP;
  const arrow = { x1: x, x2: x + arrowLen, y: 0 };
  x += arrowLen;
  if (right.length) x += GAP;
  side(right);

  const aboveYs = above.map((_, i) => -FS * 0.45 - DESC - (above.length - 1 - i) * LINE_H);
  const belowYs = below.map((_, i) => FS * 0.45 + ASC + i * LINE_H);

  const top = Math.min(-halfH, ...aboveYs.map((y) => y - ASC));
  const bottom = Math.max(
    halfH,
    ...belowYs.map((y) => y + DESC),
    ...items.map((it) => it.nameY + (it.name.length - 1) * LINE_H + DESC),
  );
  const m = BOND * 0.3;
  const dy = m - top;
  return {
    width: x + 2 * m,
    height: bottom - top + 2 * m,
    items: items.map((it) => ({ ...it, x: it.x + m, y: it.y + dy, nameY: it.nameY + dy })),
    plus: plus.map((p) => ({ x: p.x + m, y: p.y + dy })),
    arrow: { x1: arrow.x1 + m, x2: arrow.x2 + m, y: dy },
    above: { lines: above, ys: aboveYs.map((y) => y + dy) },
    below: { lines: below, ys: belowYs.map((y) => y + dy) },
  };
}

// ---- SVG ----

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (v: number) => +v.toFixed(2);

const BLACK: Record<number, number[]> = {};
for (let z = 0; z <= 118; z++) BLACK[z] = [0, 0, 0];

type MolSvg = { body: string; w: number; h: number };
const molCache = new Map<string, MolSvg | null>();

/** One structure in the given style; `body` is the inner SVG markup. Cached: the on-screen scheme is redrawn on every edit. */
export function molSvg(rd: MainModule, smiles: string, style: ReportLook = 'mono'): MolSvg | null {
  const key = `${style}:${smiles}`;
  if (molCache.has(key)) return molCache.get(key)!;
  const out = style === 'color' ? classicMol(rd, smiles) : drawMol(rd, smiles, style === 'cdcolor');
  if (molCache.size >= 300) molCache.delete(molCache.keys().next().value!);
  molCache.set(key, out);
  return out;
}

/** The inner markup and size of an RDKit SVG. */
function svgBody(svg: string): MolSvg | null {
  const size = svg.match(/viewBox='0 0 ([\d.]+) ([\d.]+)'/);
  const start = svg.indexOf('<!-- END OF HEADER -->');
  if (!size || start < 0) return null;
  return { body: svg.slice(start + '<!-- END OF HEADER -->'.length, svg.lastIndexOf('</svg>')).trim(), w: +size[1], h: +size[2] };
}

/** Classic: the app's coloured drawing, fitted to a fixed box. */
function classicMol(rd: MainModule, smiles: string): MolSvg | null {
  const svg = smilesToSvg(rd, smiles, CLASSIC.src.w, CLASSIC.src.h);
  const m = svg ? svgBody(svg) : null;
  if (!m) return null;
  const k = CLASSIC.w / m.w;
  return { body: `<g transform="scale(${n2(k)})">${m.body}</g>`, w: CLASSIC.w, h: m.h * k };
}

/** ACS 1996 proportions, black or with RDKit's atom colours. */
function drawMol(rd: MainModule, smiles: string, color: boolean): MolSvg | null {
  const mol = rd.get_mol(smiles);
  if (!mol) return null;
  try {
    const svg = mol.get_svg_with_highlights(
      JSON.stringify({
        width: -1,
        height: -1,
        fixedBondLength: BOND,
        bondLineWidth: 0.6 / PT,
        scaleBondWidth: false,
        multipleBondOffset: 0.18,
        fixedFontSize: Math.round(FS * 0.95),
        additionalAtomLabelPadding: 0.05,
        padding: 0.04,
        clearBackground: false,
        ...(color ? {} : { atomColourPalette: BLACK }),
      }),
    );
    const m = svgBody(svg);
    // Anything still coloured (e.g. stereo annotations) goes black too.
    if (m && !color) m.body = m.body.replace(/#(?!000000)[0-9A-Fa-f]{6}\b/g, '#000000');
    return m;
  } finally {
    mol.delete();
  }
}

function svgText(l: Line, cx: number, y: number, interactive: boolean, fill?: string): string {
  const off = FS * 0.22;
  let shift = 0;
  const span = (r: TextRun) => {
    const want = r.sub ? off : 0;
    const dy = want - shift;
    shift = want;
    const attrs = [dy ? `dy="${n2(dy)}"` : '', r.sub ? `font-size="${n2(FS * SUB)}"` : ''].filter(Boolean);
    return `<tspan${attrs.length ? ' ' + attrs.join(' ') : ''}>${esc(r.text)}</tspan>`;
  };
  // Consecutive runs of one compound share a clickable group.
  let out = '';
  let open: string | undefined;
  for (const r of l.filter((r) => r.text)) {
    const cid = interactive ? r.cid : undefined;
    if (cid !== open) {
      if (open) out += '</tspan>';
      if (cid) out += `<tspan data-cid="${esc(cid)}">`;
      open = cid;
    }
    out += span(r);
  }
  if (open) out += '</tspan>';
  return `<text x="${n2(cx)}" y="${n2(y)}" text-anchor="middle"${fill ? ` fill="${fill}"` : ''}>${out}</text>`;
}

export interface SchemeSvgOptions {
  /** Add data-cid hooks for clicking a compound on screen. */
  interactive?: boolean;
  /** Paint a white background (PNG / Word). */
  background?: boolean;
  /** Abbreviations (default) or full names. */
  labels?: SchemeLabels;
  /** Drawing style (default ChemDraw black and white). */
  style?: ReportLook;
}

/** The whole scheme as one standalone SVG (null when there is nothing to draw). */
export function schemeSvg(rd: MainModule | null, rxn: Reaction, opts: SchemeSvgOptions = {}): { svg: string; width: number; height: number } | null {
  const labels = opts.labels ?? 'abbr';
  const style = opts.style ?? 'mono';
  const classic = style === 'color';
  const parts0 = schemeParts(rxn, labels);
  if (!parts0) return null;
  const { left, right, above, below } = parts0;

  const bodies = new Map<string, string>();
  const item = (c: Component): SchemeItem => {
    const mol = rd && c.smiles ? molSvg(rd, c.smiles, style) : null;
    if (mol) bodies.set(c.id, mol.body);
    return itemFor(c, labels, mol);
  };
  const L = layoutScheme(left.map(item), right.map(item), above, below, classic ? CLASSIC.w * 0.8 : undefined);
  const i = !!opts.interactive;
  // Classic: names in grey and slightly heavier lines, as the reports had them.
  const nameFill = classic ? '#555555' : undefined;
  const lw = n2((classic ? 0.9 : 0.6) / PT);

  const parts: string[] = [];
  if (opts.background) parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  for (const it of L.items) {
    const body = bodies.get(it.c.id);
    const g: string[] = [];
    if (i) g.push(`<rect class="cd-hit" x="${n2(it.x)}" y="${n2(it.y)}" width="${n2(it.w)}" height="${n2(it.h)}" fill="transparent"/>`);
    if (body) g.push(`<g transform="translate(${n2(it.x)},${n2(it.y)})">${body}</g>`);
    else g.push(svgText(richText(standIn(it.c, labels)), it.x + it.w / 2, it.y + it.h / 2 + FS * 0.35, false).replace('<text ', '<text font-weight="bold" '));
    it.name.forEach((l, k) => g.push(svgText(l, it.x + it.w / 2, it.nameY + k * LINE_H, false, nameFill)));
    parts.push(i ? `<g class="cd-item" data-cid="${esc(it.c.id)}">${g.join('')}</g>` : g.join('\n'));
  }
  for (const p of L.plus) {
    const s = FS * 0.35;
    parts.push(`<path d="M${n2(p.x - s)},${n2(p.y)}H${n2(p.x + s)}M${n2(p.x)},${n2(p.y - s)}V${n2(p.y + s)}" stroke="#000" stroke-width="${lw}"/>`);
  }
  const { x1, x2, y } = L.arrow;
  const head = BOND * 0.36;
  const hw = head * 0.32;
  parts.push(
    `<path d="M${n2(x1 + 2)},${n2(y)}H${n2(x2 - head * 0.8)}" stroke="#000" stroke-width="${lw}"/>` +
      `<path d="M${n2(x2)},${n2(y)}L${n2(x2 - head)},${n2(y - hw)}L${n2(x2 - head * 0.8)},${n2(y)}L${n2(x2 - head)},${n2(y + hw)}Z" fill="#000"/>`,
  );
  const cx = (x1 + x2) / 2;
  L.above.lines.forEach((l, k) => parts.push(svgText(l, cx, L.above.ys[k], i)));
  L.below.lines.forEach((l, k) => parts.push(svgText(l, cx, L.below.ys[k], i)));

  const W = n2(L.width);
  const H = n2(L.height);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${n2(W * PT)}pt" height="${n2(H * PT)}pt" viewBox="0 0 ${W} ${H}">\n` +
    `<g font-family="${FONT}" font-size="${n2(FS)}" fill="#000000">\n${parts.join('\n')}\n</g>\n</svg>\n`;
  return { svg, width: W, height: H };
}

/** Rasterize an SVG from {@link schemeSvg} (browser only). `scale` = pixels per pt. */
export async function svgToPng(svg: string, width: number, height: number, scale = 4): Promise<Blob | null> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * PT * scale);
  canvas.height = Math.round(height * PT * scale);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

/** Size of the scheme in points (for placing it in a document). */
export const unitsToPt = (v: number) => v * PT;

// ---- molblock parsing (for CDXML) ----

interface MolAtom {
  x: number;
  y: number;
  symbol: string;
  charge: number;
  isotope: number;
  hs: number;
}
interface MolBond {
  a: number;
  b: number;
  order: number;
  stereo: number;
}

function parseMolblock(mb: string): { atoms: MolAtom[]; bonds: MolBond[] } | null {
  const lines = mb.split(/\r?\n/);
  const counts = lines[3];
  if (!counts || !/V2000/.test(counts)) return null;
  const na = +counts.slice(0, 3);
  const nb = +counts.slice(3, 6);
  const atoms: MolAtom[] = [];
  for (let i = 0; i < na; i++) {
    const l = lines[4 + i];
    const ch = +l.slice(36, 39) || 0;
    atoms.push({ x: +l.slice(0, 10), y: +l.slice(10, 20), symbol: l.slice(31, 34).trim(), charge: ch ? 4 - ch : 0, isotope: 0, hs: 0 });
  }
  const bonds: MolBond[] = [];
  for (let i = 0; i < nb; i++) {
    const l = lines[4 + na + i];
    bonds.push({ a: +l.slice(0, 3) - 1, b: +l.slice(3, 6) - 1, order: +l.slice(6, 9), stereo: +l.slice(9, 12) || 0 });
  }
  for (const l of lines.slice(4 + na + nb)) {
    const m = l.match(/^M {2}(CHG|ISO)\s*(\d+)(.*)$/);
    if (!m) continue;
    const vals = m[3].trim().split(/\s+/).map(Number);
    for (let k = 0; k + 1 < vals.length; k += 2) {
      const a = atoms[vals[k] - 1];
      if (!a) continue;
      if (m[1] === 'CHG') a.charge = vals[k + 1];
      else a.isotope = vals[k + 1];
    }
  }
  return { atoms, bonds };
}

const Z: Record<string, number> = Object.fromEntries(SYMBOL_BY_Z.map((s, z) => [s, z]).filter(([s]) => s));

interface CdMol {
  atoms: MolAtom[];
  bonds: MolBond[];
  /** Bounding box of the atoms, in units. */
  minX: number;
  minY: number;
  w: number;
  h: number;
}

/** 2D structure in drawing units (y down), with implicit H counts. */
export function molForCdxml(rd: MainModule, smiles: string): CdMol | null {
  const mol = rd.get_mol(smiles);
  if (!mol) return null;
  try {
    const parsed = parseMolblock(mol.get_molblock());
    if (!parsed) return null;
    const json = JSON.parse(mol.get_json()) as { defaults: { atom: { impHs: number } }; molecules: { atoms: { impHs?: number }[] }[] };
    const ja = json.molecules[0]?.atoms ?? [];
    const k = BOND / 1.5;
    parsed.atoms.forEach((a, i) => {
      a.x *= k;
      a.y *= -k;
      a.hs = ja[i]?.impHs ?? json.defaults.atom.impHs ?? 0;
    });
    const xs = parsed.atoms.map((a) => a.x);
    const ys = parsed.atoms.map((a) => a.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { ...parsed, minX, minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
  } finally {
    mol.delete();
  }
}

// ---- CDXML ----

/** <s> runs of a line: digits of formulas as subscripts (face 32). */
const cdRuns = (l: Line, bold = false) =>
  l
    .filter((r) => r.text)
    .map((r) => {
      const face = (bold ? 1 : 0) | (r.sub ? 32 : 0);
      return `<s font="3" size="10" color="0"${face ? ` face="${face}"` : ''}>${esc(r.text)}</s>`;
    })
    .join('');

/** ChemDraw document of the scheme: editable structures, arrow, text and the reaction step. */
export function schemeCdxml(rd: MainModule | null, rxn: Reaction, labels: SchemeLabels = 'abbr'): string | null {
  const parts0 = schemeParts(rxn, labels);
  if (!parts0) return null;
  const { left, right, above, below } = parts0;

  const pad = BOND * 0.45; // room for atom labels around the atom box
  const mols = new Map<string, CdMol>();
  const item = (c: Component): SchemeItem => {
    const m = rd && c.smiles ? molForCdxml(rd, c.smiles) : null;
    if (m) mols.set(c.id, m);
    return itemFor(c, labels, m && { w: m.w + 2 * pad, h: m.h + 2 * pad });
  };
  const L = layoutScheme(left.map(item), right.map(item), above, below);

  let id = 1;
  const next = () => id++;
  const P = (v: number) => n2(v * PT + 36); // half-inch page margin
  const out: string[] = [];
  const objectId = new Map<string, number>();
  const textIds = { above: [] as number[], below: [] as number[] };

  const text = (l: Line, cx: number, y: number, bold = false) => {
    const tid = next();
    const w = lineWidth(l);
    out.push(
      `<t id="${tid}" p="${P(cx)} ${P(y)}" BoundingBox="${P(cx - w / 2)} ${P(y - ASC)} ${P(cx + w / 2)} ${P(y + DESC)}" Justification="Center" InterpretChemically="no">` +
        cdRuns(l, bold) +
        `</t>`,
    );
    return tid;
  };

  for (const it of L.items) {
    const m = mols.get(it.c.id);
    if (m) {
      const fid = next();
      objectId.set(it.c.id, fid);
      const ox = it.x + pad - m.minX;
      const oy = it.y + pad - m.minY;
      const nodeIds = m.atoms.map(() => next());
      const nodes = m.atoms.map((a, k) => {
        const z = Z[a.symbol] ?? 0;
        const attrs = [`id="${nodeIds[k]}"`, `p="${P(a.x + ox)} ${P(a.y + oy)}"`];
        if (z !== 6) attrs.push(z ? `Element="${z}"` : 'NodeType="GenericNickname"');
        if (a.charge) attrs.push(`Charge="${a.charge}"`);
        if (a.isotope) attrs.push(`Isotope="${a.isotope}"`);
        const labelled = z !== 6 || a.charge || a.isotope;
        if (!labelled) return `<n ${attrs.join(' ')}/>`;
        attrs.push(`NumHydrogens="${a.hs}"`);
        const label = (z ? a.symbol : 'R') + (a.hs ? 'H' + (a.hs > 1 ? a.hs : '') : '');
        const lx = P(a.x + ox) - 3.5;
        const ly = P(a.y + oy) + 3.5;
        return `<n ${attrs.join(' ')}><t p="${n2(lx)} ${n2(ly)}" LabelJustification="Left"><s font="3" size="10" color="0" face="96">${esc(label)}</s></t></n>`;
      });
      const bonds = m.bonds.map((b) => {
        const attrs = [`id="${next()}"`, `B="${nodeIds[b.a]}"`, `E="${nodeIds[b.b]}"`];
        if (b.order === 2 || b.order === 3) attrs.push(`Order="${b.order}"`);
        else if (b.order === 4) attrs.push('Order="1.5"');
        if (b.stereo === 1) attrs.push('Display="WedgeBegin"');
        else if (b.stereo === 6) attrs.push('Display="WedgedHashBegin"');
        else if (b.stereo === 4) attrs.push('Display="Wavy"');
        return `<b ${attrs.join(' ')}/>`;
      });
      out.push(`<fragment id="${fid}">\n${nodes.join('\n')}\n${bonds.join('\n')}\n</fragment>`);
    } else {
      objectId.set(it.c.id, text(richText(standIn(it.c, labels)), it.x + it.w / 2, it.y + it.h / 2 + FS * 0.35, true));
    }
    it.name.forEach((l, k) => text(l, it.x + it.w / 2, it.nameY + k * LINE_H));
  }
  for (const p of L.plus) {
    const s = FS * 0.35;
    out.push(`<graphic id="${next()}" BoundingBox="${P(p.x + s)} ${P(p.y + s)} ${P(p.x - s)} ${P(p.y - s)}" GraphicType="Symbol" SymbolType="Plus"/>`);
  }
  const cx = (L.arrow.x1 + L.arrow.x2) / 2;
  L.above.lines.forEach((l, k) => textIds.above.push(text(l, cx, L.above.ys[k])));
  L.below.lines.forEach((l, k) => textIds.below.push(text(l, cx, L.below.ys[k])));
  const arrowId = next();
  const { x1, x2, y } = L.arrow;
  out.push(
    `<arrow id="${arrowId}" BoundingBox="${P(x1)} ${P(y) - 2} ${P(x2)} ${P(y) + 2}" FillType="None" ArrowheadHead="Full" ArrowheadType="Solid" ` +
      `HeadSize="1000" ArrowheadCenterSize="875" ArrowheadWidth="250" Head3D="${P(x2)} ${P(y)} 0" Tail3D="${P(x1)} ${P(y)} 0"/>`,
  );
  const ids = (list: Component[]) => list.map((c) => objectId.get(c.id)).filter(Boolean).join(' ');
  const step = [
    `id="${next()}"`,
    `ReactionStepReactants="${ids(left)}"`,
    `ReactionStepProducts="${ids(right)}"`,
    `ReactionStepArrows="${arrowId}"`,
    textIds.above.length ? `ReactionStepObjectsAboveArrow="${textIds.above.join(' ')}"` : '',
    textIds.below.length ? `ReactionStepObjectsBelowArrow="${textIds.below.join(' ')}"` : '',
  ].filter(Boolean);
  out.push(`<scheme id="${next()}"><step ${step.join(' ')}/></scheme>`);

  const bb = `36 36 ${P(L.width)} ${P(L.height)}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" ?>\n` +
    `<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >\n` +
    `<CDXML CreationProgram="reaction_info" BoundingBox="${bb}" LabelFont="3" LabelSize="10" LabelFace="96" CaptionFont="3" CaptionSize="10" ` +
    `HashSpacing="2.5" MarginWidth="1.6" LineWidth="0.6" BoldWidth="2" BondLength="14.4" BondSpacing="18" ChainAngle="120" color="0" bgcolor="1">\n` +
    `<colortable><color r="1" g="1" b="1"/><color r="0" g="0" b="0"/></colortable>\n` +
    `<fonttable><font id="3" charset="utf-8" name="Arial"/></fonttable>\n` +
    `<page id="${next()}" BoundingBox="0 0 ${n2(Math.max(540, P(L.width) + 36))} ${n2(Math.max(720, P(L.height) + 36))}">\n` +
    out.join('\n') +
    `\n</page>\n</CDXML>\n`
  );
}

// ---- MDL RXN ----

/** V2000 RXN file of the reactant and product structures (agents are not part of RXN). */
export function schemeRxnfile(rd: MainModule, rxn: Reaction): string | null {
  const block = (c: Component) => {
    if (!c.smiles) return null;
    const mol = rd.get_mol(c.smiles);
    if (!mol) return null;
    try {
      const mb = mol.get_molblock().split('\n');
      mb[0] = c.name.slice(0, 80);
      return mb.join('\n').replace(/\s+$/, '');
    } finally {
      mol.delete();
    }
  };
  const side = (role: Component['role']) => rxn.components.filter((c) => c.role === role).map(block).filter((b): b is string => !!b);
  const r = side('reactant');
  const p = side('product');
  if (!r.length && !p.length) return null;
  const pad = (n: number) => String(n).padStart(3);
  return ['$RXN', '', '  reaction_info', '', `${pad(r.length)}${pad(p.length)}`, ...[...r, ...p].flatMap((b) => ['$MOL', b]), ''].join('\n');
}
