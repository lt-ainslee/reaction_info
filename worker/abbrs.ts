// Abbreviation table: /api/abbrs, /api/abbrs/:id
//   GET    /api/abbrs       list: the user's own entries, then others' that are
//                           shared with them (one entry per abbreviation: own first)
//   POST   /api/abbrs       create ({ entry, replaces?, visibility? }; a client-chosen id is kept)
//   PUT    /api/abbrs/:id   replace ({ entry, replaces?, visibility? })
//   DELETE /api/abbrs/:id   soft delete
// One live entry per abbreviation and owner (case-sensitive: "Bn" ≠ "BN"),
// enforced by a unique index: everyone may have their own "SM-1". Moving an
// abbreviation to another compound sends the old entry as `replaces`: it is
// deleted in the same transaction as the save (only when it has the same
// owner). A clash answers 409 { error: 'abbr_taken', other }.
import { normalizeAbbr, type AbbrEntry } from '../src/chem/abbrEntry';
import { accessOf, canRead, READABLE_SQL } from '../src/storage/access';
import type { User } from './auth';
import { error, forbidden, json, readRecord, type Env } from './http';

const ABBR_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface Row {
  id: string;
  data: string;
  created_at: number;
  updated_at: number;
  created_by: string | null;
  visibility: string;
  owner_name: string | null;
}

const COLS = 'a.id, a.data, a.created_at, a.updated_at, a.created_by, a.visibility, u.name AS owner_name';
const FROM = 'FROM abbreviations a LEFT JOIN users u ON u.id = a.created_by';
const out = (r: Row, user: User): AbbrEntry => ({
  ...(JSON.parse(r.data) as AbbrEntry),
  id: r.id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  access: accessOf(user, r.created_by, r.visibility, r.owner_name),
});
const dataOf = ({ id: _i, createdAt: _c, updatedAt: _u, access: _a, ...data }: AbbrEntry) => JSON.stringify(data);

/** Same owner (NULL = the group table from before accounts). */
const SAME_OWNER = `COALESCE(a.created_by, '') = COALESCE(?, '')`;

/** Another live entry of `owner` holding `abbr` (other than `id` and the one being replaced). */
const holder = (db: D1Database, owner: string | null, abbr: string, id: string, replaces?: string) =>
  db
    .prepare(`SELECT ${COLS} ${FROM} WHERE ${SAME_OWNER} AND a.abbr = ? AND a.id != ? AND a.id != ? AND a.deleted_at IS NULL`)
    .bind(owner, abbr, id, replaces ?? '')
    .first<Row>();

/**
 * Soft delete `replaces` when it belongs to `owner` — on PUT only if the entry
 * being saved exists (else the batch must not delete it).
 */
function dropReplaced(db: D1Database, owner: string | null, replaces: string, now: number, onlyIfExists?: string) {
  const guard = onlyIfExists ? ' AND EXISTS (SELECT 1 FROM abbreviations WHERE id = ? AND deleted_at IS NULL)' : '';
  const stmt = db.prepare(
    `UPDATE abbreviations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL AND COALESCE(created_by, '') = COALESCE(?, '')${guard}`,
  );
  return onlyIfExists ? stmt.bind(now, replaces, owner, onlyIfExists) : stmt.bind(now, replaces, owner);
}

/** A unique-index failure on the abbreviation (a concurrent save won the race). */
const isAbbrClash = (e: unknown) => /UNIQUE constraint failed|idx_abbr_owner_live/.test(String((e as Error)?.message ?? e));

const accessRow = (db: D1Database, id: string) =>
  db.prepare('SELECT created_by, visibility FROM abbreviations WHERE id = ? AND deleted_at IS NULL').bind(id).first<{ created_by: string | null; visibility: string }>();

export async function handleAbbrs(req: Request, env: Env, path: string, user: User): Promise<Response | null> {
  const db = env.DB;
  const method = req.method;
  const taken = (row: Row) => error(409, 'abbr_taken', { other: out(row, user) });

  if (path === '/api/abbrs') {
    if (method === 'GET') {
      // Own entries first, then the group's and others' shared ones (newest first).
      const { results } = await db
        .prepare(
          `SELECT ${COLS} ${FROM} WHERE a.deleted_at IS NULL AND ${READABLE_SQL('a.created_by', 'a.visibility')}
           ORDER BY (a.created_by = ?) DESC, a.updated_at DESC LIMIT 5000`,
        )
        .bind(user.id, user.id)
        .all<Row>();
      const seen = new Set<string>();
      const list: AbbrEntry[] = [];
      for (const r of results) {
        const e = out(r, user);
        if (seen.has(e.abbr)) continue;
        seen.add(e.abbr);
        list.push(e);
      }
      return json(list);
    }
    if (method === 'POST') {
      const r = await readRecord(req, 'entry', normalizeAbbr);
      if (r instanceof Response) return r;
      const { record: e, replaces } = r;
      if (!ABBR_ID.test(e.id)) return error(400, 'bad_id');
      const other = await holder(db, user.id, e.abbr, e.id, replaces);
      if (other) return taken(other);
      const now = Date.now();
      try {
        await db.batch([
          ...(replaces ? [dropReplaced(db, user.id, replaces, now)] : []),
          db
            .prepare('INSERT INTO abbreviations (id, abbr, data, created_by, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(e.id, e.abbr, dataOf(e), user.id, r.visibility ?? user.prefs.abbrs, now, now),
        ]);
      } catch (err) {
        if (isAbbrClash(err)) {
          const winner = await holder(db, user.id, e.abbr, e.id, replaces);
          if (winner) return taken(winner);
        }
        return error(409, 'exists');
      }
      const row = await db.prepare(`SELECT ${COLS} ${FROM} WHERE a.id = ?`).bind(e.id).first<Row>();
      return json(out(row!, user), 201);
    }
    return error(405, 'method_not_allowed');
  }

  const m = /^\/api\/abbrs\/([^/]+)$/.exec(path);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  if (!ABBR_ID.test(id)) return error(400, 'bad_id');
  const cur = await accessRow(db, id);
  const visible = cur && canRead(user, cur.created_by, cur.visibility);
  const access = visible ? accessOf(user, cur.created_by, cur.visibility) : null;

  if (method === 'PUT') {
    const r = await readRecord(req, 'entry', normalizeAbbr, id);
    if (r instanceof Response) return r;
    if (!cur || !access) return error(404, 'not_found');
    if (!access.canEdit) return forbidden();
    const visibility = r.visibility && r.visibility !== cur.visibility ? r.visibility : null;
    if (visibility && !access.canManage) return forbidden();
    const { record: e, replaces } = r;
    const owner = cur.created_by;
    const other = await holder(db, owner, e.abbr, id, replaces);
    if (other) return taken(other);
    const now = Date.now();
    let changes: number;
    try {
      const res = await db.batch([
        ...(replaces ? [dropReplaced(db, owner, replaces, now, id)] : []),
        db
          .prepare('UPDATE abbreviations SET abbr = ?, data = ?, visibility = COALESCE(?, visibility), updated_at = ? WHERE id = ? AND deleted_at IS NULL')
          .bind(e.abbr, dataOf(e), visibility, now, id),
      ]);
      changes = res[res.length - 1].meta.changes;
    } catch (err) {
      const winner = isAbbrClash(err) ? await holder(db, owner, e.abbr, id, replaces) : null;
      if (winner) return taken(winner);
      throw err;
    }
    if (!changes) return error(404, 'not_found');
    const row = await db.prepare(`SELECT ${COLS} ${FROM} WHERE a.id = ?`).bind(id).first<Row>();
    return json(out(row!, user));
  }
  if (method === 'DELETE') {
    if (!access) return new Response(null, { status: 204 });
    if (!access.canManage && !(access.canEdit && cur?.created_by === null)) return forbidden();
    await db.prepare('UPDATE abbreviations SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(Date.now(), id).run();
    return new Response(null, { status: 204 });
  }
  return error(405, 'method_not_allowed');
}
