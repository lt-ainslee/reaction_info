// Storage entry point. Saved reactions go through `repo`, which picks the
// server (Worker + D1) when /api is reachable, else this browser
// (localStorage) — e.g. in local development or if the API is down.
import { apiRepo, serverAvailable } from './apiRepo';
import { localRepo } from './localRepo';
import type { ReactionRepo } from './types';

let impl: ReactionRepo = localRepo;

/** Resolves once the storage backend has been chosen. */
export const repoReady: Promise<ReactionRepo['kind']> = serverAvailable().then((ok) => {
  if (ok) impl = apiRepo;
  return impl.kind;
});

/** Delegates to the chosen backend (waits for the choice on first use). */
export const repo: ReactionRepo = {
  get kind() {
    return impl.kind;
  },
  list: () => repoReady.then(() => impl.list()),
  get: (id) => repoReady.then(() => impl.get(id)),
  create: (r) => repoReady.then(() => impl.create(r)),
  update: (id, r, v) => repoReady.then(() => impl.update(id, r, v)),
  remove: (id) => repoReady.then(() => impl.remove(id)),
};

export * from './types';
export { loadDraft, saveDraft, loadOpenId, saveOpenId } from './draft';
export { reactionFromFile, reactionToFile } from './files';
export { normalizeReaction } from './schema';
export { newId } from './ids';
export { localRepo } from './localRepo';
export { uploadLocalReactions, pendingLocalUploads } from './upload';
