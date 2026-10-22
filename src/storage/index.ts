// Storage entry point. Saved reactions go through `repo`; today that is the
// browser (localRepo). A server-backed implementation of ReactionRepo can be
// selected here without touching the UI.
import { localRepo } from './localRepo';
import type { ReactionRepo } from './types';

export const repo: ReactionRepo = localRepo;

export * from './types';
export { loadDraft, saveDraft, loadOpenId, saveOpenId } from './draft';
export { reactionFromFile, reactionToFile } from './files';
export { normalizeReaction } from './schema';
export { newId } from './ids';
