import { describe, expect, it } from 'vitest';
import type { Attachment, Link } from './api';
import { completeness, compoundOf, guessParent, indexGraph, nodeTypeOf, relationFor, subtree, treeRows, wouldCycle } from './graph';

let n = 0;
const node = (p: Partial<Attachment>): Attachment => ({
  id: `n${++n}`, reactionId: 'r', kind: 'other', filename: 'f', size: 1, hasPreview: false, meta: {}, note: '', createdAt: n, hasFile: true, ...p,
});

const sample = node({ id: 's', kind: 'sample', nodeType: 'sample', label: 'BH-042', compoundId: 'p1', hasFile: false });
const h1 = node({ id: 'h', kind: 'nmr', meta: { nucleus: '1H', expno: '1', sample: 'BH-042', dims: 1 } });
const c13 = node({ id: 'c', kind: 'nmr', meta: { nucleus: '13C', expno: '2', sample: 'BH-042', dims: 1 } });
const hsqc = node({ id: 'q', kind: 'nmr', meta: { nucleus: '1H/13C', expno: '3', sample: 'BH-042', dims: 2 } });
const mnova = node({ id: 'm', kind: 'mnova' });
const pdf = node({ id: 'd', kind: 'pdf' });
const ms = node({ id: 'x', kind: 'ms', compoundId: 'p1' });
const nodes = [sample, h1, c13, hsqc, mnova, pdf, ms];
const links: Link[] = [
  { from: 's', to: 'h' }, { from: 's', to: 'c' }, { from: 's', to: 'q' },
  { from: 'h', to: 'm' }, { from: 'c', to: 'm' }, { from: 'm', to: 'd' },
];
const ix = indexGraph(nodes, links);

describe('node graph helpers', () => {
  it('infers node types and relations', () => {
    expect(nodeTypeOf(h1)).toBe('source');
    expect(nodeTypeOf(mnova)).toBe('processed');
    expect(nodeTypeOf(pdf)).toBe('export');
    expect(nodeTypeOf({ kind: 'pdf', nodeType: 'source' })).toBe('source');
    expect(relationFor('sample', 'source')).toBe('contains');
    expect(relationFor('source', 'processed')).toBe('processed');
    expect(relationFor('processed', 'export')).toBe('export');
  });

  it('detects cycles and collects subtrees', () => {
    expect(wouldCycle(ix, 'd', 's')).toBe(true);
    expect(wouldCycle(ix, 'm', 'm')).toBe(true);
    expect(wouldCycle(ix, 'q', 'm')).toBe(false);
    expect(subtree(ix, 'h')).toEqual(['h', 'm', 'd']);
  });

  it('finds the product through upstream links (multiple inputs ok)', () => {
    expect(compoundOf(ix, 'd')).toBe('p1');
    expect(compoundOf(ix, 'x')).toBe('p1');
    expect(compoundOf(indexGraph([pdf], []), 'd')).toBeUndefined();
  });

  it('orders the list view depth-first, multi-input nodes once', () => {
    const rows = treeRows(ix, nodes);
    expect(rows.map((r) => `${r.node.id}${r.depth}`)).toEqual(['s0', 'h1', 'm2', 'd3', 'c1', 'q1', 'x0']);
    expect(rows.find((r) => r.node.id === 'm')!.alsoFrom).toEqual(['c']);
  });

  it('guesses the upstream node of loose files from their names', () => {
    expect(guessParent('BH-042_1H.mnova', nodes)?.id).toBe('h');
    expect(guessParent('BH-042 13C processed.pdf', nodes)?.id).toBe('c');
    expect(guessParent('spectrum_expno3.pdf', nodes)?.id).toBe('q');
    expect(guessParent('BH-042_all.mnova', nodes)?.id).toBe('s');
    expect(guessParent('random.pdf', nodes)).toBeUndefined();
  });

  it('summarizes characterization completeness per product', () => {
    expect(completeness(ix, nodes, 'p1')).toEqual({ nuclei: ['1H', '13C'], ms: true, twoD: true });
  });
});

describe('completeness', () => {
  it('counts MS data recognized by file name', () => {
    const p = node({ id: 'x', kind: 'pdf', filename: 'HRMS 报告.pdf', compoundId: 'p9' });
    const ix2 = indexGraph([p], []);
    expect(completeness(ix2, [p], 'p9').ms).toBe(true);
  });
});
