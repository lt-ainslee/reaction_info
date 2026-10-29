// Pure helpers for the attachment node graph (no React, no network).
import type { Attachment, Kind, Link, NodeType, Relation } from './api';
import type { NmrMeta } from './bruker';

/** Graph role of a node; older uploads have none and are inferred from their kind. */
export function nodeTypeOf(a: Pick<Attachment, 'nodeType' | 'kind'>): NodeType {
  if (a.nodeType) return a.nodeType;
  const byKind: Partial<Record<Kind, NodeType>> = {
    nmr: 'source', ms: 'source', hplc: 'source', ir: 'source', xrd: 'source', cif: 'source',
    mnova: 'processed', pdf: 'export', image: 'export', jcamp: 'export', text: 'peaklist', sample: 'sample',
  };
  return byKind[a.kind] ?? 'other';
}

/** Relation label for a new link between two node types. */
export function relationFor(from: NodeType, to: NodeType): Relation {
  if (from === 'sample') return 'contains';
  if (to === 'processed') return 'processed';
  if (to === 'export') return 'export';
  if (to === 'peaklist') return 'peaklist';
  return 'derived';
}

export const displayName = (a: Pick<Attachment, 'label' | 'filename'>) => a.label || a.filename;

export interface Index {
  byId: Map<string, Attachment>;
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
}

export function indexGraph(nodes: Attachment[], links: Link[]): Index {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const l of links) {
    if (!byId.has(l.from) || !byId.has(l.to)) continue;
    parents.set(l.to, [...(parents.get(l.to) ?? []), l.from]);
    children.set(l.from, [...(children.get(l.from) ?? []), l.to]);
  }
  return { byId, parents, children };
}

/** Would linking from → to create a cycle (or a self-loop)? */
export function wouldCycle(ix: Index, from: string, to: string): boolean {
  if (from === to) return true;
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === from) return true;
    for (const c of ix.children.get(n) ?? []) {
      if (!seen.has(c)) {
        seen.add(c);
        stack.push(c);
      }
    }
  }
  return false;
}

/** All nodes downstream of `id`, including itself, in breadth-first order. */
export function subtree(ix: Index, id: string): string[] {
  const out = [id];
  const seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const c of ix.children.get(out[i]) ?? []) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

/** The product a node belongs to: its own compoundId, else the nearest upstream one. */
export function compoundOf(ix: Index, id: string): string | undefined {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    const node = ix.byId.get(n);
    if (node?.compoundId) return node.compoundId;
    queue.push(...(ix.parents.get(n) ?? []));
  }
  return undefined;
}

export interface Row {
  node: Attachment;
  depth: number;
  /** Other upstream nodes when this node has several inputs. */
  alsoFrom: string[];
}

/** Depth-first order for the list view; a node with several inputs appears under its first one. */
export function treeRows(ix: Index, nodes: Attachment[]): Row[] {
  const rows: Row[] = [];
  const placed = new Set<string>();
  const visit = (n: Attachment, depth: number) => {
    if (placed.has(n.id)) return;
    placed.add(n.id);
    rows.push({ node: n, depth, alsoFrom: (ix.parents.get(n.id) ?? []).slice(1) });
    for (const c of ix.children.get(n.id) ?? []) {
      const child = ix.byId.get(c);
      if (child && (ix.parents.get(c) ?? [])[0] === n.id) visit(child, depth + 1);
    }
  };
  for (const n of nodes) if (!(ix.parents.get(n.id) ?? []).length) visit(n, 0);
  for (const n of nodes) visit(n, 0); // anything left (only possible with stale links)
  return rows;
}

const NUC_TOKENS: [RegExp, string][] = [
  [/(^|[^a-z0-9])(1h|h1|proton)([^a-z0-9]|$)/i, '1H'],
  [/(^|[^a-z0-9])(13c|c13|carbon)([^a-z0-9]|$)/i, '13C'],
  [/(^|[^a-z0-9])(19f|f19)([^a-z0-9]|$)/i, '19F'],
  [/(^|[^a-z0-9])(31p|p31)([^a-z0-9]|$)/i, '31P'],
  [/(^|[^a-z0-9])(11b|b11)([^a-z0-9]|$)/i, '11B'],
];

/**
 * Upstream node for a loose file (an MNova document, an exported PDF…):
 * the experiment whose sample name, nucleus and/or expno appear in the
 * file name; else the matching sample. Undefined when ambiguous.
 */
export function guessParent(filename: string, candidates: Attachment[]): Attachment | undefined {
  const name = filename.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  const nucleus = NUC_TOKENS.find(([re]) => re.test(name))?.[1];
  const expno = /(?:expno|exp|_e)[ _-]?(\d+)/i.exec(name)?.[1];
  const sources = candidates.filter((c) => nodeTypeOf(c) === 'source' && c.kind === 'nmr');
  const matchSample = (c: Attachment) => {
    const s = String((c.meta as Partial<NmrMeta>).sample ?? '').toLowerCase();
    return !!s && name.includes(s);
  };
  const scored = sources
    .map((c) => {
      const m = c.meta as Partial<NmrMeta>;
      let score = 0;
      if (matchSample(c)) score += 2;
      if (nucleus && m.dims !== 2 && m.nucleus === nucleus) score += 3;
      if (expno && String(m.expno) === expno) score += 4;
      return { c, score };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score);
  if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) return scored[0].c;
  const samples = candidates.filter((c) => nodeTypeOf(c) === 'sample' && displayName(c).length > 1 && name.includes(displayName(c).toLowerCase()));
  return samples.length === 1 ? samples[0] : undefined;
}

const MS_NAME = /(^|[^a-z])(hr-?ms|ms|esi|maldi|lc-?ms|gc-?ms|apci)([^a-z]|$)/i;

/** Nuclei with 1D spectra and whether MS data exists, for a product. */
export function completeness(ix: Index, nodes: Attachment[], productId: string) {
  const mine = nodes.filter((n) => compoundOf(ix, n.id) === productId);
  const nuclei = [
    ...new Set(
      mine
        .filter((n) => n.kind === 'nmr' && (n.meta as Partial<NmrMeta>).dims !== 2)
        .map((n) => String((n.meta as Partial<NmrMeta>).nucleus ?? ''))
        .filter(Boolean),
    ),
  ];
  const ms = mine.some((n) => n.kind === 'ms' || MS_NAME.test(displayName(n)));
  return { nuclei, ms, twoD: mine.some((n) => (n.meta as Partial<NmrMeta>).dims === 2) };
}
