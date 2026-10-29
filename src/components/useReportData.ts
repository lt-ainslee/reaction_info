// What the report fetches: the library entries of the lots used, the
// reaction's attachment tree, and GHS safety data (cached, one compound at a time).
import { useEffect, useState } from 'react';
import { getGraph } from '../attachments/api';
import { compoundOf, indexGraph, treeRows, type Row } from '../attachments/graph';
import type { ReagentLot } from '../chem/lots';
import { getSafetyCached, type PubChemSafety } from '../chem/pubchem';
import { findCid } from '../chem/resolve';
import type { Reaction } from '../chem/stoich';
import { lotRepo } from '../storage/lots';

export type SafetyMap = Record<string, PubChemSafety | null>;
export type AttachmentRow = Row & { compoundId?: string };

export function useReportData(rxn: Reaction, reactionId: string | undefined, withSafety: boolean) {
  const [lots, setLots] = useState<Map<string, ReagentLot>>(new Map());
  const usesLibraryLots = rxn.components.some((c) => c.role !== 'product' && c.lot?.lotId);
  useEffect(() => {
    if (!usesLibraryLots) return;
    lotRepo.list().then((l) => setLots(new Map(l.map((x) => [x.id, x]))), () => undefined);
  }, [usesLibraryLots]);

  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  useEffect(() => {
    if (!reactionId) return;
    getGraph(reactionId).then(
      (g) => {
        const ix = indexGraph(g.nodes, g.links);
        setAttachments(treeRows(ix, g.nodes).map((r) => ({ ...r, compoundId: compoundOf(ix, r.node.id) })));
      },
      () => setAttachments([]),
    );
  }, [reactionId]);

  const [safety, setSafety] = useState<SafetyMap>({});
  const [progress, setProgress] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (!withSafety) return;
    let cancelled = false;
    const list = rxn.components.filter((c) => !(c.id in safety));
    if (!list.length) return;
    (async () => {
      let done = 0;
      setProgress([0, list.length]);
      for (const c of list) {
        let s: PubChemSafety | null = null;
        try {
          const cid = await findCid(c);
          if (cid) s = await getSafetyCached(cid);
        } catch {
          /* offline */
        }
        if (cancelled) return;
        setSafety((m) => ({ ...m, [c.id]: s }));
        setProgress([++done, list.length]);
      }
      setProgress(null);
    })();
    return () => {
      cancelled = true;
    };
    // Fetch again only for new compounds, not when `safety` fills in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withSafety, rxn.components]);

  return { lots, attachments, safety, progress };
}
