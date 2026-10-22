// Saved reactions on the server (Worker + D1, see worker/index.ts).
import type { Reaction } from '../chem/stoich';
import { normalizeReaction } from './schema';
import { ConflictError, NotFoundError, type ReactionRepo, type SavedReaction, type SavedSummary } from './types';

const BASE = '/api/reactions';

class HttpError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown> | null) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status, body);
  return body as T;
}

/** Validate server data with the same rules as local data. */
function toSaved(x: SavedReaction): SavedReaction {
  const reaction = normalizeReaction(x.reaction);
  if (!reaction) throw new Error('invalid reaction from server');
  return { ...x, reaction };
}

export const apiRepo: ReactionRepo & {
  /** Upload a reaction keeping its id; resolves false if that id already exists. */
  importEntry(id: string, reaction: Reaction): Promise<boolean>;
} = {
  kind: 'remote',

  list: () => call<SavedSummary[]>(BASE),

  async get(id) {
    try {
      return toSaved(await call<SavedReaction>(`${BASE}/${encodeURIComponent(id)}`));
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  },

  async create(reaction) {
    return toSaved(await call<SavedReaction>(BASE, { method: 'POST', body: JSON.stringify({ reaction }) }));
  },

  async update(id, reaction, baseVersion) {
    try {
      return toSaved(
        await call<SavedReaction>(`${BASE}/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify({ reaction, baseVersion }),
        }),
      );
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) throw new NotFoundError(id);
      if (e instanceof HttpError && e.status === 409 && e.body?.current) throw new ConflictError(toSaved(e.body.current as SavedReaction));
      throw e;
    }
  },

  async remove(id) {
    await call<void>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async importEntry(id, reaction) {
    try {
      await call(BASE, { method: 'POST', body: JSON.stringify({ id, reaction }) });
      return true;
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) return false;
      throw e;
    }
  },
};

/** True when the server API is reachable (deployed Worker with D1). */
export async function serverAvailable(timeoutMs = 4000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { storage?: string } | null;
    return body?.storage === 'd1';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
