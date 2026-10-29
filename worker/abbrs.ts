// Abbreviation table: /api/abbrs, /api/abbrs/:id
//   GET    /api/abbrs       list
//   POST   /api/abbrs       create ({ entry, replaces? }; a client-chosen id is kept)
//   PUT    /api/abbrs/:id   replace ({ entry, replaces? })
//   DELETE /api/abbrs/:id   soft delete
// One live entry per abbreviation (case-sensitive: "Bn" ≠ "BN"), enforced by a
// unique index. Moving an abbreviation to another compound sends the old entry
// as `replaces`: it is deleted in the same transaction as the save. A clash
// answers 409 { error: 'abbr_taken', other }.
import { normalizeAbbr, type AbbrEntry } from '../src/chem/abbrEntry';
import { error, json, readRecord, userOf, type Env } from './http';

const ABBR_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface Row {
  id: string;
  data: string;
  created_at: number;
  updated_at: number;
}

const COLS = 'id, data, created_at, updated_at';
const out = (r: Row): AbbrEntry => ({ ...(JSON.parse(r.data) as AbbrEntry), id: r.id, createdAt: r.created_at, updatedAt: r.updated_at });
const dataOf = ({ id: _i, createdAt: _c, updatedAt: _u, ...data }: AbbrEntry) => JSON.stringify(data);

/** Another live entry holding `abbr` (other than `id` and the one being replaced). */
const holder = (db: D1Database, abbr: string, id: string, replaces?: string) =>
  db
    .prepare(`SELECT ${COLS} FROM abbreviations WHERE abbr = ? AND id != ? AND id != ? AND deleted_at IS NULL`)
    .bind(abbr, id, replaces ?? '')
    .first<Row>();

const taken = (row: Row) => error(409, 'abbr_taken', { other: out(row) });

/** Soft delete `replaces` — on PUT only if the entry being saved exists (else the batch must not delete it). */
function dropReplaced(db: D1Database, replaces: string, now: number, onlyIfExists?: string) {
  const guard = onlyIfExists ? ' AND EXISTS (SELECT 1 FROM abbreviations WHERE id = ? AND deleted_at IS NULL)' : '';
  const stmt = db.prepare(`UPDATE abbreviations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL${guard}`);
  return onlyIfExists ? stmt.bind(now, replaces, onlyIfExists) : stmt.bind(now, replaces);
}

/** A unique-index failure on the abbreviation (a concurrent save won the race). */
const isAbbrClash = (e: unknown) => /UNIQUE constraint failed: abbreviations\.abbr/.test(String((e as Error)?.message ?? e));

export async function handleAbbrs(req: Request, env: Env, path: string): Promise<Response | null> {
  const db = env.DB;
  const method = req.method;

  if (path === '/api/abbrs') {
    if (method === 'GET') {
      const { results } = await db.prepare(`SELECT ${COLS} FROM abbreviations WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5000`).all<Row>();
      return json(results.map(out));
    }
    if (method === 'POST') {
      const r = await readRecord(req, 'entry', normalizeAbbr);
      if (r instanceof Response) return r;
      const { record: e, replaces } = r;
      if (!ABBR_ID.test(e.id)) return error(400, 'bad_id');
      const other = await holder(db, e.abbr, e.id, replaces);
      if (other) return taken(other);
      const now = Date.now();
      try {
        await db.batch([
          ...(replaces ? [dropReplaced(db, replaces, now)] : []),
          db
            .prepare('INSERT INTO abbreviations (id, abbr, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(e.id, e.abbr, dataOf(e), userOf(req), now, now),
        ]);
      } catch (err) {
        if (isAbbrClash(err)) {
          const winner = await holder(db, e.abbr, e.id, replaces);
          if (winner) return taken(winner);
        }
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
    const r = await readRecord(req, 'entry', normalizeAbbr, id);
    if (r instanceof Response) return r;
    const { record: e, replaces } = r;
    const other = await holder(db, e.abbr, id, replaces);
    if (other) return taken(other);
    const now = Date.now();
    let changes: number;
    try {
      const res = await db.batch([
        ...(replaces ? [dropReplaced(db, replaces, now, id)] : []),
        db.prepare('UPDATE abbreviations SET abbr = ?, data = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').bind(e.abbr, dataOf(e), now, id),
      ]);
      changes = res[res.length - 1].meta.changes;
    } catch (err) {
      const winner = isAbbrClash(err) ? await holder(db, e.abbr, id, replaces) : null;
      if (winner) return taken(winner);
      throw err;
    }
    if (!changes) return error(404, 'not_found');
    const row = await db.prepare(`SELECT ${COLS} FROM abbreviations WHERE id = ?`).bind(id).first<Row>();
    return json(out(row!));
  }
  if (method === 'DELETE') {
    await db.prepare('UPDATE abbreviations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(Date.now(), id).run();
    return new Response(null, { status: 204 });
  }
  return error(405, 'method_not_allowed');
}
