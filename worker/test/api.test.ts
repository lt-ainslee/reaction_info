// The Worker's API against an in-memory D1 (see d1.ts): schema migrations,
// saved reactions (versions, conflicts), reagent lots and the abbreviation
// table's uniqueness rules.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { memoryD1 } from './d1';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON replies of many shapes, checked by the assertions
type Reply = { status: number; body: any; cookie?: string };
type Call = (path: string, init?: { method?: string; body?: unknown; cookie?: string | null; origin?: string }) => Promise<Reply>;
/** Requests as the first account (alice, admin); pass `cookie` to act as someone else (null: signed out). */
let call: Call;
let sqlite: DatabaseSync;

/** A fresh Worker module (its "schema applied" flag is per module) on a fresh database, with alice signed in. */
async function start(prepare?: (s: DatabaseSync) => void) {
  vi.resetModules();
  const { default: worker } = await import('../index');
  const d1 = memoryD1();
  sqlite = d1.sqlite;
  prepare?.(sqlite);
  const env = { DB: d1.db, FILES: undefined, ASSETS: undefined } as never;
  let alice: string | null = null;
  call = async (path, init = {}) => {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = init.cookie === undefined ? alice : init.cookie;
    if (cookie) headers.Cookie = cookie;
    if (init.origin) headers.Origin = init.origin;
    const req = new Request('http://test' + path, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const res = await worker.fetch!(req as never, env);
    const text = await res.text();
    const set = res.headers.get('Set-Cookie');
    return { status: res.status, body: text ? JSON.parse(text) : null, ...(set ? { cookie: set.split(';')[0] } : {}) };
  };
  const setup = await call('/api/auth/setup', { method: 'POST', body: { username: 'alice', password: 'secret1', name: 'Alice' }, cookie: null });
  alice = setup.cookie ?? null;
}

/** Register another account and return its session cookie. */
async function signUp(username: string): Promise<string> {
  const r = await call('/api/auth/register', { method: 'POST', body: { username, password: 'secret2', name: username }, cookie: null });
  expect(r.status).toBe(201);
  return r.cookie!;
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

describe('accounts', () => {
  it('needs a signed-in user for data, and tells a new site it needs its first account', async () => {
    expect((await call('/api/reactions', { cookie: null })).status).toBe(401);
    expect((await call('/api/auth/me')).body.user).toMatchObject({ username: 'alice', role: 'admin' });
    // After setup, setup is closed; a fresh database asks for it.
    expect((await call('/api/auth/setup', { method: 'POST', body: { username: 'eve', password: 'secret9' }, cookie: null })).status).toBe(409);
    await start((s) => s.exec('SELECT 1'));
    expect((await call('/api/auth/me', { cookie: null })).body).toMatchObject({ error: 'unauthorized', needsSetup: false, signup: 'open' });
  });

  it('signs in and out, rejects wrong passwords and stores only a hash', async () => {
    await signUp('bob');
    expect((await call('/api/auth/login', { method: 'POST', body: { username: 'bob', password: 'nope00' }, cookie: null })).status).toBe(401);
    const ok = await call('/api/auth/login', { method: 'POST', body: { username: 'BOB', password: 'secret2' }, cookie: null });
    expect(ok.status).toBe(200);
    expect((await call('/api/auth/me', { cookie: ok.cookie })).body.user.username).toBe('bob');
    await call('/api/auth/logout', { method: 'POST', cookie: ok.cookie });
    expect((await call('/api/auth/me', { cookie: ok.cookie })).status).toBe(401);
    const row = sqlite.prepare(`SELECT pw FROM users WHERE username = 'bob'`).get() as { pw: string };
    expect(row.pw).toMatch(/^pbkdf2\$/);
    expect(row.pw).not.toContain('secret2');
  });

  it('rejects taken user names, weak passwords and writes from other sites', async () => {
    await signUp('bob');
    expect((await call('/api/auth/register', { method: 'POST', body: { username: 'bob', password: 'secret3' }, cookie: null })).status).toBe(409);
    expect((await call('/api/auth/register', { method: 'POST', body: { username: 'carol', password: '123' }, cookie: null })).status).toBe(422);
    const r = await call('/api/reactions', { method: 'POST', body: { reaction: reaction() }, origin: 'http://evil.example' });
    expect(r.status).toBe(403);
  });

  it('lets an admin close sign-up and disable accounts, but not remove the last admin', async () => {
    const bob = await signUp('bob');
    expect((await call('/api/admin/users', { cookie: bob })).status).toBe(403);
    expect((await call('/api/admin/settings', { method: 'PUT', body: { signup: 'closed' } })).status).toBe(204);
    expect((await call('/api/auth/register', { method: 'POST', body: { username: 'carol', password: 'secret3' }, cookie: null })).status).toBe(403);
    const { users } = (await call('/api/admin/users')).body;
    const bobId = users.find((u: { username: string }) => u.username === 'bob').id;
    const aliceId = users.find((u: { username: string }) => u.username === 'alice').id;
    expect((await call(`/api/admin/users/${aliceId}`, { method: 'PATCH', body: { role: 'member' } })).status).toBe(409);
    expect((await call(`/api/admin/users/${bobId}`, { method: 'PATCH', body: { disabled: true } })).status).toBe(204);
    expect((await call('/api/reactions', { cookie: bob })).status).toBe(401);
  });
});

describe('private and shared records', () => {
  it('keeps private reactions to their owner; shared ones are read-only for others', async () => {
    const bob = await signUp('bob');
    await call('/api/reactions', { method: 'POST', body: { id: 'rxn-priv', reaction: reaction('mine'), visibility: 'private' } });
    await call('/api/reactions', { method: 'POST', body: { id: 'rxn-shared', reaction: reaction('ours'), visibility: 'shared' } });
    await call('/api/reactions', { method: 'POST', body: { id: 'rxn-group', reaction: reaction('group'), visibility: 'editable' } });

    const list = (await call('/api/reactions', { cookie: bob })).body;
    expect(list.map((s: { id: string }) => s.id).sort()).toEqual(['rxn-group', 'rxn-shared']);
    expect(list.find((s: { id: string }) => s.id === 'rxn-shared')).toMatchObject({ owner: 'Alice', access: { mine: false, canEdit: false } });
    expect((await call('/api/reactions/rxn-priv', { cookie: bob })).status).toBe(404);
    // Taking a private id does not reveal the reaction.
    const clash = await call('/api/reactions', { method: 'POST', body: { id: 'rxn-priv', reaction: reaction() }, cookie: bob });
    expect(clash).toMatchObject({ status: 409 });
    expect(clash.body.current).toBeUndefined();

    expect((await call('/api/reactions/rxn-shared', { method: 'PUT', body: { baseVersion: 1, reaction: reaction('x') }, cookie: bob })).status).toBe(403);
    expect((await call('/api/reactions/rxn-group', { method: 'PUT', body: { baseVersion: 1, reaction: reaction('y') }, cookie: bob })).status).toBe(200);
    // Only the owner deletes or changes sharing.
    expect((await call('/api/reactions/rxn-group', { method: 'DELETE', cookie: bob })).status).toBe(403);
    expect((await call('/api/reactions/rxn-shared/access', { method: 'PUT', body: { visibility: 'editable' }, cookie: bob })).status).toBe(403);
    expect((await call('/api/reactions/rxn-shared/access', { method: 'PUT', body: { visibility: 'private' } })).status).toBe(200);
    expect((await call('/api/reactions/rxn-shared', { cookie: bob })).status).toBe(404);
    expect((await call('/api/reactions?scope=mine', { cookie: bob })).body).toEqual([]);
  });

  it('uses the account default visibility for new records', async () => {
    const bob = await signUp('bob');
    await call('/api/auth/profile', { method: 'PUT', body: { prefs: { reactions: 'shared' } } });
    await call('/api/reactions', { method: 'POST', body: { id: 'rxn-0001', reaction: reaction() } });
    expect((await call('/api/reactions', { cookie: bob })).body).toHaveLength(1);
    await call('/api/auth/profile', { method: 'PUT', body: { prefs: { reactions: 'private' } } });
    await call('/api/reactions', { method: 'POST', body: { id: 'rxn-0002', reaction: reaction() } });
    expect((await call('/api/reactions', { cookie: bob })).body).toHaveLength(1);
  });

  it('keeps records from before accounts visible and editable to everyone', async () => {
    const bob = await signUp('bob');
    sqlite
      .prepare(`INSERT INTO reactions (id, title, data, owner, version, created_at, updated_at) VALUES ('old-rxn1', 'old', ?, NULL, 1, 1, 1)`)
      .run(JSON.stringify(reaction('old')));
    const r = await call('/api/reactions/old-rxn1', { cookie: bob });
    expect(r).toMatchObject({ status: 200, body: { access: { visibility: 'editable', canEdit: true, canManage: false } } });
    // An admin looks after them.
    expect((await call('/api/reactions/old-rxn1')).body.access.canManage).toBe(true);
  });

  it('applies the same rules to reagent lots', async () => {
    const bob = await signUp('bob');
    const lot = (id: string) => ({ id, key: 'cas:104-92-7', name: '4-bromoanisole', status: 'in_stock', createdAt: 1, updatedAt: 1 });
    await call('/api/lots', { method: 'POST', body: { lot: lot('lot-a'), visibility: 'private' } });
    await call('/api/lots', { method: 'POST', body: { lot: lot('lot-b'), visibility: 'shared' } });
    expect((await call('/api/lots', { cookie: bob })).body.map((l: { id: string }) => l.id)).toEqual(['lot-b']);
    expect((await call('/api/lots/lot-a', { cookie: bob })).status).toBe(404);
    expect((await call('/api/lots/lot-b', { method: 'PUT', body: { lot: lot('lot-b') }, cookie: bob })).status).toBe(403);
    expect((await call('/api/lots/lot-a/attachments', { cookie: bob })).status).toBe(404);
    expect((await call('/api/lots/lot-b/attachments', { cookie: bob })).status).toBe(200);
    // The owner changes the visibility with a PUT.
    const put = await call('/api/lots/lot-a', { method: 'PUT', body: { lot: lot('lot-a'), visibility: 'editable' } });
    expect(put.body.access).toMatchObject({ visibility: 'editable', mine: true });
    expect((await call('/api/lots/lot-a', { method: 'PUT', body: { lot: lot('lot-a'), visibility: 'private' }, cookie: bob })).status).toBe(403);
    expect((await call('/api/lots/lot-a', { method: 'PUT', body: { lot: lot('lot-a') }, cookie: bob })).status).toBe(200);
  });

  it('gives everyone their own abbreviations; their own win over shared ones', async () => {
    const bob = await signUp('bob');
    const entry = (id: string, abbr: string, name: string, visibility = 'shared') => ({ entry: { id, abbr, name }, visibility });
    expect((await call('/api/abbrs', { method: 'POST', body: entry('a1', 'SM', 'alice-sm') })).status).toBe(201);
    expect((await call('/api/abbrs', { method: 'POST', body: entry('a2', 'P', 'alice-p', 'private') })).status).toBe(201);
    // Bob may use "SM" for his own compound.
    expect((await call('/api/abbrs', { method: 'POST', body: entry('b1', 'SM', 'bob-sm', 'private'), cookie: bob })).status).toBe(201);
    const bobs = (await call('/api/abbrs', { cookie: bob })).body;
    expect(bobs.map((e: { id: string }) => e.id)).toEqual(['b1']);
    const alices = (await call('/api/abbrs')).body;
    expect(alices.map((e: { id: string }) => e.id).sort()).toEqual(['a1', 'a2']);
    // Bob cannot take over Alice's entry with `replaces`.
    await call('/api/abbrs', { method: 'POST', body: { ...entry('b2', 'X', 'bob-x'), replaces: 'a1' }, cookie: bob });
    expect((await call('/api/abbrs')).body.map((e: { id: string }) => e.id).sort()).toEqual(['a1', 'a2', 'b2']);
    expect((await call('/api/abbrs/a1', { method: 'DELETE', cookie: bob })).status).toBe(403);
  });
});
