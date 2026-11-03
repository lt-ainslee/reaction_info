// Reagent lot library: /api/lots, /api/lots/:id
//   GET    /api/lots[?key=]   list (optionally for one compound), with attachment counts
//   POST   /api/lots          create ({ lot }; a client-chosen id is kept)
//   PUT    /api/lots/:id      replace ({ lot })
//   DELETE /api/lots/:id      soft delete
// Bodies may carry `visibility` (src/storage/access.ts); the creator owns the lot.
import { normalizeLot, type ReagentLot } from '../src/chem/lots';
import { accessOf, canRead, READABLE_SQL, type Visibility } from '../src/storage/access';
import type { User } from './auth';
import { error, forbidden, json, readRecord, type Env } from './http';

const LOT_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface LotRow {
  id: string;
  data: string;
  created_at: number;
  updated_at: number;
  created_by: string | null;
  visibility: string;
  owner_name: string | null;
  n?: number;
}

const outLot = (r: LotRow, user: User): ReagentLot => ({
  ...(JSON.parse(r.data) as ReagentLot),
  id: r.id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  attachments: r.n ?? 0,
  access: accessOf(user, r.created_by, r.visibility, r.owner_name),
});

const search = (l: ReagentLot) =>
  [l.name, l.cas, l.supplier, l.catalogNumber, l.lotNumber, l.spec, l.location, l.note].filter(Boolean).join(' ').toLowerCase();

/** The live lot's owner and visibility (for access checks), or null. */
export const lotAccessRow = (db: D1Database, id: string) =>
  db.prepare('SELECT created_by, visibility FROM reagent_lots WHERE id = ? AND deleted_at IS NULL').bind(id).first<{ created_by: string | null; visibility: string }>();

const SELECT = `SELECT l.id, l.data, l.created_at, l.updated_at, l.created_by, l.visibility, u.name AS owner_name,
  (SELECT COUNT(*) FROM attachments a WHERE a.reaction_id = 'lot:' || l.id AND a.deleted_at IS NULL AND a.r2_key != '') AS n
  FROM reagent_lots l LEFT JOIN users u ON u.id = l.created_by`;
const READABLE = READABLE_SQL('l.created_by', 'l.visibility');

async function readLot(req: Request, id?: string): Promise<{ lot: ReagentLot; visibility?: Visibility } | Response> {
  const r = await readRecord(req, 'lot', normalizeLot, id);
  return r instanceof Response ? r : { lot: r.record, visibility: r.visibility };
}

/** What is stored as data: not the id, times, counts or access (columns / computed). */
const dataOf = ({ id: _i, createdAt: _c, updatedAt: _u, attachments: _a, access: _x, ...data }: ReagentLot) => JSON.stringify(data);

export async function handleLots(req: Request, env: Env, path: string, user: User): Promise<Response | null> {
  const db = env.DB;
  const method = req.method;

  if (path === '/api/lots') {
    if (method === 'GET') {
      const key = new URL(req.url).searchParams.get('key');
      const stmt = key
        ? db.prepare(`${SELECT} WHERE l.deleted_at IS NULL AND ${READABLE} AND l.compound_key = ? ORDER BY l.updated_at DESC LIMIT 200`).bind(user.id, key)
        : db.prepare(`${SELECT} WHERE l.deleted_at IS NULL AND ${READABLE} ORDER BY l.updated_at DESC LIMIT 2000`).bind(user.id);
      const { results } = await stmt.all<LotRow>();
      return json(results.map((r) => outLot(r, user)));
    }
    if (method === 'POST') {
      const parsed = await readLot(req);
      if (parsed instanceof Response) return parsed;
      const { lot } = parsed;
      if (!LOT_ID.test(lot.id)) return error(400, 'bad_id');
      const now = Date.now();
      try {
        await db
          .prepare(
            `INSERT INTO reagent_lots (id, compound_key, data, search_text, created_by, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(lot.id, lot.key, dataOf(lot), search(lot), user.id, parsed.visibility ?? user.prefs.lots, now, now)
          .run();
      } catch {
        return error(409, 'exists');
      }
      const row = await db.prepare(`${SELECT} WHERE l.id = ?`).bind(lot.id).first<LotRow>();
      return json(outLot(row!, user), 201);
    }
    return error(405, 'method_not_allowed');
  }

  const m = /^\/api\/lots\/([^/]+)$/.exec(path);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  if (!LOT_ID.test(id)) return error(400, 'bad_id');
  const cur = await lotAccessRow(db, id);
  // Someone else's private lot does not exist for this user.
  if (!cur || !canRead(user, cur.created_by, cur.visibility)) return method === 'DELETE' ? new Response(null, { status: 204 }) : error(404, 'not_found');
  const access = accessOf(user, cur.created_by, cur.visibility);
  if (method === 'GET') {
    const row = await db.prepare(`${SELECT} WHERE l.id = ? AND l.deleted_at IS NULL`).bind(id).first<LotRow>();
    return row ? json(outLot(row, user)) : error(404, 'not_found');
  }
  if (method === 'PUT') {
    const parsed = await readLot(req, id);
    if (parsed instanceof Response) return parsed;
    const { lot } = parsed;
    if (!access.canEdit) return forbidden();
    // Only whoever manages the lot changes who sees it.
    const visibility = parsed.visibility && parsed.visibility !== cur.visibility ? parsed.visibility : null;
    if (visibility && !access.canManage) return forbidden();
    const now = Date.now();
    const res = await db
      .prepare(
        'UPDATE reagent_lots SET compound_key = ?, data = ?, search_text = ?, visibility = COALESCE(?, visibility), updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      )
      .bind(lot.key, dataOf(lot), search(lot), visibility, now, id)
      .run();
    if (!res.meta.changes) return error(404, 'not_found');
    const row = await db.prepare(`${SELECT} WHERE l.id = ?`).bind(id).first<LotRow>();
    return json(outLot(row!, user));
  }
  if (method === 'DELETE') {
    if (!access.canManage) return forbidden();
    // Soft delete; the lot's files stay (other records may still point at them).
    await db.prepare('UPDATE reagent_lots SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(Date.now(), id).run();
    return new Response(null, { status: 204 });
  }
  return error(405, 'method_not_allowed');
}

