// Reagent lot library (the lab's inventory): on the server (/api/lots) when
// available, else in this browser. See collection.ts.
import { normalizeLot, type ReagentLot } from '../chem/lots';
import { createCollection } from './collection';

export const lots = createCollection<ReagentLot>({
  localKey: 'reagent-lots-v1',
  path: '/api/lots',
  field: 'lot',
  normalize: normalizeLot,
  // The server adds the number of identity spectra; keep it when a reply has none.
  merge: (next, prev) => ({ ...next, attachments: next.attachments ?? prev?.attachments }),
});

/** Direct storage access (no cache): backup, restore, reports. */
export const lotRepo = lots.repo;
