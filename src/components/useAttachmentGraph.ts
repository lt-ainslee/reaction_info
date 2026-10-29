// Data of the "Characterization & spectra" card: the node graphs of the
// reaction and of the reagent lots used in it, the lot library entries, and
// what is shown (optionally the current run only) with the compound / lot
// nodes in front.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getGraph, type Attachment, type Link } from '../attachments/api';
import { indexGraph, type Index } from '../attachments/graph';
import { lotLabel, lotOwner, type ReagentLot } from '../chem/lots';
import { activeRun } from '../chem/runs';
import type { Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { lotRepo } from '../storage/lots';
import type { VNode } from './AttachmentGraph';

export const CMP = 'cmp:';
export const LOT = 'lot:';

type Graph = { nodes: Attachment[]; links: Link[] };
export const isRoot = (ix: Index, id: string) => !(ix.parents.get(id) ?? []).length;

export function useAttachmentGraph(rxn: Reaction, reactionId: string | undefined, remote: boolean, onlyRun: boolean, multiRun: boolean) {
  const { t } = useI18n();
  // The card is keyed by the reaction id, so this state starts empty for each reaction.
  const [graphs, setGraphs] = useState<Record<string, Graph> | null>(null);
  const [library, setLibrary] = useState<Map<string, ReagentLot>>(new Map());
  const [error, setError] = useState(false);
  const run = activeRun(rxn);

  // Lots used in this run (their spectra are shown and can be added here).
  const lotKey = [...new Set(rxn.components.map((c) => c.lot?.lotId).filter((x): x is string => !!x))].join(',');

  /** The graphs of the reaction and its lots, and the lots' library entries (null: nothing to load). */
  const load = useCallback(async () => {
    if (!reactionId || !remote) return null;
    const lotIds = lotKey ? lotKey.split(',') : [];
    const [all, lots] = await Promise.all([
      Promise.all([reactionId, ...lotIds.map(lotOwner)].map(async (o) => [o, await getGraph(o)] as const)),
      lotIds.length ? lotRepo.list() : Promise.resolve([] as ReagentLot[]),
    ]);
    return { graphs: Object.fromEntries(all), library: new Map(lots.map((l) => [l.id, l])) };
  }, [reactionId, remote, lotKey]);

  const apply = useCallback((r: Awaited<ReturnType<typeof load>>) => {
    if (!r) return;
    setGraphs(r.graphs);
    setLibrary(r.library);
    setError(false);
  }, []);
  const refresh = () => load().then(apply, () => setError(true));

  useEffect(() => {
    let current = true;
    load().then(
      (r) => current && apply(r),
      () => current && setError(true),
    );
    return () => {
      current = false;
    };
  }, [load, apply]);

  const allNodes = useMemo(() => Object.values(graphs ?? {}).flatMap((g) => g.nodes), [graphs]);
  const allLinks = useMemo(() => Object.values(graphs ?? {}).flatMap((g) => g.links), [graphs]);
  const ixAll = useMemo(() => indexGraph(allNodes, allLinks), [allNodes, allLinks]);

  // "Current run only": hide this reaction's top-level nodes recorded for another run (and what hangs below them).
  const nodes = useMemo(() => {
    if (!onlyRun || !multiRun) return allNodes;
    const roots = allNodes.filter((n) => isRoot(ixAll, n.id) && !(n.reactionId === reactionId && n.meta.runId && n.meta.runId !== run.id));
    const keep = new Set<string>();
    const stack = roots.map((n) => n.id);
    while (stack.length) {
      const id = stack.pop()!;
      if (keep.has(id)) continue;
      keep.add(id);
      stack.push(...(ixAll.children.get(id) ?? []));
    }
    return allNodes.filter((n) => keep.has(n.id));
  }, [allNodes, ixAll, onlyRun, multiRun, reactionId, run.id]);
  const links = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    return allLinks.filter((l) => ids.has(l.from) && ids.has(l.to));
  }, [nodes, allLinks]);
  const ix = useMemo(() => indexGraph(nodes, links), [nodes, links]);

  /** Compound and lot nodes of the current run. */
  const virtual = useMemo<VNode[]>(() => {
    const roots = nodes.filter((n) => isRoot(ix, n.id));
    const out: VNode[] = [];
    const lotsDone = new Set<string>();
    for (const c of rxn.components) {
      const mine = roots.filter((n) => n.reactionId === reactionId && n.compoundId === c.id).map((n) => n.id);
      const lotId = c.lot?.lotId;
      if (c.role === 'solvent' && !mine.length && !lotId) continue;
      out.push({
        id: CMP + c.id,
        kind: 'compound',
        strip: t.roles[c.role],
        title: c.name,
        sub: [c.formula, c.lot && lotLabel(c.lot, t.lots.made)].filter(Boolean).join(' · '),
        cls: 't-c-' + c.role,
        targets: [...mine, ...(lotId ? [LOT + lotId] : [])],
      });
      if (lotId && !lotsDone.has(lotId)) {
        lotsDone.add(lotId);
        const lib = library.get(lotId);
        const info = { ...c.lot, ...(lib ?? {}) };
        const files = lib?.attachments ?? 0;
        out.push({
          id: LOT + lotId,
          kind: 'lot',
          strip: t.att.lotNode,
          title: lotLabel(info, t.lots.made) || t.lots.unnamed,
          sub: [t.lots.verifications[info.verification ?? 'unverified'], files ? t.lots.files.replace('{n}', String(files)) : ''].filter(Boolean).join(' · '),
          cls: 't-lot',
          status: info.verification ?? 'unverified',
          targets: roots.filter((n) => n.reactionId === lotOwner(lotId)).map((n) => n.id),
        });
      }
    }
    return out;
  }, [rxn.components, nodes, ix, reactionId, library, t]);

  /** Update one owner's graph in place (after a server change). */
  const patchGraph = (owner: string, f: (g: Graph) => Graph) => setGraphs((gs) => (gs && gs[owner] ? { ...gs, [owner]: f(gs[owner]) } : gs));
  const replaceNode = (next: Attachment) => patchGraph(next.reactionId, (g) => ({ ...g, nodes: g.nodes.map((x) => (x.id === next.id ? next : x)) }));

  return {
    loaded: !!graphs,
    error,
    setError,
    refresh,
    library,
    setLibrary,
    allNodes,
    ixAll,
    nodes,
    links,
    ix,
    virtual,
    hiddenCount: allNodes.length - nodes.length,
    patchGraph,
    replaceNode,
  };
}
