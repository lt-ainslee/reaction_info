// Shared, cached view of the reagent inventory (the lot library) for the
// whole page: the compound search, the table chips and the inventory window
// all read and update the same list.
import type { ReagentLot } from '../chem/lots';
import type { Visibility } from './access';
import { lots } from './lots';

export const refreshInventory = lots.refresh;

/** Save a lot; `visibility` (server only) changes who sees it, else it is kept (new: the account default). */
export async function saveToInventory(lot: ReagentLot, visibility?: Visibility): Promise<ReagentLot> {
  // The spectra count is the server's to report, not data to store.
  const { attachments: _a, ...data } = lot;
  return lots.save(data, undefined, visibility);
}

export const removeFromInventory = lots.remove;

/** The inventory (null while loading the first time). */
export const useInventory = lots.useAll;
