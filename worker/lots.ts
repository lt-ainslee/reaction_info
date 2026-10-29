// Reagent lot library: /api/lots, /api/lots/:id
//   GET    /api/lots[?key=]   list (optionally for one compound), with attachment counts
//   POST   /api/lots          create ({ lot }; a client-chosen id is kept)
//   PUT    /api/lots/:id      replace ({ lot })
//   DELETE /api/lots/:id      soft delete
import { normalizeLot, type ReagentLot } from '../src/chem/lots';
import { error, json, readRecord, userOf, type Env } from './http';

const LOT_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface LotRow {
  id: string;
  data: string;
  created_at: number;
  updated_at: number;
  n?: number;
}

const outLot = (r: LotRow): ReagentLot => ({
  ...(JSON.parse(r.data) as ReagentLot),
  id: r.id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  attachments: r.n ?? 0,
});

const search = (l: ReagentLot) =>
  [l.name, l.cas, l.supplier, l.catalogNumber, l.lotNumber, l.spec, l.location, l.note].filter(Boolean).join(' ').toLowerCase();

export const lotExists = async (db: D1Database, id: string) =>
  !!(await db.prepare('SELECT 1 FROM reagent_lots WHERE id = ? AND deleted_at IS NULL').bind(id).first());

const SELECT = `SELECT l.id, l.data, l.created_at, l.updated_at,
  (SELECT COUNT(*) FROM attachments a WHERE a.reaction_id = 'lot:' || l.id AND a.deleted_at IS NULL AND a.r2_key != '') AS n
  FROM reagent_lots l`;

async function readLot(req: Request, id?: string): Promise<ReagentLot | Response> {
  const r = await readRecord(req, 'lot', normalizeLot, id);
  return r instanceof Response ? r : r.record;
}

export async function handleLots(req: Request, env: Env, path: string): Promise<Response | null> {
  const db = env.DB;
  const method = req.method;

  if (path === '/api/lots') {
    if (method === 'GET') {
      const key = new URL(req.url).searchParams.get('key');
      const stmt = key
        ? db.prepare(`${SELECT} WHERE l.deleted_at IS NULL AND l.compound_key = ? ORDER BY l.updated_at DESC LIMIT 200`).bind(key)
        : db.prepare(`${SELECT} WHERE l.deleted_at IS NULL ORDER BY l.updated_at DESC LIMIT 2000`);
      const { results } = await stmt.all<LotRow>();
      return json(results.map(outLot));
    }
    if (method === 'POST') {
      const lot = await readLot(req);
      if (lot instanceof Response) return lot;
      if (!LOT_ID.test(lot.id)) return error(400, 'bad_id');
      const now = Date.now();
      const { id: _i, createdAt: _c, updatedAt: _u, attachments: _a, ...data } = lot;
      try {
        await db
          .prepare(`INSERT INTO reagent_lots (id, compound_key, data, search_text, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(lot.id, lot.key, JSON.stringify(data), search(lot), userOf(req), now, now)
          .run();
      } catch {
        return error(409, 'exists');
      }
      return json({ ...lot, createdAt: now, updatedAt: now, attachments: 0 }, 201);
    }
    return error(405, 'method_not_allowed');
  }

  const m = /^\/api\/lots\/([^/]+)$/.exec(path);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  if (!LOT_ID.test(id)) return error(400, 'bad_id');
  if (method === 'GET') {
    const row = await db.prepare(`${SELECT} WHERE l.id = ? AND l.deleted_at IS NULL`).bind(id).first<LotRow>();
    return row ? json(outLot(row)) : error(404, 'not_found');
  }
  if (method === 'PUT') {
    const lot = await readLot(req, id);
    if (lot instanceof Response) return lot;
    const now = Date.now();
    const { id: _i, createdAt: _c, updatedAt: _u, attachments: _a, ...data } = lot;
    const res = await db
      .prepare('UPDATE reagent_lots SET compound_key = ?, data = ?, search_text = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .bind(lot.key, JSON.stringify(data), search(lot), now, id)
      .run();
    if (!res.meta.changes) return error(404, 'not_found');
    const row = await db.prepare(`${SELECT} WHERE l.id = ?`).bind(id).first<LotRow>();
    return json(outLot(row!));
  }
  if (method === 'DELETE') {
    // Soft delete; the lot's files stay (other records may still point at them).
    await db.prepare('UPDATE reagent_lots SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(Date.now(), id).run();
    return new Response(null, { status: 204 });
  }
  return error(405, 'method_not_allowed');
}

