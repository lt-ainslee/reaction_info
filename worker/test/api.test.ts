// The Worker's API against an in-memory D1 (see d1.ts): schema migrations,
// saved reactions (versions, conflicts), reagent lots and the abbreviation
// table's uniqueness rules.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { memoryD1 } from './d1';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON replies of many shapes, checked by the assertions
type Call = (path: string, init?: { method?: string; body?: unknown }) => Promise<{ status: number; body: any }>;
let call: Call;
let sqlite: DatabaseSync;

/** A fresh Worker module (its "schema applied" flag is per module) on a fresh database. */
async function start(prepare?: (s: DatabaseSync) => void) {
  vi.resetModules();
  const { default: worker } = await import('../index');
  const d1 = memoryD1();
  sqlite = d1.sqlite;
  prepare?.(sqlite);
  const env = { DB: d1.db, FILES: undefined, ASSETS: undefined } as never;
  call = async (path, init = {}) => {
    const req = new Request('http://test' + path, {
      method: init.method ?? 'GET',
      ...(init.body !== undefined ? { body: JSON.stringify(init.body), headers: { 'Content-Type': 'application/json' } } : {}),
    });
    const res = await worker.fetch!(req as never, env);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

beforeEach(() => start());

const reaction = (title = 'Suzuki') => ({
  title,
  refId: 'a',
  refMmol: 1,
  components: [{ id: 'a', name: '4-bromoanisole', role: 'reactant', equiv: 1, purity: 100, form: 'neat', mw: 187 }],
});

describe('schema', () => {
  it('migrates a new database to the latest version', async () => {
    const { SCHEMA_VERSION } = await import('../schema');
    const r = await call('/api/health');
    expect(r).toMatchObject({ status: 200, body: { ok: true, storage: 'd1', schema: SCHEMA_VERSION } });
    const v = sqlite.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number };
    expect(v.v).toBe(SCHEMA_VERSION);
  });

  it('keeps only the newest of duplicate abbreviations when adding the unique index (7)', async () => {
    const { MIGRATIONS } = await import('../schema');
    await start((s) => {
      // A database at version 6 with duplicates.
      s.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
      for (const m of MIGRATIONS.filter((x) => x.version <= 6)) {
        for (const q of m.sql) s.exec(q);
        s.prepare('INSERT INTO schema_migrations VALUES (?, 0)').run(m.version);
      }
      const ins = s.prepare('INSERT INTO abbreviations (id, abbr, data, created_at, updated_at) VALUES (?, ?, ?, 1, ?)');
      ins.run('old', 'SM', '{"abbr":"SM","name":"old"}', 10);
      ins.run('new', 'SM', '{"abbr":"SM","name":"new"}', 20);
      ins.run('other', 'P', '{"abbr":"P","name":"p"}', 5);
    });
    const r = await call('/api/abbrs');
    expect(r.body.map((e: { id: string }) => e.id).sort()).toEqual(['new', 'other']);
  });
});

describe('reactions', () => {
  it('creates, reads, updates with the version and reports conflicts', async () => {
    const created = await call('/api/reactions', { method: 'POST', body: { id: 'rxn-0001', reaction: reaction() } });
    expect(created).toMatchObject({ status: 201, body: { id: 'rxn-0001', version: 1 } });

    const updated = await call('/api/reactions/rxn-0001', { method: 'PUT', body: { baseVersion: 1, reaction: reaction('Suzuki 2') } });
    expect(updated).toMatchObject({ status: 200, body: { version: 2, title: 'Suzuki 2' } });

    // Someone saved in between: 409 with what is on the server.
    const stale = await call('/api/reactions/rxn-0001', { method: 'PUT', body: { baseVersion: 1, reaction: reaction('lost') } });
    expect(stale).toMatchObject({ status: 409, body: { error: 'conflict', current: { version: 2, title: 'Suzuki 2' } } });

    const versions = sqlite.prepare('SELECT COUNT(*) AS n FROM reaction_versions WHERE reaction_id = ?').get('rxn-0001') as { n: number };
    expect(versions.n).toBe(2);
  });

  it('lists and searches, and deletes softly', async () => {
    await call('/api/reactions', { method: 'POST', body: { id: 'rxn-0001', reaction: reaction('Suzuki') } });
    await call('/api/reactions', { method: 'POST', body: { id: 'rxn-0002', reaction: reaction('Heck') } });
    expect((await call('/api/reactions')).body).toHaveLength(2);
    expect((await call('/api/reactions?q=heck')).body.map((s: { id: string }) => s.id)).toEqual(['rxn-0002']);

    expect((await call('/api/reactions/rxn-0002', { method: 'DELETE' })).status).toBe(204);
    expect((await call('/api/reactions/rxn-0002')).status).toBe(404);
    const row = sqlite.prepare('SELECT deleted_at FROM reactions WHERE id = ?').get('rxn-0002') as { deleted_at: number };
    expect(row.deleted_at).toBeGreaterThan(0);
  });

  it('rejects data that is not a reaction', async () => {
    const r = await call('/api/reactions', { method: 'POST', body: { reaction: { title: 'x' } } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
});

describe('reagent lots', () => {
  const lot = (id: string, supplier: string) => ({ id, key: 'cas:104-92-7', name: '4-bromoanisole', supplier, status: 'in_stock', createdAt: 1, updatedAt: 1 });

  it('creates, updates (PUT 404 before it exists), lists and deletes', async () => {
    expect((await call('/api/lots/l1', { method: 'PUT', body: { lot: lot('l1', 'TCI') } })).status).toBe(404);
    expect((await call('/api/lots', { method: 'POST', body: { lot: lot('l1', 'TCI') } })).status).toBe(201);
    const put = await call('/api/lots/l1', { method: 'PUT', body: { lot: lot('l1', 'Sigma') } });
    expect(put).toMatchObject({ status: 200, body: { supplier: 'Sigma', attachments: 0 } });
    expect((await call('/api/lots')).body.map((l: { supplier: string }) => l.supplier)).toEqual(['Sigma']);
    await call('/api/lots/l1', { method: 'DELETE' });
    expect((await call('/api/lots')).body).toEqual([]);
  });

  it('rejects an invalid lot', async () => {
    const r = await call('/api/lots', { method: 'POST', body: { lot: { id: 'l2' } } });
    expect(r).toMatchObject({ status: 422, body: { error: 'invalid_lot' } });
  });
});

describe('abbreviation table', () => {
  const entry = (id: string, abbr: string, name = id) => ({ entry: { id, abbr, name } });
  const ids = async () => (await call('/api/abbrs')).body.map((e: { id: string; abbr: string }) => `${e.id}=${e.abbr}`).sort();

  it('allows one live entry per abbreviation, case-sensitively', async () => {
    expect((await call('/api/abbrs', { method: 'POST', body: entry('a', 'SM') })).status).toBe(201);
    const clash = await call('/api/abbrs', { method: 'POST', body: entry('b', 'SM') });
    expect(clash).toMatchObject({ status: 409, body: { error: 'abbr_taken', other: { id: 'a' } } });
    expect((await call('/api/abbrs', { method: 'POST', body: entry('c', 'sm') })).status).toBe(201);
    expect(await ids()).toEqual(['a=SM', 'c=sm']);
  });

  it('moves an abbreviation to another entry in one step (replaces)', async () => {
    await call('/api/abbrs', { method: 'POST', body: entry('a', 'SM') });
    await call('/api/abbrs', { method: 'POST', body: entry('b', 'P') });
    // PUT on an existing entry…
    expect((await call('/api/abbrs/b', { method: 'PUT', body: { ...entry('b', 'SM'), replaces: 'a' } })).status).toBe(200);
    expect(await ids()).toEqual(['b=SM']);
    // …and POST for a new one.
    expect((await call('/api/abbrs', { method: 'POST', body: { ...entry('c', 'SM'), replaces: 'b' } })).status).toBe(201);
    expect(await ids()).toEqual(['c=SM']);
  });

  it('does not delete the replaced entry when the one being saved does not exist', async () => {
    await call('/api/abbrs', { method: 'POST', body: entry('a', 'SM') });
    const r = await call('/api/abbrs/zz', { method: 'PUT', body: { ...entry('zz', 'SM'), replaces: 'a' } });
    expect(r.status).toBe(404);
    expect(await ids()).toEqual(['a=SM']);
  });

  it('rejects an entry without an abbreviation', async () => {
    const r = await call('/api/abbrs', { method: 'POST', body: entry('a', '') });
    expect(r).toMatchObject({ status: 422, body: { error: 'invalid_entry' } });
  });
});
