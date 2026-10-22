// The reaction currently being edited. Always kept in this browser (it is
// written on every change), independent of where saved reactions live.
import type { Reaction } from '../chem/stoich';
import { normalizeReaction } from './schema';

const DRAFT = 'current-reaction-v1';
const OPEN_ID = 'current-saved-id';

export function loadDraft(): Reaction | null {
  try {
    return normalizeReaction(JSON.parse(localStorage.getItem(DRAFT) ?? 'null'));
  } catch {
    return null;
  }
}

export function saveDraft(r: Reaction) {
  try {
    localStorage.setItem(DRAFT, JSON.stringify(r));
  } catch {
    /* storage disabled or full */
  }
}

/** Id of the saved reaction the draft was opened from, if any. */
export function loadOpenId(): string | undefined {
  try {
    return localStorage.getItem(OPEN_ID) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveOpenId(id: string | undefined) {
  try {
    if (id) localStorage.setItem(OPEN_ID, id);
    else localStorage.removeItem(OPEN_ID);
  } catch {
    /* ignore */
  }
}
