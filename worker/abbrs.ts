// Abbreviation table: /api/abbrs, /api/abbrs/:id
//   GET    /api/abbrs       list
//   POST   /api/abbrs       create ({ entry }; a client-chosen id is kept)
//   PUT    /api/abbrs/:id   replace ({ entry })
//   DELETE /api/abbrs/:id   soft delete
import { normalizeAbbr, type AbbrEntry } from '../src/chem/abbrEntry';
import { error, json, userOf, type Env } from './http';

const ABBR_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface Row {
  id: string;
  data: string;
  created_at: number;
  updated_at: number;
}

const out = (r: Row): AbbrEntry => ({ ...(JSON.parse(r.data) as AbbrEntry), id: r.id, createdAt: r.created_at, updatedAt: r.updated_at });

async function readEntry(req: Request, id?: string): Promise<AbbrEntry | Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return error(400, 'bad_json');
  }
  const raw = body?.entry as Record<string, unknown> | undefined;
  const e = normalizeAbbr(raw && { ...raw, id: id ?? raw.id ?? crypto.randomUUID() });
  return e ?? error(422, 'invalid_entry');
}

const dataOf = ({ id: _i, createdAt: _c, updatedAt: _u, ...data }: AbbrEntry) => JSON.stringify(data);

export async function handleAbbrs(req: Request, env: Env, path: string): Promise<Response | null> {
  const db = env.DB;
  const method = req.method;

  if (path === '/api/abbrs') {
    if (method === 'GET') {
      const { results } = await db
        .prepare('SELECT id, data, created_at, updated_at FROM abbreviations WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5000')
        .all<Row>();
      return json(results.map(out));
    }
    if (method === 'POST') {
      const e = await readEntry(req);
      if (e instanceof Response) return e;
      if (!ABBR_ID.test(e.id)) return error(400, 'bad_id');
      const now = Date.now();
      try {
        await db
          .prepare('INSERT INTO abbreviations (id, abbr, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(e.id, e.abbr, dataOf(e), userOf(req), now, now)
          .run();
      } catch {
        return error(409, 'exists');
      }
      return json({ ...e, createdAt: now, updatedAt: now }, 201);
    }
    return error(405, 'method_not_allowed');
  }

  const m = /^\/api\/abbrs\/([^/]+)$/.exec(path);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  if (!ABBR_ID.test(id)) return error(400, 'bad_id');
  if (method === 'PUT') {
    const e = await readEntry(req, id);
    if (e instanceof Response) return e;
    const now = Date.now();
    const res = await db
      .prepare('UPDATE abbreviations SET abbr = ?, data = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .bind(e.abbr, dataOf(e), now, id)
      .run();
    if (!res.meta.changes) return error(404, 'not_found');
    const row = await db.prepare('SELECT id, data, created_at, updated_at FROM abbreviations WHERE id = ?').bind(id).first<Row>();
    return json(out(row!));
  }
  if (method === 'DELETE') {
    await db.prepare('UPDATE abbreviations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(Date.now(), id).run();
    return new Response(null, { status: 204 });
  }
  return error(405, 'method_not_allowed');
}
