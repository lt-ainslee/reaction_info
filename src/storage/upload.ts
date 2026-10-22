// One-off upload of reactions saved in this browser to the server. Local
// data is kept; uploaded ids are remembered so the offer disappears.
import { apiRepo } from './apiRepo';
import { localRepo } from './localRepo';

const DONE = 'uploaded-to-server-v1';

function doneIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** Local reactions not yet uploaded. */
export async function pendingLocalUploads(): Promise<string[]> {
  const done = doneIds();
  return (await localRepo.list()).map((s) => s.id).filter((id) => !done.has(id));
}

/** Upload pending local reactions (keeping ids). Returns counts. */
export async function uploadLocalReactions(): Promise<{ uploaded: number; existing: number }> {
  const done = doneIds();
  let uploaded = 0;
  let existing = 0;
  for (const id of await pendingLocalUploads()) {
    const s = await localRepo.get(id);
    if (!s) continue;
    if (await apiRepo.importEntry(id, s.reaction)) uploaded++;
    else existing++;
    done.add(id);
    try {
      localStorage.setItem(DONE, JSON.stringify([...done]));
    } catch {
      /* ignore */
    }
  }
  return { uploaded, existing };
}
