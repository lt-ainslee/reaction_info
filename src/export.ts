import { activeRun, runCode } from './chem/runs';
import { compute, type Component, type Reaction } from './chem/stoich';
import { AMOUNT_UNITS, fmt, MASS_UNITS, VOLUME_UNITS, type Units } from './units';

interface Labels {
  roles: Record<Component['role'], string>;
  col: { name: string; role: string; mw: string; equiv: string; amount: string; mass: string; volume: string };
  yield: string;
  actualMass: string;
  actual: string;
  conditions: string;
  liquid: string;
  notes: string;
}

function rows(rxn: Reaction, u: Units, t: Labels): string[][] {
  const header = [
    t.col.name, t.col.role, t.col.mw, t.col.equiv,
    `${t.col.amount} (${u.amount})`, `${t.col.mass} (${u.mass})`, `${t.col.volume} (${u.volume})`, t.notes,
  ];
  const body = rxn.components.map((c) => {
    const v = compute(rxn, c);
    const notes: string[] = [];
    if (c.form === 'solutionM' && c.molarity) notes.push(`${c.molarity} M`);
    if (c.form === 'solutionWt' && c.wtPercent) notes.push(`${c.wtPercent} wt%`);
    if (c.purity < 100 && c.form === 'neat') notes.push(`${c.purity}%`);
    if (c.form === 'neat' && c.phase === 'liquid' && c.role !== 'product') {
      notes.push(c.density ? `${t.liquid}, d = ${fmt(c.density)} g/mL` : t.liquid);
    }
    if (c.role === 'solvent' && c.solventConc) notes.push(`${c.solventConc} M`);
    if (c.role === 'product' && v.mass !== undefined) {
      notes.push(`${t.actualMass} ${fmt(v.mass / MASS_UNITS[u.mass])} ${u.mass}`);
      if (v.yieldPct !== undefined) notes.push(`${t.yield} ${fmt(v.yieldPct, 3)}%`);
    }
    if (c.actualAmount?.mass) notes.push(`${t.actual} ${fmt(c.actualAmount.mass / MASS_UNITS[u.mass])} ${u.mass}`);
    else if (c.actualAmount?.volume) notes.push(`${t.actual} ${fmt(c.actualAmount.volume / VOLUME_UNITS[u.volume])} ${u.volume}`);
    if (v.actualEquiv !== undefined && c.id !== rxn.refId) notes.push(`${fmt(v.actualEquiv, 3)} eq`);
    if (c.cas) notes.push(`CAS ${c.cas}`);
    const isSolvent = c.role === 'solvent';
    const mass = c.role === 'product' ? v.theoMass : v.mass;
    return [
      c.name + (c.id === rxn.refId ? ' *' : ''),
      t.roles[c.role],
      fmt(c.mw, 5),
      isSolvent ? '' : c.role === 'catalyst' ? `${fmt(c.equiv * 100, 3)} mol%` : fmt(c.equiv, 3),
      isSolvent ? '' : fmt(v.mmol !== undefined ? v.mmol / AMOUNT_UNITS[u.amount] : undefined),
      fmt(mass !== undefined ? mass / MASS_UNITS[u.mass] : undefined),
      fmt(v.volume !== undefined ? v.volume / VOLUME_UNITS[u.volume] : undefined),
      notes.join('; '),
    ];
  });
  return [header, ...body];
}

export function toMarkdown(rxn: Reaction, u: Units, t: Labels): string {
  const [header, ...body] = rows(rxn, u, t);
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const line = (r: string[]) => `| ${r.map(esc).join(' | ')} |`;
  const out = [];
  out.push(`### ${[runCode(rxn, activeRun(rxn)), rxn.title].filter(Boolean).join(' ')}`, '');
  if (rxn.conditions?.trim()) out.push(`${t.conditions}: ${rxn.conditions.trim()}`, '');
  out.push(line(header), line(header.map(() => '---')), ...body.map(line));
  if (rxn.notes?.trim()) out.push('', rxn.notes.trim());
  return out.join('\n');
}

export function toCsv(rxn: Reaction, u: Units, t: Labels): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  // BOM so Excel opens UTF-8 (Chinese) correctly.
  return '﻿' + rows(rxn, u, t).map((r) => r.map(q).join(',')).join('\r\n');
}

export function reactionSmiles(rxn: Reaction): string {
  const pick = (roles: Component['role'][]) =>
    rxn.components.filter((c) => roles.includes(c.role) && c.smiles).map((c) => (c.smiles!.includes('.') ? `(${c.smiles})` : c.smiles));
  return `${pick(['reactant']).join('.')}>${pick(['reagent', 'catalyst', 'solvent']).join('.')}>${pick(['product']).join('.')}`;
}

/** Reactants >> products only: what is drawn when editing the scheme (agents stay in the table). */
export function drawableEquation(rxn: Reaction): string | undefined {
  const pick = (role: Component['role']) =>
    rxn.components.filter((c) => c.role === role && c.smiles).map((c) => (c.smiles!.includes('.') ? `(${c.smiles})` : c.smiles));
  const left = pick('reactant');
  const right = pick('product');
  return left.length || right.length ? `${left.join('.')}>>${right.join('.')}` : undefined;
}

/** Let the browser save a file. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Some browsers ignore the filename unless the link is in the document.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function download(filename: string, content: string, type = 'text/csv;charset=utf-8') {
  saveBlob(new Blob([content], { type }), filename);
}
