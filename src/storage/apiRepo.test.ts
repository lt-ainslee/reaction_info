import { afterEach, describe, expect, it, vi } from 'vitest';
import { addComponent, emptyReaction, newComponent } from '../chem/stoich';
import { apiRepo, serverAvailable } from './apiRepo';
import { ConflictError, NotFoundError } from './types';

const rxn = addComponent(emptyReaction(), newComponent({ name: 'A', role: 'reactant', mw: 1 }));
const entry = (version: number) => ({ id: 'r1', title: '', updatedAt: 1, version, reaction: rxn });

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('apiRepo', () => {
  it('sends baseVersion and returns the saved entry', async () => {
    const f = mockFetch(200, entry(3));
    const saved = await apiRepo.update('r1', rxn, 2);
    expect(saved.version).toBe(3);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/reactions/r1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string).baseVersion).toBe(2);
  });

  it('maps 409 to ConflictError with the current entry and 404 to NotFoundError', async () => {
    mockFetch(409, { error: 'conflict', current: entry(5) });
    await expect(apiRepo.update('r1', rxn, 2)).rejects.toMatchObject({ current: { version: 5 } });
    mockFetch(409, { error: 'conflict', current: entry(5) });
    await expect(apiRepo.update('r1', rxn, 2)).rejects.toBeInstanceOf(ConflictError);
    mockFetch(404, { error: 'not_found' });
    await expect(apiRepo.update('r1', rxn, 2)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('get returns null for 404 and rejects invalid server data', async () => {
    mockFetch(404, { error: 'not_found' });
    expect(await apiRepo.get('x')).toBeNull();
    mockFetch(200, { ...entry(1), reaction: { components: 'bad' } });
    await expect(apiRepo.get('x')).rejects.toThrow();
  });

  it('importEntry reports existing ids instead of failing', async () => {
    mockFetch(201, entry(1));
    expect(await apiRepo.importEntry('r1', rxn)).toBe(true);
    mockFetch(409, { error: 'exists' });
    expect(await apiRepo.importEntry('r1', rxn)).toBe(false);
    mockFetch(500, { error: 'server_error' });
    await expect(apiRepo.importEntry('r1', rxn)).rejects.toThrow();
  });

  it('detects the server only from a real health response', async () => {
    mockFetch(200, { ok: true, storage: 'd1' });
    expect(await serverAvailable()).toBe(true);
    // A static host answering every path with index.html is not a server.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { status: 200 })));
    expect(await serverAvailable()).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await serverAvailable()).toBe(false);
  });
});
