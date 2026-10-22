// Reaction files (.json) for backup and sharing between people.
import type { Reaction } from '../chem/stoich';
import { normalizeReaction } from './schema';

const FILE_TAG = 'reaction-info';

export function reactionToFile(r: Reaction): string {
  return JSON.stringify({ app: FILE_TAG, version: 1, savedAt: new Date().toISOString(), reaction: r }, null, 2);
}

/** Parse a downloaded reaction file; returns null if it is not one. */
export function reactionFromFile(text: string): Reaction | null {
  try {
    const d = JSON.parse(text);
    return d?.app === FILE_TAG ? normalizeReaction(d.reaction) : null;
  } catch {
    return null;
  }
}
