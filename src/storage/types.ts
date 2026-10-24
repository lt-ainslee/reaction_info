import type { ReactionMeta } from '../chem/runs';
import type { Reaction } from '../chem/stoich';

/** What a list of saved reactions shows, without the (possibly large) body. */
export interface SavedSummary {
  id: string;
  title: string;
  /** Epoch ms of the last save. */
  updatedAt: number;
  /** Incremented on every save; used to detect concurrent edits. */
  version: number;
  /** Who saved it (remote storage only). */
  owner?: string;
  /** Reaction code, number of runs, best yield (absent from old servers). */
  meta?: ReactionMeta;
}

export interface SavedReaction extends SavedSummary {
  reaction: Reaction;
}

/**
 * Persistence for saved reactions. The local (browser) implementation and a
 * future server implementation share this interface, so the UI does not care
 * where reactions live. Methods map one-to-one to REST calls.
 */
export interface ReactionRepo {
  /** 'local': this browser only; 'remote': shared server. */
  readonly kind: 'local' | 'remote';
  /** Most recently saved first. */
  list(): Promise<SavedSummary[]>;
  get(id: string): Promise<SavedReaction | null>;
  create(reaction: Reaction): Promise<SavedReaction>;
  /**
   * Overwrite a saved reaction. Throws ConflictError if it was saved
   * elsewhere since `baseVersion`, NotFoundError if it no longer exists.
   */
  update(id: string, reaction: Reaction, baseVersion: number): Promise<SavedReaction>;
  remove(id: string): Promise<void>;
}

export class ConflictError extends Error {
  constructor(readonly current: SavedReaction) {
    super('conflict');
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends Error {
  constructor(readonly id: string) {
    super('not found');
    this.name = 'NotFoundError';
  }
}
