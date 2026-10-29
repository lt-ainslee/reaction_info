// Shared, cached view of the reagent inventory (the lot library) for the
// whole page: the compound search, the table chips and the inventory window
// all read and update the same list.
import type { ReagentLot } from '../chem/lots';
import { lots } from './lots';

export const refreshInventory = lots.refresh;

export async function saveToInventory(lot: ReagentLot): Promise<ReagentLot> {
  // The spectra count is the server's to report, not data to store.
  const { attachments: _a, ...data } = lot;
  return lots.save(data);
}

export const removeFromInventory = lots.remove;

/** The inventory (null while loading the first time). */
export const useInventory = lots.useAll;
