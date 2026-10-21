// Minimal CDXML (ChemDraw XML) reader: structures → MDL molblocks, plus the
// reaction layout (reactants / products / objects above and below the arrow).
// In ChemDraw use Edit → Copy As → CDXML Text, or File → Save As → .cdxml.
//
// Format reference: https://www.cambridgesoft.com/services/documentation/sdk/chemdraw/cdx/

import { SYMBOL_BY_Z } from './elements';

export interface CdxmlEntry {
  /** One molblock per drawn fragment, or a text label. */
  molblock?: string;
  text?: string;
}

export interface CdxmlResult {
  reactants: CdxmlEntry[];
  products: CdxmlEntry[];
  /** Objects above / below the arrow (structures or text). */
  above: CdxmlEntry[];
  below: CdxmlEntry[];
  /** True when an arrow / reaction step was found. */
  isReaction: boolean;
  /** Everything, in document order, when there is no arrow. */
  all: CdxmlEntry[];
}

interface Atom { symbol: string; x: number; y: number; charge: number; isotope: number }
interface Bond { a: number; b: number; order: number; stereo: number }

const num = (s: string | null, d = 0) => (s === null || s === '' ? d : Number(s));
const children = (el: Element, tag: string) => [...el.children].filter((c) => c.tagName === tag);

/** Build atoms/bonds for a <fragment>, expanding abbreviation nodes (OMe, Ph, Boc…). */
function readFragment(frag: Element): { atoms: Atom[]; bonds: Bond[] } {
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];

  // Returns: node id → atom index for plain nodes; for abbreviation nodes the
  // list of inner atoms that attach to the outside (one per connection point).
  function walk(f: Element): { index: Map<string, number>; attach: Map<string, number[]>; ecp: Set<string> } {
    const index = new Map<string, number>();
    const attach = new Map<string, number[]>();
    const ecp = new Set<string>();
    for (const n of children(f, 'n')) {
      const id = n.getAttribute('id') ?? '';
      const type = n.getAttribute('NodeType') ?? 'Element';
      const inner = children(n, 'fragment')[0];
      if (type === 'ExternalConnectionPoint') {
        ecp.add(id);
        continue;
      }
      if (inner) {
        const sub = walk(inner);
        // Inner atoms bonded to the inner connection point(s).
        const points: number[] = [];
        for (const b of children(inner, 'b')) {
          const [s, e] = [b.getAttribute('B') ?? '', b.getAttribute('E') ?? ''];
          if (sub.ecp.has(s) && sub.index.has(e)) points.push(sub.index.get(e)!);
          else if (sub.ecp.has(e) && sub.index.has(s)) points.push(sub.index.get(s)!);
        }
        attach.set(id, points.length ? points : [...sub.index.values()].slice(0, 1));
        continue;
      }
      const [x, y] = (n.getAttribute('p') ?? '0 0').split(/\s+/).map(Number);
      const z = num(n.getAttribute('Element'), 6);
      const generic = type === 'GenericNickname' || type === 'Unspecified' || type === 'Variable' || type === 'Anonymous';
      atoms.push({
        symbol: generic ? '*' : SYMBOL_BY_Z[z] ?? '*',
        x,
        y,
        charge: num(n.getAttribute('Charge')),
        isotope: num(n.getAttribute('Isotope')),
      });
      index.set(id, atoms.length - 1);
    }

    const used = new Map<string, number>();
    const resolve = (nodeId: string, bondId: string, attachIdx: string | null): number | undefined => {
      if (index.has(nodeId)) return index.get(nodeId);
      const pts = attach.get(nodeId);
      if (!pts?.length) return undefined;
      if (attachIdx !== null) return pts[Math.min(Number(attachIdx) - 1, pts.length - 1)] ?? pts[0];
      const node = [...f.children].find((c) => c.getAttribute('id') === nodeId);
      const ordering = node?.getAttribute('BondOrdering')?.split(/\s+/).filter((x) => x !== '0');
      if (ordering?.includes(bondId)) return pts[Math.min(ordering.indexOf(bondId), pts.length - 1)];
      const k = used.get(nodeId) ?? 0;
      used.set(nodeId, k + 1);
      return pts[Math.min(k, pts.length - 1)];
    };

    for (const b of children(f, 'b')) {
      const s = b.getAttribute('B') ?? '';
      const e = b.getAttribute('E') ?? '';
      if (ecp.has(s) || ecp.has(e)) continue;
      const id = b.getAttribute('id') ?? '';
      let a1 = resolve(s, id, b.getAttribute('BeginAttach'));
      let a2 = resolve(e, id, b.getAttribute('EndAttach'));
      if (a1 === undefined || a2 === undefined || a1 === a2) continue;
      const orderAttr = (b.getAttribute('Order') ?? '1').split(/\s+/)[0];
      if (orderAttr === 'hydrogen' || orderAttr === 'ionic') continue;
      const order = orderAttr === '2' ? 2 : orderAttr === '3' ? 3 : orderAttr === '1.5' ? 4 : 1;
      const display = b.getAttribute('Display') ?? '';
      let stereo = 0;
      if (/^Wedge(Begin|End)$/.test(display)) stereo = 1;
      if (/^WedgedHash(Begin|End)$/.test(display)) stereo = 6;
      if (stereo && display.endsWith('End')) [a1, a2] = [a2, a1];
      bonds.push({ a: a1, b: a2, order, stereo: order === 1 ? stereo : 0 });
    }
    return { index, attach, ecp };
  }

  walk(frag);
  return { atoms, bonds };
}

function toMolblock({ atoms, bonds }: { atoms: Atom[]; bonds: Bond[] }): string {
  const scale = 1.5 / 14.4; // ChemDraw default bond length is 14.4 pt
  const pad = (v: number | string, w: number) => String(v).padStart(w);
  const lines = ['', '  cdxml', '', `${pad(atoms.length, 3)}${pad(bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000`];
  for (const a of atoms) {
    const x = (a.x * scale).toFixed(4);
    const y = (-a.y * scale).toFixed(4);
    lines.push(`${pad(x, 10)}${pad(y, 10)}${pad('0.0000', 10)} ${a.symbol.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  }
  for (const b of bonds) lines.push(`${pad(b.a + 1, 3)}${pad(b.b + 1, 3)}${pad(b.order, 3)}${pad(b.stereo, 3)}`);
  const chg = atoms.map((a, i) => [i + 1, a.charge]).filter(([, c]) => c);
  for (let i = 0; i < chg.length; i += 8) {
    const part = chg.slice(i, i + 8);
    lines.push(`M  CHG${pad(part.length, 3)}${part.map(([n, c]) => `${pad(n, 4)}${pad(c, 4)}`).join('')}`);
  }
  const iso = atoms.map((a, i) => [i + 1, a.isotope]).filter(([, v]) => v);
  for (let i = 0; i < iso.length; i += 8) {
    const part = iso.slice(i, i + 8);
    lines.push(`M  ISO${pad(part.length, 3)}${part.map(([n, v]) => `${pad(n, 4)}${pad(v, 4)}`).join('')}`);
  }
  lines.push('M  END');
  return lines.join('\n');
}

const textOf = (t: Element) => (t.textContent ?? '').replace(/\r/g, '').trim();

/** Center of an object, from its nodes / BoundingBox / position. */
function center(el: Element): [number, number] | null {
  const pts = [...el.querySelectorAll('n')].map((n) => (n.getAttribute('p') ?? '').split(/\s+/).map(Number));
  const valid = pts.filter((p) => p.length >= 2 && p.every(Number.isFinite));
  if (valid.length) return [valid.reduce((s, p) => s + p[0], 0) / valid.length, valid.reduce((s, p) => s + p[1], 0) / valid.length];
  const bb = el.getAttribute('BoundingBox')?.split(/\s+/).map(Number);
  if (bb?.length === 4) return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
  const p = el.getAttribute('p')?.split(/\s+/).map(Number);
  return p && p.length >= 2 ? [p[0], p[1]] : null;
}

export function parseCdxml(xml: string): CdxmlResult | null {
  const doc = new DOMParser().parseFromString(xml.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml');
  const root = doc.querySelector('CDXML');
  if (!root || doc.querySelector('parsererror')) return null;

  // Top-level drawable objects (not nested inside a node or another fragment).
  const objects: Element[] = [];
  const byId = new Map<string, Element>();
  const visit = (el: Element) => {
    for (const c of el.children) {
      const id = c.getAttribute('id');
      if (id) byId.set(id, c);
      if (c.tagName === 'fragment' || c.tagName === 't') objects.push(c);
      else if (c.tagName === 'page' || c.tagName === 'group') visit(c);
    }
  };
  visit(root);

  const entryOf = (el: Element): CdxmlEntry[] => {
    if (el.tagName === 'fragment') {
      const mol = readFragment(el);
      return mol.atoms.length ? [{ molblock: toMolblock(mol) }] : [];
    }
    if (el.tagName === 't') {
      const text = textOf(el);
      return text ? [{ text }] : [];
    }
    if (el.tagName === 'group') return [...el.children].flatMap(entryOf);
    return [];
  };
  const entries = (ids: string | null) =>
    (ids ?? '').split(/\s+/).filter(Boolean).flatMap((id) => (byId.get(id) ? entryOf(byId.get(id)!) : []));

  const all = objects.flatMap(entryOf);
  const step = root.querySelector('scheme > step');
  if (step) {
    return {
      reactants: entries(step.getAttribute('ReactionStepReactants')),
      products: entries(step.getAttribute('ReactionStepProducts')),
      above: entries(step.getAttribute('ReactionStepObjectsAboveArrow')),
      below: entries(step.getAttribute('ReactionStepObjectsBelowArrow')),
      isReaction: true,
      all,
    };
  }

  // No reaction step: classify by position relative to the first arrow.
  const arrow = [...root.querySelectorAll('arrow, graphic')].find(
    (g) => g.tagName === 'arrow' || (g.getAttribute('ArrowType') ?? '').length > 0,
  );
  let x1: number, x2: number, yMid: number;
  if (arrow?.tagName === 'arrow' && arrow.getAttribute('Head3D') && arrow.getAttribute('Tail3D')) {
    const h = arrow.getAttribute('Head3D')!.split(/\s+/).map(Number);
    const tl = arrow.getAttribute('Tail3D')!.split(/\s+/).map(Number);
    [x1, x2, yMid] = [Math.min(h[0], tl[0]), Math.max(h[0], tl[0]), (h[1] + tl[1]) / 2];
  } else if (arrow?.getAttribute('BoundingBox')) {
    const bb = arrow.getAttribute('BoundingBox')!.split(/\s+/).map(Number);
    [x1, x2, yMid] = [Math.min(bb[0], bb[2]), Math.max(bb[0], bb[2]), (bb[1] + bb[3]) / 2];
  } else {
    return { reactants: [], products: [], above: [], below: [], isReaction: false, all };
  }

  const res: CdxmlResult = { reactants: [], products: [], above: [], below: [], isReaction: true, all };
  for (const o of objects) {
    const c = center(o);
    if (!c) continue;
    const e = entryOf(o);
    if (c[0] < x1) {
      // Text labels under structures ("1a", "SM") are not compounds.
      if (o.tagName === 'fragment') res.reactants.push(...e);
    } else if (c[0] > x2) {
      if (o.tagName === 'fragment') res.products.push(...e);
    } else (c[1] <= yMid ? res.above : res.below).push(...e);
  }
  return res;
}
