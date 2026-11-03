// LaTeX experiment record of a reaction in the Kami style (kamidoc.cls,
// "实验记录" layout): the .tex source plus what it needs to compile —
// the class file and the scheme picture. Compile with xelatex (twice).
import { nameWithAbbr } from '../chem/abbr';
import type { ReagentLot } from '../chem/lots';
import { doiUrl, formatReference } from '../chem/refs';
import { activeRun, runCode } from '../chem/runs';
import { compute, dispensedByVolume, type Component, type Reaction } from '../chem/stoich';
import type { Dict } from '../i18n';
import { procedureOf, type PNode } from '../procedure/doc';
import { AMOUNT_UNITS, fmt, MASS_UNITS, VOLUME_UNITS, type Units } from '../units';

export interface TexInput {
  rxn: Reaction;
  units: Units;
  t: Dict;
  lots?: Map<string, ReagentLot>;
  /** The scheme picture next to the .tex file (path as \includegraphics takes it) and its printed width. */
  scheme?: { file: string; widthPt: number } | null;
  /** Today, YYYY-MM-DD (when the run has no date). */
  today?: string;
}

// ---- text ----

const SPECIAL: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '^': '\\textasciicircum{}',
  _: '\\_',
  '%': '\\%',
  '~': '\\textasciitilde{}',
};
const SUB = '₀₁₂₃₄₅₆₇₈₉₊₋';
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻';
const PLAIN = '0123456789+-';
// Greek letters (δ, J couplings, α/β…) go through math so any font works.
const GREEK: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', κ: 'kappa', λ: 'lambda',
  μ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
  Δ: 'Delta', Γ: 'Gamma', Θ: 'Theta', Λ: 'Lambda', Π: 'Pi', Σ: 'Sigma', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega',
};

/** Plain text → LaTeX (one line): special characters escaped, ₂ / ⁺ as sub- / superscripts. */
export function tex(s: string | undefined): string {
  if (!s) return '';
  let out = '';
  const chars = [...s.replace(/\r\n?/g, '\n')];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const sub = SUB.indexOf(c);
    const sup = SUP.indexOf(c);
    if (sub >= 0 || sup >= 0) {
      const set = sub >= 0 ? SUB : SUP;
      let run = '';
      while (i < chars.length && set.includes(chars[i])) run += PLAIN[set.indexOf(chars[i++])];
      i--;
      out += `${sub >= 0 ? '\\textsubscript' : '\\textsuperscript'}{${run}}`;
    } else if (SPECIAL[c]) out += SPECIAL[c];
    else if (GREEK[c]) out += `\\ensuremath{\\${GREEK[c]}}`;
    else if (c === 'µ') out += '\\ensuremath{\\mu}';
    else if (c === '\n' || c === '\t') out += ' ';
    else out += c;
  }
  return out;
}

/** A compound name that may break after ) ] , - / (long IUPAC names in narrow table columns). */
export const texName = (s: string | undefined) => tex(s).replace(/([)\],/-])(?=[^\s)\],/\\{}-])/g, '$1\\allowbreak{}');

const url = (u: string) => `\\href{${u.replace(/[\\{}%#]/g, (c) => `\\${c}`)}}{\\code{${tex(u)}}}`;

// ---- procedure (Tiptap JSON) → LaTeX ----

function inline(n: PNode): string {
  if (n.type === 'hardBreak') return '\\\\\n';
  if (n.type !== 'text') return (n.content ?? []).map(inline).join('');
  let out = tex(n.text);
  for (const m of n.marks ?? []) {
    if (m.type === 'bold') out = `\\textbf{${out}}`;
    else if (m.type === 'italic') out = `\\textit{${out}}`;
    else if (m.type === 'underline') out = `\\underline{${out}}`;
    else if (m.type === 'subscript') out = `\\textsubscript{${out}}`;
    else if (m.type === 'superscript') out = `\\textsuperscript{${out}}`;
    else if (m.type === 'link' && typeof m.attrs?.href === 'string' && /^(https?:|mailto:)/i.test(m.attrs.href)) {
      out = `\\href{${m.attrs.href.replace(/[\\{}%#]/g, (c) => `\\${c}`)}}{${out}}`;
    }
  }
  return out;
}

/** One table cell: paragraphs joined by spaces (a cell is one line in ktable). */
const cellText = (n: PNode) => (n.content ?? []).map((p) => inline(p).replace(/\\\\\n/g, ' ')).join(' ');

/** A paragraph's text without line breaks at its ends (LaTeX rejects those). */
const para = (n: PNode) => inline(n).replace(/^(\s|\\\\)+|(\s|\\\\)+$/g, '');

export function procedureTex(doc: PNode, observation: string): string {
  const blocks = (ns: PNode[] | undefined): string => (ns ?? []).map(block).filter(Boolean).join('\n\n');
  function block(n: PNode): string {
    switch (n.type) {
      case 'paragraph':
        return para(n);
      case 'heading':
        return `\\subsection{${inline(n).replace(/\\\\\n/g, ' ')}}`;
      case 'bulletList':
      case 'orderedList': {
        const env = n.type === 'orderedList' ? 'enumerate' : 'itemize';
        const start = Math.trunc(Number(n.attrs?.start ?? 1));
        const opt = env === 'enumerate' && Number.isFinite(start) && start !== 1 ? `[start=${start}]` : '';
        const items = (n.content ?? []).map((li) => `  \\item ${blocks(li.content) || '~'}`);
        return items.length ? `\\begin{${env}}${opt}\n${items.join('\n')}\n\\end{${env}}` : '';
      }
      case 'blockquote':
        return `\\begin{quote}\n${blocks(n.content)}\n\\end{quote}`;
      case 'observation':
        return `\\begin{card}[${tex(observation)}]\n${blocks(n.content)}\n\\end{card}`;
      case 'horizontalRule':
        return '\\noindent{\\color{border}\\rule{\\linewidth}{0.4pt}}';
      case 'table': {
        const rows = (n.content ?? []).map((r) => (r.content ?? []).map(cellText));
        const cols = Math.max(0, ...rows.map((r) => r.length));
        if (!cols) return '';
        // ktable styles row 1 as the header; without one, start with an empty row.
        const header = n.content?.[0]?.content?.every((c) => c.type === 'tableHeader') ?? false;
        const body = header ? rows : [Array(cols).fill(''), ...rows];
        return ktable(`X[l]`.repeat(cols), body);
      }
      default:
        return blocks(n.content);
    }
  }
  return blocks(doc.content).trim();
}

// ---- tables ----

/** A Kami table: rows of LaTeX cells (row 1 = header), each cell braced so "[" or "," are safe. */
function ktable(colspec: string, rows: string[][], title?: string): string {
  const cols = rows[0]?.length ?? 0;
  const line = (r: string[]) => Array.from({ length: cols }, (_, i) => `{${r[i] ?? ''}}`).join(' & ') + ' \\\\';
  return [
    ...(title ? [`\\tabletitle{${title}}`] : []),
    `\\begin{ktable}{colspec={${colspec}}}`,
    ...rows.map(line),
    '\\end{ktable}',
  ].join('\n');
}

const equivText = (c: Component, e: number) => (c.role === 'catalyst' ? `${fmt(e * 100, 3)} mol\\%` : fmt(e, 3));

function actualText(c: Component, units: Units) {
  const a = c.actualAmount;
  if (!a) return tex(c.actualNote);
  const byVol = dispensedByVolume(c);
  const s = byVol && a.volume ? `${fmt(a.volume / VOLUME_UNITS[units.volume])} ${units.volume}` : a.mass ? `${fmt(a.mass / MASS_UNITS[units.mass])} ${units.mass}` : '';
  return [tex(s), tex(c.actualNote)].filter(Boolean).join(' / ');
}

// ---- document ----

export function texReport({ rxn, units, t, lots, scheme, today }: TexInput): string {
  const run = activeRun(rxn);
  const code = runCode(rxn, run);
  const am = AMOUNT_UNITS[units.amount];
  const ms = MASS_UNITS[units.mass];
  const vl = VOLUME_UNITS[units.volume];
  const k = t.tex;
  const inputs = rxn.components.filter((c) => c.role !== 'product');
  const products = rxn.components.filter((c) => c.role === 'product');
  const withActual = inputs.some((c) => c.actualAmount || c.actualNote);
  const u = (s: string | undefined) => tex(s);

  const yields = products.map((c) => ({ c, v: compute(rxn, c) })).filter((x) => x.v.yieldPct !== undefined);
  const best = yields.sort((a, b) => b.v.yieldPct! - a.v.yieldPct!)[0];
  const date = run.date ?? today ?? new Date().toISOString().slice(0, 10);

  const L: string[] = [];
  L.push(
    '% Kami 风格实验记录。编译：xelatex 两遍（需要 ctex；kamidoc.cls 与反应式图片放在同一文件夹）。',
    '% 【待确认：…】标出的内容请补充后删除 \\tbc。',
    '\\documentclass{kamidoc}',
    '',
    `\\eyebrow{${u(k.eyebrow)}}`,
    `\\title{${u(rxn.title || t.report.untitled)}}`,
    `\\shorttitle{${u([code, rxn.title || t.report.untitled].filter(Boolean).join(' '))}}`,
  );
  const sub = [code && `${u(t.runs.runCode)} ${u(code)}`, rxn.conditions && u(rxn.conditions)].filter(Boolean);
  if (sub.length) L.push(`\\subtitle{${sub.join('\\sep ')}}`);
  L.push(`\\meta{${[u(date), rxn.operator && u(rxn.operator), `${u(t.runs.status)}：${u(t.runs.statuses[run.status])}`].filter(Boolean).join('\\sep ')}}`);
  if (best) L.push(`\\headfigure{${fmt(best.v.yieldPct, 3)}\\%}{${u(t.yield)}\\\\${u(nameWithAbbr(best.c))}}`);
  L.push('', '\\begin{document}', '\\makeheader', '');

  // Result first.
  L.push(`\\keyline{${u(k.result)}}{${run.conclusion ? u(run.conclusion) : `\\tbc{${u(k.tbcResult)}}`}}`, '');

  const metrics: string[] = [];
  if (rxn.refMmol) metrics.push(`\\metric{${fmt(rxn.refMmol / am)} ${u(units.amount)}}{${u(k.scale)}}`);
  for (const p of products) {
    const v = compute(rxn, p);
    if (v.mass !== undefined) metrics.push(`\\metric{${fmt(v.mass / ms)} ${u(units.mass)}}{${u(t.actualMass)}}`);
  }
  if (best) metrics.push(`\\metric{${fmt(best.v.yieldPct, 3)}\\%}{${u(t.yield)}}`);
  if (run.appearance) metrics.push(`\\metric{${u(run.appearance)}}{${u(t.runs.appearance)}}`);
  if (metrics.length >= 2) L.push('\\begin{metrics}', ...metrics.slice(0, 4), '\\end{metrics}', '');

  L.push(`\\section{${u(k.purpose)}}`, `\\tbc{${u(k.tbcPurpose)}}`, '');

  L.push(`\\section{${u(k.scheme)}}`);
  if (scheme) {
    const w = scheme.widthPt > 460 ? '\\linewidth' : `${scheme.widthPt.toFixed(1)}pt`;
    L.push('\\begin{center}', `\\includegraphics[width=${w}]{${scheme.file}}`, '\\end{center}');
  } else L.push(`\\figph[30mm]{${u(k.noScheme)}}`);
  if (rxn.conditions) L.push(`\\note{${u(t.conditions)}：${u(rxn.conditions)}}`);
  L.push('');

  L.push(`\\section{${u(k.materials)}}`);
  const head = [
    t.col.name, t.col.role, t.col.mw, t.col.equiv, `${t.col.amount} (${units.amount})`, `${t.col.mass} (${units.mass})`, `${t.col.volume} (${units.volume})`,
    ...(withActual ? [t.runs.actual] : []),
  ].map(u);
  const rows = inputs.map((c) => {
    const v = compute(rxn, c);
    const solvent = c.role === 'solvent';
    const ref = c.id === rxn.refId;
    const name = texName(nameWithAbbr(c)) + (ref ? ` (${u(t.col.ref)})` : '');
    return [
      ref ? `\\hi{${name}}` : name,
      u(t.roles[c.role]),
      fmt(c.mw, 6),
      solvent ? '—' : equivText(c, c.equiv),
      solvent ? '—' : fmt(v.mmol !== undefined ? v.mmol / am : undefined),
      fmt(v.mass !== undefined ? v.mass / ms : undefined) || '—',
      fmt(v.volume !== undefined ? v.volume / vl : undefined) || '—',
      ...(withActual ? [actualText(c, units) + (v.actualEquiv !== undefined && !ref ? ` (${equivText(c, v.actualEquiv)})` : '')] : []),
    ];
  });
  if (rows.length) {
    const spec = `X[2.4,l] X[1.1,l] X[1,r] X[1,r] X[1.2,r] X[1.2,r] X[1.2,r]${withActual ? ' X[1.6,r]' : ''}`;
    L.push(ktable(spec, [head, ...rows], u(k.materialsTable)), '');
  } else L.push(`\\tbc{${u(k.materials)}}`, '');

  const withLot = inputs.filter((c) => c.lot);
  if (withLot.length) {
    L.push(
      ktable(
        'X[1.6,l] X[1.2,l] X[1.3,l] X[1.4,l] X[1,l] X[1.3,l]',
        [
          [t.col.name, t.lots.supplier, t.lots.spec, `${t.lots.catalog} / ${t.lots.lot}`, t.col.purity, t.lots.verification].map(u),
          ...withLot.map((c) => {
            const l = { ...c.lot!, ...(c.lot!.lotId ? lots?.get(c.lot!.lotId) ?? {} : {}) };
            const ver = l.verification ?? 'unverified';
            const word = u(t.lots.verifications[ver]);
            const note = l.verificationNote ? `\\\\ ${u(l.verificationNote)}` : '';
            return [
              texName(c.name),
              l.source === 'made' ? u(`${t.lots.made}${l.sourceLabel ? ` (${l.sourceLabel})` : ''}`) : u(l.supplier),
              u(l.spec),
              u([l.catalogNumber, l.lotNumber].filter(Boolean).join(' / ')),
              u([l.purity && `${l.purity}%`, l.molarity && `${l.molarity} M`].filter(Boolean).join(' · ')),
              (ver === 'issue' ? `\\warnbadge{${word}}` : ver === 'ok' ? `\\badge{${word}}` : word) + note,
            ];
          }),
        ],
        u(t.office.lots),
      ),
      '',
    );
  }

  L.push(`\\section{${u(k.procedure)}}`);
  const proc = procedureTex(procedureOf(rxn), t.proc.observation);
  L.push(proc || `\\tbc{${u(k.tbcProcedure)}}`, '');

  L.push(`\\section{${u(k.results)}}`);
  if (products.length) {
    L.push(
      ktable(
        'X[2.4,l] X[1,r] X[1,r] X[1.2,r] X[1.3,r] X[1.3,r] X[1,r]',
        [
          [t.col.name, t.col.mw, t.col.equiv, `${t.col.amount} (${units.amount})`, `${t.theoMass} (${units.mass})`, `${t.actualMass} (${units.mass})`, t.yield].map(u),
          ...products.map((c) => {
            const v = compute(rxn, c);
            return [
              texName(nameWithAbbr(c)),
              fmt(c.mw, 6),
              fmt(c.equiv, 3),
              fmt(v.mmol !== undefined ? v.mmol / am : undefined),
              fmt(v.theoMass !== undefined ? v.theoMass / ms : undefined) || '—',
              fmt(v.mass !== undefined ? v.mass / ms : undefined) || '—',
              v.yieldPct !== undefined ? `\\hi{${fmt(v.yieldPct, 3)}\\%}` : '—',
            ];
          }),
        ],
        u(k.productsTable),
      ),
    );
  }
  if (run.appearance) L.push('', `${u(t.runs.appearance)}：${u(run.appearance)}`);
  const charac = products.filter((c) => c.characterization?.trim());
  for (const c of charac) {
    L.push('', `\\subsection{${u(nameWithAbbr(c))}}`);
    const lines = c.characterization!.split('\n').map((l) => l.trim()).filter(Boolean);
    L.push(lines.map(u).join('\n\n'));
  }
  if (!products.length && !charac.length) L.push(`\\tbc{${u(k.results)}}`);
  L.push('');

  L.push(`\\section{${u(k.analysis)}}`, `\\tbc{${u(k.tbcAnalysis)}}`, '', `\\begin{card}[${u(k.next)}]`, `\\tbc{${u(k.tbcNext)}}`, '\\end{card}', '');

  const refs = rxn.references ?? [];
  if (refs.length) {
    L.push(`\\begin{thebibliography}{${refs.length}}`);
    refs.forEach((r, i) => {
      const link = r.doi ? ` ${url(doiUrl(r.doi))}` : r.url ? ` ${url(r.url)}` : '';
      L.push(`\\bibitem{ref${i + 1}} ${u(formatReference(r))}${link}${r.note ? `\\\\ \\note{${u(r.note)}}` : ''}`);
    });
    L.push('\\end{thebibliography}', '');
  }

  L.push('\\end{document}', '');
  return L.join('\n');
}

/** Name of the .tex file: the run code when it is a safe file name, else "report". */
export const texFileName = (rxn: Reaction) => {
  const code = runCode(rxn, activeRun(rxn));
  return /^[\w.-]+$/.test(code) ? code : 'report';
};
