// Tracks which saved reaction the editor is bound to (id + version + the
// content as last saved), and performs open / save / detach against `repo`.
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { canonicalJson } from '../chem/runs';
import type { Reaction } from '../chem/stoich';
import { loadOpenId, saveOpenId } from './draft';
import { repo } from './index';
import { ConflictError, NotFoundError, type SavedReaction } from './types';

interface Bound {
  id: string;
  version: number;
  /** Canonical JSON of the reaction as last saved, to detect unsaved changes (switching runs isn't one). */
  snapshot: string;
}

export type ConflictChoice = 'overwrite' | 'copy' | 'cancel';

export interface SaveResult {
  saved: SavedReaction | null;
  /** How it was stored: as an update, a new entry, or not at all. */
  outcome: 'updated' | 'created' | 'copied' | 'cancelled';
}

export function useSavedDoc(rxn: Reaction, setRxn: Dispatch<SetStateAction<Reaction>>) {
  const [bound, setBound] = useState<Bound | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-attach to the saved entry the draft came from (after a reload).
  useEffect(() => {
    const id = loadOpenId();
    if (!id) return;
    let cancelled = false;
    repo.get(id).then(
      (s) => {
        if (cancelled) return;
        if (s) setBound({ id: s.id, version: s.version, snapshot: canonicalJson(s.reaction) });
        else saveOpenId(undefined);
      },
      () => {
        /* storage unavailable: stay detached */
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => saveOpenId(bound?.id), [bound?.id]);

  const bind = useCallback((s: SavedReaction) => {
    setBound({ id: s.id, version: s.version, snapshot: canonicalJson(s.reaction) });
  }, []);

  /** Load a saved reaction into the editor. Returns false if it no longer exists. */
  const open = useCallback(
    async (id: string) => {
      const s = await repo.get(id);
      if (!s) return false;
      setRxn(s.reaction);
      bind(s);
      return true;
    },
    [bind, setRxn],
  );

  /** Start editing a reaction that is not saved yet (new, or opened from a file). */
  const detach = useCallback(
    (r?: Reaction) => {
      if (r) setRxn(r);
      setBound(null);
    },
    [setRxn],
  );

  /**
   * Save. Updates the bound entry, or creates one when unbound / `asNew`.
   * `resolveConflict` decides what to do when the entry changed elsewhere.
   */
  const save = useCallback(
    async (
      r: Reaction,
      opts: { asNew?: boolean; resolveConflict: (current: SavedReaction) => ConflictChoice; copyTitle: (t: string) => string },
    ): Promise<SaveResult> => {
      setBusy(true);
      try {
        if (opts.asNew || !bound) {
          const saved = await repo.create(r);
          bind(saved);
          return { saved, outcome: 'created' };
        }
        try {
          const saved = await repo.update(bound.id, r, bound.version);
          bind(saved);
          return { saved, outcome: 'updated' };
        } catch (e) {
          if (e instanceof NotFoundError) {
            // Deleted elsewhere: keep the user's work as a new entry.
            const saved = await repo.create(r);
            bind(saved);
            return { saved, outcome: 'created' };
          }
          if (!(e instanceof ConflictError)) throw e;
          const choice = opts.resolveConflict(e.current);
          if (choice === 'cancel') return { saved: null, outcome: 'cancelled' };
          if (choice === 'overwrite') {
            const saved = await repo.update(bound.id, r, e.current.version);
            bind(saved);
            return { saved, outcome: 'updated' };
          }
          const copy = { ...r, title: opts.copyTitle(r.title) };
          const saved = await repo.create(copy);
          setRxn(copy);
          bind(saved);
          return { saved, outcome: 'copied' };
        }
      } finally {
        setBusy(false);
      }
    },
    [bind, bound, setRxn],
  );

  /** Call after a saved entry was deleted. */
  const removed = useCallback((id: string) => {
    setBound((b) => (b?.id === id ? null : b));
  }, []);

  const dirty = bound === null ? rxn.components.length > 0 : canonicalJson(rxn) !== bound.snapshot;

  return { openId: bound?.id, dirty, busy, open, detach, save, removed };
}
