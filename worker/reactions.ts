// Saved reactions: /api/reactions, /api/reactions/:id
import type { Reaction } from '../src/chem/stoich';
import { normalizeReaction } from '../src/storage/schema';
import { error, ID_RE, json, userOf, type Env } from './http';

const MAX_BODY = 512 * 1024;

interface Row {
  id: string;
  title: string;
  data: string;
  owner: string | null;
  version: number;
  updated_at: number;
}

const summary = (r: Row) => ({ id: r.id, title: r.title, updatedAt: r.updated_at, version: r.version, owner: r.owner ?? undefined });
const full = (r: Row) => ({ ...summary(r), reaction: JSON.parse(r.data) as Reaction });

/** Text the list search matches against: title, names, CAS, formulas, SMILES. */
function searchText(r: Reaction) {
  const parts = [r.title, r.operator, r.notebook, r.conditions];
  for (const c of r.components) parts.push(c.name, c.cas, c.formula, c.smiles);
  return parts.filter(Boolean).join(' ').toLowerCase();
}

async function readReaction(req: Request): Promise<{ reaction: Reaction; body: Record<string, unknown> } | Response> {
  const text = await req.text();
  if (text.length > MAX_BODY) return error(413, 'too_large');
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return error(400, 'bad_json');
  }
  const reaction = normalizeReaction(body?.reaction);
  if (!reaction) return error(422, 'invalid_reaction');
  return { reaction, body };
}

export async function getRow(db: D1Database, id: string, withDeleted = false) {
  const sql = `SELECT id, title, data, owner, version, updated_at FROM reactions WHERE id = ?${withDeleted ? '' : ' AND deleted_at IS NULL'}`;
  return db.prepare(sql).bind(id).first<Row>();
}

/** /api/reactions and /api/reactions/:id; returns null for other paths. */
export async function handleReactions(req: Request, env: Env, path: string): Promise<Response | null> {
  const db = env.DB;
  const method = req.method;

  if (path === '/api/reactions') {
    if (method === 'GET') {
      const q = new URL(req.url).searchParams.get('q')?.trim().toLowerCase();
      const stmt = q
        ? db
            .prepare(
              `SELECT id, title, owner, version, updated_at FROM reactions
               WHERE deleted_at IS NULL AND search_text LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 500`,
            )
            .bind(`%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`)
        : db.prepare('SELECT id, title, owner, version, updated_at FROM reactions WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500');
      const { results } = await stmt.all<Row>();
      return json(results.map(summary));
    }
    if (method === 'POST') {
      const parsed = await readReaction(req);
      if (parsed instanceof Response) return parsed;
      const { reaction, body } = parsed;
      // A client-chosen id is allowed (uploading reactions saved in a browser keeps their ids).
      const id = typeof body.id === 'string' ? body.id : crypto.randomUUID();
      if (!ID_RE.test(id)) return error(400, 'bad_id');
      const now = Date.now();
      const data = JSON.stringify(reaction);
      const user = userOf(req);
      try {
        await db.batch([
          db
            .prepare(
              `INSERT INTO reactions (id, title, data, search_text, owner, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
            )
            .bind(id, reaction.title, data, searchText(reaction), user, now, now),
          db.prepare('INSERT INTO reaction_versions (reaction_id, version, data, saved_by, saved_at) VALUES (?, 1, ?, ?, ?)').bind(id, data, user, now),
        ]);
      } catch {
        const existing = await getRow(db, id, true);
        if (existing) return error(409, 'exists', { current: summary(existing) });
        throw new Error('insert failed');
      }
      return json(full({ id, title: reaction.title, data, owner: user, version: 1, updated_at: now }), 201);
    }
    return error(405, 'method_not_allowed');
  }

  const m = /^\/api\/reactions\/([^/]+)$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === 'GET') {
      const row = await getRow(db, id);
      return row ? json(full(row)) : error(404, 'not_found');
    }
    if (method === 'PUT') {
      const parsed = await readReaction(req);
      if (parsed instanceof Response) return parsed;
      const { reaction, body } = parsed;
      const base = Number(body.baseVersion);
      if (!Number.isInteger(base)) return error(400, 'bad_base_version');
      const now = Date.now();
      const data = JSON.stringify(reaction);
      const user = userOf(req);
      // Compare-and-swap on version: only one concurrent writer wins.
      const res = await db
        .prepare(
          `UPDATE reactions SET title = ?, data = ?, search_text = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ? AND deleted_at IS NULL`,
        )
        .bind(reaction.title, data, searchText(reaction), now, id, base)
        .run();
      if (!res.meta.changes) {
        const cur = await getRow(db, id);
        return cur ? error(409, 'conflict', { current: full(cur) }) : error(404, 'not_found');
      }
      await db
        .prepare('INSERT OR REPLACE INTO reaction_versions (reaction_id, version, data, saved_by, saved_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, base + 1, data, user, now)
        .run();
      const row = await getRow(db, id);
      return json(full(row!));
    }
    if (method === 'DELETE') {
      // Soft delete: recoverable from the database if needed.
      await db.prepare('UPDATE reactions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(Date.now(), id).run();
      return new Response(null, { status: 204 });
    }
    return error(405, 'method_not_allowed');
  }

  return null;
}
