// Saved reactions in this browser's localStorage.
import { reactionMeta } from '../chem/runs';
import type { Reaction } from '../chem/stoich';
import { newId } from './ids';
import { normalizeReaction } from './schema';
import { ConflictError, NotFoundError, type ReactionRepo, type SavedReaction, type SavedSummary } from './types';

const KEY = 'saved-reactions-v2';
/** Format before versions existed: [{ id, savedAt, reaction }]. Read once, never written or deleted. */
const LEGACY_KEY = 'saved-reactions-v1';

function readAll(): SavedReaction[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) return (JSON.parse(raw) as unknown[]).map(fromStored).filter((x): x is SavedReaction => !!x);
    return migrateLegacy();
  } catch {
    return [];
  }
}

function writeAll(list: SavedReaction[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    // Quota exceeded is the realistic case; surface it to the caller.
    throw e instanceof Error ? e : new Error(String(e));
  }
}

function fromStored(x: unknown): SavedReaction | null {
  if (typeof x !== 'object' || x === null) return null;
  const e = x as Partial<SavedReaction>;
  const reaction = normalizeReaction(e.reaction);
  if (!reaction || typeof e.id !== 'string') return null;
  return {
    id: e.id,
    title: reaction.title,
    updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : Date.now(),
    version: typeof e.version === 'number' ? e.version : 1,
    reaction,
  };
}

function migrateLegacy(): SavedReaction[] {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return [];
  const old = JSON.parse(raw) as { id?: unknown; savedAt?: unknown; reaction?: unknown }[];
  const list = old
    .map((o) => fromStored({ id: o.id, updatedAt: o.savedAt, version: 1, reaction: o.reaction }))
    .filter((x): x is SavedReaction => !!x);
  writeAll(list);
  return list;
}

const summary = ({ reaction, ...s }: SavedReaction): SavedSummary => ({ ...s, meta: reactionMeta(reaction) });

export const localRepo: ReactionRepo & {
  /** Add a reaction keeping its id (backups); false if the id exists. */
  importEntry(id: string, reaction: Reaction, updatedAt?: number): Promise<boolean>;
} = {
  kind: 'local',

  async list() {
    return readAll().map(summary);
  },

  async get(id) {
    return readAll().find((s) => s.id === id) ?? null;
  },

  async create(reaction) {
    const entry: SavedReaction = { id: newId(), title: reaction.title, updatedAt: Date.now(), version: 1, reaction };
    writeAll([entry, ...readAll()]);
    return entry;
  },

  async update(id, reaction: Reaction, baseVersion) {
    const all = readAll();
    const cur = all.find((s) => s.id === id);
    if (!cur) throw new NotFoundError(id);
    if (cur.version !== baseVersion) throw new ConflictError(cur);
    const entry: SavedReaction = { id, title: reaction.title, updatedAt: Date.now(), version: cur.version + 1, reaction };
    writeAll([entry, ...all.filter((s) => s.id !== id)]);
    return entry;
  },

  async remove(id) {
    writeAll(readAll().filter((s) => s.id !== id));
  },

  async importEntry(id, reaction, updatedAt = Date.now()) {
    const all = readAll();
    if (all.some((s) => s.id === id)) return false;
    writeAll([...all, { id, title: reaction.title, updatedAt, version: 1, reaction }].sort((a, b) => b.updatedAt - a.updatedAt));
    return true;
  },
};
