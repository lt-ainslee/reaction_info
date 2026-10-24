// Shared, cached view of the reagent inventory (the lot library) for the
// whole page: the compound search, the table chips and the inventory window
// all read and update the same list.
import { useEffect, useSyncExternalStore } from 'react';
import type { ReagentLot } from '../chem/lots';
import { lotRepo } from './lots';

let lots: ReagentLot[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export function refreshInventory(): Promise<void> {
  loading = lotRepo.list().then(
    (l) => {
      lots = l;
      emit();
    },
    () => {
      lots ??= [];
      emit();
    },
  );
  return loading;
}

/** Put a saved lot into the cached list (after create / update). */
export function upsertInventory(lot: ReagentLot) {
  const prev = lots?.find((l) => l.id === lot.id);
  const next = { ...lot, attachments: lot.attachments ?? prev?.attachments };
  lots = [next, ...(lots ?? []).filter((l) => l.id !== lot.id)];
  emit();
}

export function dropFromInventory(id: string) {
  lots = (lots ?? []).filter((l) => l.id !== id);
  emit();
}

export async function saveToInventory(lot: ReagentLot): Promise<ReagentLot> {
  const { attachments: _a, ...data } = lot;
  const saved = await lotRepo.save(data);
  upsertInventory(saved);
  return saved;
}

export async function removeFromInventory(id: string) {
  await lotRepo.remove(id);
  dropFromInventory(id);
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

/** The inventory (null while loading the first time). */
export function useInventory(): ReagentLot[] | null {
  const value = useSyncExternalStore(subscribe, () => lots);
  useEffect(() => {
    if (!lots && !loading) refreshInventory();
  }, []);
  return value;
}
