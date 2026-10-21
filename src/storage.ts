import type { Reaction } from './chem/stoich';

const CURRENT = 'current-reaction-v1';
const SAVED = 'saved-reactions-v1';

export interface SavedReaction { id: string; savedAt: number; reaction: Reaction }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage disabled or full */
  }
}

export const loadCurrent = (): Reaction | null => read<Reaction | null>(CURRENT, null);
export const saveCurrent = (r: Reaction) => write(CURRENT, r);

export const listSaved = (): SavedReaction[] => read<SavedReaction[]>(SAVED, []);

export function saveReaction(r: Reaction, id?: string): SavedReaction[] {
  const list = listSaved().filter((s) => s.id !== id);
  const entry = { id: id ?? Math.random().toString(36).slice(2, 10), savedAt: Date.now(), reaction: r };
  const next = [entry, ...list];
  write(SAVED, next);
  return next;
}

export function deleteSaved(id: string): SavedReaction[] {
  const next = listSaved().filter((s) => s.id !== id);
  write(SAVED, next);
  return next;
}

// ---- reaction files (.json) for backup / sharing between people ----

const FILE_TAG = 'reaction-info';

export function reactionToFile(r: Reaction): string {
  return JSON.stringify({ app: FILE_TAG, version: 1, savedAt: new Date().toISOString(), reaction: r }, null, 2);
}

/** Parse a downloaded reaction file; returns null if it is not one. */
export function reactionFromFile(text: string): Reaction | null {
  try {
    const d = JSON.parse(text);
    const r = d?.app === FILE_TAG ? d.reaction : null;
    if (!r || !Array.isArray(r.components) || typeof r.refMmol !== 'number') return null;
    return r as Reaction;
  } catch {
    return null;
  }
}
