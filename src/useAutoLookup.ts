import type { MainModule } from '@rdkit/rdkit';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { getPhysicalCached, searchByName, searchBySmiles } from './chem/pubchem';
import { hasCjk } from './chem/resolve';
import { updateComponent, type Component, type Reaction } from './chem/stoich';

/** Compounds whose physical state or (for liquids) density is still unknown. */
const wantsLookup = (c: Component) =>
  c.role !== 'product' &&
  c.form === 'neat' &&
  c.lookup === undefined &&
  (c.phase === undefined || (c.phase === 'liquid' && !c.density));

async function findCid(c: Component): Promise<number | undefined> {
  if (c.cid) return c.cid;
  if (c.smiles) {
    const [hit] = await searchBySmiles(c.smiles);
    if (hit) return hit.cid;
  }
  const q = c.cas ?? c.name;
  if (!q || hasCjk(q)) return undefined;
  const [hit] = await searchByName(q);
  return hit?.cid;
}

/**
 * Look up phase and density on PubChem for newly added compounds, one at a
 * time (PubChem rate limit). Returns the ids currently being looked up.
 */
export function useAutoLookup(rxn: Reaction, setRxn: Dispatch<SetStateAction<Reaction>>, rd: MainModule | null) {
  const inflight = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const busy = useRef(false);

  useEffect(() => {
    if (busy.current || !rd) return;
    const next = rxn.components.find((c) => wantsLookup(c) && !inflight.current.has(c.id));
    if (!next) return;
    busy.current = true;
    inflight.current.add(next.id);
    setPending(new Set(inflight.current));

    (async () => {
      let patch: Partial<Component> = { lookup: 'failed' };
      try {
        const cid = await findCid(next);
        if (cid) {
          const phys = await getPhysicalCached(cid);
          patch = { lookup: 'done', cid, phase: phys.phase, density: phys.density };
        }
      } catch {
        /* offline: keep failed */
      }
      setRxn((r) => {
        const cur = r.components.find((c) => c.id === next.id);
        if (!cur) return r;
        // Never overwrite what the user (or the library) already set.
        const p: Partial<Component> = { lookup: patch.lookup };
        if (patch.cid && !cur.cid) p.cid = patch.cid;
        if (patch.phase && !cur.phase) p.phase = patch.phase;
        if (patch.density && !cur.density) {
          p.density = patch.density;
          p.densitySource = 'pubchem';
        }
        return updateComponent(r, cur.id, p);
      });
    })().finally(() => {
      inflight.current.delete(next.id);
      setPending(new Set(inflight.current));
      busy.current = false;
    });
  }, [rxn.components, rd, setRxn, pending]);

  return pending;
}
