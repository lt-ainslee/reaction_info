// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection, type Item } from './collection';
import { HttpError } from './http';

// No server probe in tests (index.ts asks /api/health on load).
vi.mock('./index', () => ({ repoReady: Promise.resolve('local') }));

interface Thing extends Item {
  name: string;
}
const normalize = (raw: unknown): Thing | null => {
  const r = raw as Partial<Thing> | null;
  return r && typeof r.id === 'string' && typeof r.name === 'string'
    ? { id: r.id, name: r.name, createdAt: r.createdAt ?? 0, updatedAt: r.updatedAt ?? 0 }
    : null;
};
const things = () => createCollection<Thing>({ localKey: 'things', path: '/api/things', field: 'thing', normalize });
const thing = (id: string, name = id): Thing => ({ id, name, createdAt: 1, updatedAt: 1 });

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('collection in this browser', () => {
  it('saves, lists newest first, drops invalid data, replaces and removes', async () => {
    const { local } = things();
    await local.save(thing('a'));
    await new Promise((r) => setTimeout(r, 2));
    await local.save(thing('b'));
    expect((await local.list()).map((x) => x.id)).toEqual(['b', 'a']);

    // Keeps createdAt of the stored record, stamps updatedAt.
    const again = await local.save({ ...thing('a', 'A2'), createdAt: 99 });
    expect(again.createdAt).toBe(1);
    expect(again.updatedAt).toBeGreaterThan(1);

    // `replaces` removes the other record in the same write.
    await local.save(thing('c'), 'b');
    expect((await local.list()).map((x) => x.id).sort()).toEqual(['a', 'c']);

    localStorage.setItem('things', JSON.stringify([...JSON.parse(localStorage.getItem('things')!), { id: 7 }]));
    expect(await local.list()).toHaveLength(2);

    await local.remove('a');
    expect((await local.list()).map((x) => x.id)).toEqual(['c']);
  });
});

describe('collection on the server', () => {
  const reply = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status });

  it('updates with PUT and creates with POST when the server does not have it', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? reply(404, { error: 'not_found' }) : reply(201, { ...thing('n'), createdAt: 5, updatedAt: 5 }),
    );
    vi.stubGlobal('fetch', f);
    const saved = await things().remote.save(thing('n'), 'old');
    expect(saved.createdAt).toBe(5);
    expect(f.mock.calls.map(([u, i]) => [i?.method, u])).toEqual([
      ['PUT', '/api/things/n'],
      ['POST', '/api/things'],
    ]);
    expect(JSON.parse(f.mock.calls[1][1]!.body as string)).toEqual({ thing: thing('n'), replaces: 'old' });
  });

  it('passes other errors through with the server error code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(409, { error: 'abbr_taken' })));
    const err = await things().remote.save(thing('n')).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 409, message: 'abbr_taken' });
  });
});
