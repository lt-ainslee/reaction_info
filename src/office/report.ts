// Word report and Excel workbook of a reaction (lazy-loaded; browser only).
import type { MainModule } from '@rdkit/rdkit';
import { nameWithAbbr } from '../chem/abbr';
import { smilesToSvg } from '../chem/rdkit';
import { schemeSvg, svgToPng, unitsToPt, type SchemeLabels } from '../chem/scheme';
import { formatReference, doiUrl } from '../chem/refs';
import type { ReagentLot } from '../chem/lots';
import { activeRun, runCode, runsOf, runYield } from '../chem/runs';
import { compute, dispensedByVolume, type Component, type Reaction } from '../chem/stoich';
import type { Dict } from '../i18n';
import { procedureOf, type PNode } from '../procedure/doc';
import { AMOUNT_UNITS, fmt, MASS_UNITS, VOLUME_UNITS, type Units } from '../units';
import { buildDocx, p, type Block, type Run } from './docx';
import { buildXlsx, type Cell, type Sheet } from './xlsx';

export interface ReportInput {
  rxn: Reaction;
  units: Units;
  t: Dict;
  rd: MainModule | null;
  /** Library data of the lots used (identity check, spectra count). */
  lots?: Map<string, ReagentLot>;
  /** Scheme text: abbreviations (components carry them, see withAbbrs) or names. */
  labels?: SchemeLabels;
  /** Scheme structures with atom colours (default black and white, ChemDraw style). */
  schemeColor?: boolean;
}

// ---- procedure (Tiptap JSON) → Word blocks ----

function runsOfInline(n: PNode, base: Partial<Run> = {}): Run[] {
  if (n.type === 'text') {
    const r: Run = { text: n.text ?? '', ...base };
    for (const m of n.marks ?? []) {
      if (m.type === 'bold') r.b = true;
      else if (m.type === 'italic') r.i = true;
      else if (m.type === 'underline') r.u = true;
      else if (m.type === 'strike') r.s = true;
      else if (m.type === 'subscript') r.sub = true;
      else if (m.type === 'superscript') r.sup = true;
      else if (m.type === 'link') r.color = '2F5FD0';
    }
    return [r];
  }
  if (n.type === 'hardBreak') return [{ text: '\n' }];
  return (n.content ?? []).flatMap((c) => runsOfInline(c, base));
}

export function procedureBlocks(doc: PNode, observation: string): Block[] {
  const out: Block[] = [];
  const walk = (n: PNode, indent: number, shade?: 'note' | 'obs', prefix?: Run[]) => {
    switch (n.type) {
      case 'paragraph':
        out.push(p([...(prefix ?? []), ...runsOfInline(n)], { indent: indent || undefined, shade }));
        return;
      case 'heading':
        out.push(p(runsOfInline(n), { style: 'Heading3' }));
        return;
      case 'bulletList':
      case 'orderedList': {
        const start = Number(n.attrs?.start ?? 1);
        (n.content ?? []).forEach((li, i) => {
          const mark = n.type === 'orderedList' ? `${start + i}.\t` : '•\t';
          (li.content ?? []).forEach((c, j) => {
            if (c.type === 'paragraph') {
              out.push(p([...(j === 0 ? [{ text: mark }] : []), ...runsOfInline(c)], { indent: indent + 360, hanging: j === 0 ? 360 : undefined, shade }));
            } else walk(c, indent + 360, shade);
          });
        });
        return;
      }
      case 'blockquote':
        (n.content ?? []).forEach((c) => walk(c, indent, 'note'));
        return;
      case 'observation':
        (n.content ?? []).forEach((c, i) => walk(c, indent, 'obs', i === 0 ? [{ text: `${observation}：`, b: true, color: '18794E' }] : undefined));
        return;
      case 'horizontalRule':
        out.push(p('—'.repeat(20), { align: 'center', style: 'Small' }));
        return;
      case 'table': {
        const rows = (n.content ?? []).map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).flatMap((x, i) => [...(i ? [{ text: '\n' }] : []), ...runsOfInline(x)])));
        const header = n.content?.[0]?.content?.every((c) => c.type === 'tableHeader') ?? false;
        out.push({ kind: 'table', rows, header });
        return;
      }
      default:
        (n.content ?? []).forEach((c) => walk(c, indent, shade));
    }
  };
  (doc.content ?? []).forEach((c) => walk(c, 0));
  return out;
}

// ---- reaction scheme as a PNG ----


function loadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/** The original layout: coloured RDKit drawings side by side, text over / under a plain arrow. */
async function colorSchemePng(rxn: Reaction, rd: MainModule | null, labels?: SchemeLabels): Promise<{ png: Uint8Array; width: number; height: number } | null> {
  const text = (c: Component) => (labels !== 'name' && c.abbr) || c.name;
  const left = rxn.components.filter((c) => c.role === 'reactant');
  const right = rxn.components.filter((c) => c.role === 'product');
  if (!left.length && !right.length) return null;
  const above = rxn.components.filter((c) => c.role === 'reagent' || c.role === 'catalyst').map(text).join(', ');
  const below = [rxn.components.filter((c) => c.role === 'solvent').map(text).join(', '), rxn.conditions].filter(Boolean).join('; ');
  const W = 180;
  const H = 130;
  const arrowW = Math.max(150, Math.min(320, Math.max(above.length, below.length) * 7));
  const items = [...left.map((c) => ({ c })), { arrow: true as const }, ...right.map((c) => ({ c }))];
  const plusW = 26;
  const width = items.reduce((w, it, i) => w + ('arrow' in it ? arrowW : W) + (i && !('arrow' in it) && !('arrow' in items[i - 1]) ? plusW : 0), 0) + 20;
  const height = H + 34;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, width, height);
  g.fillStyle = '#1d2330';
  g.strokeStyle = '#1d2330';
  g.textAlign = 'center';
  let xPos = 10;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if ('arrow' in it) {
      const y = H / 2 + 4;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(xPos + 8, y);
      g.lineTo(xPos + arrowW - 10, y);
      g.stroke();
      g.beginPath();
      g.moveTo(xPos + arrowW - 8, y);
      g.lineTo(xPos + arrowW - 18, y - 5);
      g.lineTo(xPos + arrowW - 18, y + 5);
      g.closePath();
      g.fill();
      g.font = '11px Arial, "Microsoft YaHei", sans-serif';
      if (above) g.fillText(above.slice(0, 60), xPos + arrowW / 2, y - 10);
      if (below) g.fillText(below.slice(0, 60), xPos + arrowW / 2, y + 18);
      xPos += arrowW;
      continue;
    }
    if (i && !('arrow' in items[i - 1])) {
      g.font = '18px Arial, sans-serif';
      g.fillText('+', xPos + plusW / 2, H / 2 + 10);
      xPos += plusW;
    }
    const svg = rd && it.c.smiles ? smilesToSvg(rd, it.c.smiles, W, H) : null;
    if (svg) {
      try {
        g.drawImage(await loadSvg(svg), xPos, 0, W, H);
      } catch {
        /* name only */
      }
    }
    g.font = '12px Arial, "Microsoft YaHei", sans-serif';
    g.fillText(text(it.c).slice(0, 28), xPos + W / 2, H + 20);
    xPos += W;
  }
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return null;
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/** The scheme as a picture: ChemDraw style (black and white, ACS size) or the original coloured layout. */
export async function schemePng(rxn: Reaction, rd: MainModule | null, labels?: SchemeLabels, color = false): Promise<{ png: Uint8Array; width: number; height: number } | null> {
  if (color) return colorSchemePng(rxn, rd, labels);
  const out = schemeSvg(rd, rxn, { background: true, labels });
  if (!out) return null;
  const blob = await svgToPng(out.svg, out.width, out.height);
  if (!blob) return null;
  const px = (v: number) => (unitsToPt(v) * 4) / 3;
  return { png: new Uint8Array(await blob.arrayBuffer()), width: px(out.width), height: px(out.height) };
}

// ---- shared helpers ----

const num = (v: number | undefined, sig = 4) => (v === undefined || !Number.isFinite(v) ? undefined : Number(v.toPrecision(sig)));

function actualText(c: Component, units: Units) {
  const a = c.actualAmount;
  if (!a) return c.actualNote ?? '';
  const byVol = dispensedByVolume(c);
  const s = byVol && a.volume ? `${fmt(a.volume / VOLUME_UNITS[units.volume])} ${units.volume}` : a.mass ? `${fmt(a.mass / MASS_UNITS[units.mass])} ${units.mass}` : '';
  return [s, c.actualNote].filter(Boolean).join(' / ');
}

const equivText = (c: Component, e: number) => (c.role === 'catalyst' ? `${fmt(e * 100, 3)} mol%` : fmt(e, 3));

// ---- Word ----

export async function wordReport({ rxn, units, t, rd, lots, labels, schemeColor }: ReportInput): Promise<Blob> {
  const run = activeRun(rxn);
  const code = runCode(rxn, run);
  const am = AMOUNT_UNITS[units.amount];
  const ms = MASS_UNITS[units.mass];
  const vl = VOLUME_UNITS[units.volume];
  const inputs = rxn.components.filter((c) => c.role !== 'product');
  const products = rxn.components.filter((c) => c.role === 'product');
  const withActual = inputs.some((c) => c.actualAmount || c.actualNote);
  const b: Block[] = [];

  b.push(p(t.report.kicker, { style: 'Small' }));
  b.push(p(rxn.title || t.report.untitled, { style: 'Title' }));
  b.push(
    p(
      [
        [t.report.notebook, code],
        [t.report.date, run.date ?? new Date().toISOString().slice(0, 10)],
        [t.runs.status, t.runs.statuses[run.status]],
        [t.report.operator, rxn.operator],
      ]
        .filter(([, v]) => v)
        .flatMap(([k, v], i) => [{ text: `${i ? '    ' : ''}${k}：` }, { text: String(v), b: true }]),
      { style: 'Small' },
    ),
  );

  const scheme = await schemePng(rxn, rd, labels, schemeColor);
  if (scheme) {
    b.push(p(t.preview, { style: 'Heading1' }));
    const k = Math.min(0.75, 450 / scheme.width); // px → pt, fit the A4 text width
    b.push({ kind: 'image', png: scheme.png, width: scheme.width * k, height: scheme.height * k });
  }
  if (rxn.conditions) b.push(p([{ text: `${t.conditions}：`, b: true }, { text: rxn.conditions }]));

  b.push(p(t.table, { style: 'Heading1' }));
  const head = [
    t.col.name, t.col.role, t.col.mw, t.col.equiv, `${t.col.amount} (${units.amount})`, `${t.col.mass} (${units.mass})`, `${t.col.volume} (${units.volume})`,
    ...(withActual ? [t.runs.actual] : []),
  ];
  b.push({
    kind: 'table',
    header: true,
    small: true,
    widths: withActual ? [2100, 850, 850, 800, 950, 950, 950, 1550] : [2700, 1000, 1000, 900, 1200, 1200, 1200],
    align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
    rows: [
      head.map((h) => [{ text: h }]),
      ...inputs.map((c) => {
        const v = compute(rxn, c);
        const solvent = c.role === 'solvent';
        return [
          [{ text: nameWithAbbr(c) + (c.id === rxn.refId ? ` (${t.col.ref})` : ''), b: c.id === rxn.refId }],
          [{ text: t.roles[c.role] }],
          [{ text: fmt(c.mw, 6) }],
          [{ text: solvent ? '—' : equivText(c, c.equiv) }],
          [{ text: solvent ? '—' : fmt(v.mmol !== undefined ? v.mmol / am : undefined) }],
          [{ text: fmt(v.mass !== undefined ? v.mass / ms : undefined) || '—', b: true }],
          [{ text: fmt(v.volume !== undefined ? v.volume / vl : undefined) || '—', b: true }],
          ...(withActual
            ? [[{ text: actualText(c, units) + (v.actualEquiv !== undefined && c.id !== rxn.refId ? ` (${equivText(c, v.actualEquiv)})` : '') }]]
            : []),
        ];
      }),
    ],
  });

  if (products.length) {
    b.push(p(t.roles.product, { style: 'Heading2' }));
    b.push({
      kind: 'table',
      header: true,
      small: true,
      widths: [2700, 1000, 800, 1200, 1300, 1300, 900],
      align: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
      rows: [
        [t.col.name, t.col.mw, t.col.equiv, `${t.col.amount} (${units.amount})`, `${t.theoMass} (${units.mass})`, `${t.actualMass} (${units.mass})`, t.yield].map((h) => [{ text: h }]),
        ...products.map((c) => {
          const v = compute(rxn, c);
          return [
            [{ text: nameWithAbbr(c) }],
            [{ text: fmt(c.mw, 6) }],
            [{ text: fmt(c.equiv, 3) }],
            [{ text: fmt(v.mmol !== undefined ? v.mmol / am : undefined) }],
            [{ text: fmt(v.theoMass !== undefined ? v.theoMass / ms : undefined) || '—' }],
            [{ text: fmt(v.mass !== undefined ? v.mass / ms : undefined) || '—' }],
            [{ text: v.yieldPct !== undefined ? `${fmt(v.yieldPct, 3)}%` : '—', b: true }],
          ];
        }),
      ],
    });
    if (run.appearance) b.push(p([{ text: `${t.runs.appearance}：`, b: true }, { text: run.appearance }]));
    if (run.conclusion) b.push(p([{ text: `${t.runs.conclusion}：`, b: true }, { text: run.conclusion }]));
  }

  const withLot = inputs.filter((c) => c.lot);
  if (withLot.length) {
    b.push(p(t.office.lots, { style: 'Heading1' }));
    b.push({
      kind: 'table',
      header: true,
      small: true,
      widths: [2000, 1500, 1700, 1600, 1000, 1400],
      rows: [
        [t.col.name, t.lots.supplier, t.lots.spec, `${t.lots.catalog} / ${t.lots.lot}`, t.col.purity, t.lots.verification].map((h) => [{ text: h }]),
        ...withLot.map((c) => {
          const l = { ...c.lot!, ...(c.lot!.lotId ? lots?.get(c.lot!.lotId) ?? {} : {}) };
          const ver = l.verification ?? 'unverified';
          return [
            [{ text: c.name }],
            [{ text: l.source === 'made' ? `${t.lots.made}${l.sourceLabel ? ` (${l.sourceLabel})` : ''}` : l.supplier ?? '' }],
            [{ text: l.spec ?? '' }],
            [{ text: [l.catalogNumber, l.lotNumber].filter(Boolean).join(' / ') }],
            [{ text: [l.purity && `${l.purity}%`, l.molarity && `${l.molarity} M`].filter(Boolean).join(' · ') }],
            [{ text: t.lots.verifications[ver], b: ver !== 'unverified', color: ver === 'ok' ? '18794E' : ver === 'issue' ? 'B4235A' : undefined }, ...(l.verificationNote ? [{ text: `\n${l.verificationNote}` }] : [])],
          ];
        }),
      ],
    });
  }

  const proc = procedureOf(rxn);
  const procBlocks = procedureBlocks(proc, t.proc.observation);
  if (procBlocks.some((x) => x.kind !== 'p' || x.runs.some((r) => r.text.trim()))) {
    b.push(p(t.notes, { style: 'Heading1' }));
    b.push(...procBlocks);
  }

  const charac = products.filter((c) => c.characterization?.trim());
  if (charac.length) {
    b.push(p(t.att.characterization, { style: 'Heading1' }));
    for (const c of charac) {
      b.push(p(c.name, { style: 'Heading3' }));
      for (const line of c.characterization!.split('\n').filter((l) => l.trim())) b.push(p(line));
    }
  }

  const refs = rxn.references ?? [];
  if (refs.length) {
    b.push(p(t.refs.title, { style: 'Heading1' }));
    refs.forEach((r, i) =>
      b.push(
        p(
          [
            { text: `[${i + 1}] ` },
            { text: formatReference(r) },
            ...(r.doi ? [{ text: ` ${doiUrl(r.doi)}`, color: '2F5FD0' }] : r.url ? [{ text: ` ${r.url}`, color: '2F5FD0' }] : []),
            ...(r.note ? [{ text: `\n${r.note}`, i: true }] : []),
          ],
          { indent: 400, hanging: 400 },
        ),
      ),
    );
  }

  return buildDocx(b, `${code} ${rxn.title}`.trim());
}

// ---- Excel ----

export function excelWorkbook({ rxn, units, t, lots }: Omit<ReportInput, 'rd'>): Blob {
  const am = AMOUNT_UNITS[units.amount];
  const ms = MASS_UNITS[units.mass];
  const vl = VOLUME_UNITS[units.volume];
  const runs = runsOf(rxn);
  const run = runs.find((r) => r.active)!;

  // 1. Table of the current run.
  const table: Cell[][] = [
    [
      t.col.name, t.col.role, 'CAS', t.col.mw, t.col.equiv, `${t.col.amount} (${units.amount})`, `${t.col.mass} (${units.mass})`, `${t.col.volume} (${units.volume})`,
      `${t.runs.actual} (${units.mass})`, `${t.runs.actual} (${units.volume})`, t.lots.actualNote, `${t.yield} %`,
    ],
    ...rxn.components.map((c) => {
      const v = compute(rxn, c);
      const product = c.role === 'product';
      return [
        nameWithAbbr(c) + (c.id === rxn.refId ? ' *' : ''),
        t.roles[c.role],
        c.cas,
        num(c.mw, 6),
        c.role === 'solvent' ? undefined : num(c.equiv),
        c.role === 'solvent' ? undefined : num(v.mmol !== undefined ? v.mmol / am : undefined),
        num((product ? v.theoMass : v.mass) !== undefined ? (product ? v.theoMass! : v.mass!) / ms : undefined),
        num(v.volume !== undefined ? v.volume / vl : undefined),
        num(product ? (c.actualMass !== undefined ? c.actualMass / ms : undefined) : c.actualAmount?.mass !== undefined ? c.actualAmount.mass / ms : undefined),
        num(c.actualAmount?.volume !== undefined ? c.actualAmount.volume / vl : undefined),
        c.actualNote,
        num(v.yieldPct, 3),
      ];
    }),
  ];

  // 2. All runs side by side (one row per run).
  const compounds = new Map<string, string>();
  for (const r of runs) for (const c of r.data.components) if (c.role !== 'product' && c.role !== 'solvent') compounds.set(c.id, c.name);
  const runsSheet: Cell[][] = [
    [
      t.office.run, t.runs.date, t.runs.status, t.office.scale, t.conditions, `${t.yield} %`, t.runs.appearance, t.runs.conclusion, t.runs.operator,
      ...[...compounds.values()].map((n) => `${n} (${t.col.equiv})`),
    ],
    ...runs.map((r) => {
      const d = r.data as Reaction;
      const eq = (id: string) => {
        const c = d.components.find((x) => x.id === id);
        if (!c) return undefined;
        const v = compute(d, c);
        return num(v.actualEquiv ?? c.equiv, 3);
      };
      return [
        runCode(rxn, r), r.date, t.runs.statuses[r.status], num(d.refMmol), d.conditions, num(runYield(r.data), 3), r.appearance, r.conclusion, d.operator,
        ...[...compounds.keys()].map(eq),
      ];
    }),
  ];

  // 3. Reagent lots used in each run.
  const lotsSheet: Cell[][] = [
    [t.office.run, t.col.name, t.lots.supplier, t.lots.spec, t.lots.catalog, t.lots.lot, t.lots.purity, t.lots.molarity, t.lots.received, t.lots.verification, t.lots.verificationNote],
  ];
  for (const r of runs)
    for (const c of r.data.components) {
      if (!c.lot) continue;
      const l = { ...c.lot, ...(c.lot.lotId ? lots?.get(c.lot.lotId) ?? {} : {}) };
      lotsSheet.push([
        runCode(rxn, r), c.name, l.source === 'made' ? `${t.lots.made} ${l.sourceLabel ?? ''}`.trim() : l.supplier, l.spec, l.catalogNumber, l.lotNumber,
        num(l.purity), num(l.molarity), l.receivedAt, t.lots.verifications[l.verification ?? 'unverified'], l.verificationNote,
      ]);
    }

  const sheets: Sheet[] = [
    { name: `${t.office.sheetTable} ${runCode(rxn, run)}`, rows: table, widths: [26, 9, 12, 10, 8, 12, 12, 12, 12, 12, 18, 9] },
    { name: t.office.sheetRuns, rows: runsSheet, widths: [14, 11, 8, 10, 22, 8, 14, 30, 10, ...[...compounds].map(() => 14)] },
  ];
  if (lotsSheet.length > 1) sheets.push({ name: t.office.sheetLots, rows: lotsSheet, widths: [14, 22, 14, 18, 12, 12, 10, 10, 12, 10, 28] });
  const refs = rxn.references ?? [];
  if (refs.length)
    sheets.push({
      name: t.office.sheetRefs,
      rows: [['#', t.refs.citation, 'DOI', t.refs.url, t.refs.note], ...refs.map((r, i) => [i + 1, formatReference(r), r.doi, r.url, r.note])],
      widths: [4, 80, 28, 30, 30],
    });
  return buildXlsx(sheets);
}

