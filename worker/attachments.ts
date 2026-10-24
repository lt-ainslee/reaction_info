// Attachments (spectra, MNova files, PDFs, images…): bytes in R2, index in D1.
//
//   GET    /api/reactions/:rid/attachments        list
//   POST   /api/reactions/:rid/attachments        upload; body = file bytes,
//                                                 header X-Attachment = encodeURIComponent(JSON meta)
//   GET    /api/attachments/:id/file              download (inline for PDF / images)
//   PUT    /api/attachments/:id/preview           upload a PNG thumbnail
//   GET    /api/attachments/:id/preview           thumbnail
//   PATCH  /api/attachments/:id                   edit note / compound / kind / meta
//   DELETE /api/attachments/:id                   delete (row soft-deleted, R2 objects and links removed)
//
// Attachments belong to an owner: a reaction, or a reagent lot (its identity
// spectra, shared by every reaction using the bottle). The same routes exist
// under /api/lots/:lid/…; the owner key stored in reaction_id is then "lot:<lid>".
//
// Graph (nodes = attachments, plus links):
//   GET    /api/reactions/:rid/graph              { nodes, links }
//   POST   /api/reactions/:rid/nodes              file-less node (sample group, peak list)
//   POST   /api/reactions/:rid/links              { from, to, relation } — rejects cycles
//   DELETE /api/reactions/:rid/links?from=&to=
//   PUT    /api/reactions/:rid/positions          { positions: { id: [x, y] | null } }
import { lotExists } from './lots';
import { getRow } from './reactions';
import { error, ID_RE, json, userOf, type Env } from './http';

/** Request bodies above ~100 MB are rejected by Workers anyway. */
const MAX_FILE = 95 * 1024 * 1024;
const MAX_PREVIEW = 2 * 1024 * 1024;
const KINDS = ['nmr', 'mnova', 'jcamp', 'ms', 'hplc', 'ir', 'xrd', 'cif', 'pdf', 'image', 'text', 'sample', 'other'] as const;
const NODE_TYPES = ['sample', 'source', 'processed', 'export', 'peaklist', 'other'] as const;
const RELATIONS = ['contains', 'processed', 'export', 'peaklist', 'derived'] as const;
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly string[]).includes(v as string) ? (v as T) : null);
const INLINE = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/plain)$/;

interface AttRow {
  id: string;
  reaction_id: string;
  compound_id: string | null;
  kind: string;
  filename: string;
  size: number;
  sha256: string | null;
  content_type: string | null;
  r2_key: string;
  preview_key: string | null;
  meta: string;
  note: string;
  uploaded_by: string | null;
  created_at: number;
  node_type: string | null;
  label: string | null;
  pos_x: number | null;
  pos_y: number | null;
}

const COLS =
  'id, reaction_id, compound_id, kind, filename, size, sha256, content_type, r2_key, preview_key, meta, note, uploaded_by, created_at, node_type, label, pos_x, pos_y';

interface LinkRow {
  from_id: string;
  to_id: string;
  relation: string | null;
}

const out = (r: AttRow) => ({
  id: r.id,
  reactionId: r.reaction_id,
  compoundId: r.compound_id ?? undefined,
  kind: r.kind,
  filename: r.filename,
  size: r.size,
  sha256: r.sha256 ?? undefined,
  contentType: r.content_type ?? undefined,
  hasPreview: !!r.preview_key,
  meta: JSON.parse(r.meta || '{}') as Record<string, unknown>,
  note: r.note,
  uploadedBy: r.uploaded_by ?? undefined,
  createdAt: r.created_at,
  nodeType: r.node_type ?? undefined,
  label: r.label ?? undefined,
  hasFile: !!r.r2_key,
  pos: r.pos_x !== null && r.pos_y !== null ? [r.pos_x, r.pos_y] : undefined,
});

const linkOut = (l: LinkRow) => ({ from: l.from_id, to: l.to_id, relation: l.relation ?? undefined });

/** Node ids reachable downstream from `start` (for cycle checks). */
async function downstream(db: D1Database, rid: string, start: string): Promise<Set<string>> {
  const { results } = await db.prepare('SELECT from_id, to_id FROM attachment_links WHERE reaction_id = ?').bind(rid).all<LinkRow>();
  const next = new Map<string, string[]>();
  for (const l of results) next.set(l.from_id, [...(next.get(l.from_id) ?? []), l.to_id]);
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const n = stack.pop()!;
    for (const m of next.get(n) ?? []) if (!seen.has(m)) (seen.add(m), stack.push(m));
  }
  return seen;
}

/** Create links upstream → `to`; ids that are not live nodes of the reaction are ignored. */
async function linkParents(db: D1Database, rid: string, to: string, parents: unknown, relation: string | null) {
  if (!Array.isArray(parents)) return;
  const now = Date.now();
  for (const from of parents.slice(0, 20)) {
    if (typeof from !== 'string' || from === to) continue;
    const ok = await db.prepare('SELECT 1 FROM attachments WHERE id = ? AND reaction_id = ? AND deleted_at IS NULL').bind(from, rid).first();
    if (!ok) continue;
    await db
      .prepare('INSERT OR IGNORE INTO attachment_links (reaction_id, from_id, to_id, relation, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(rid, from, to, relation, now)
      .run();
  }
}

type OwnerKind = 'reactions' | 'lots';
const ownerKey = (kind: OwnerKind, id: string) => (kind === 'lots' ? `lot:${id}` : id);
const ownerExists = async (db: D1Database, kind: OwnerKind, id: string) =>
  kind === 'lots' ? /^[A-Za-z0-9_-]{1,64}$/.test(id) && lotExists(db, id) : !!(await getRow(db, id));

const getAtt = (db: D1Database, id: string) =>
  db.prepare(`SELECT ${COLS} FROM attachments WHERE id = ? AND deleted_at IS NULL`).bind(id).first<AttRow>();

/** Keep file names safe for R2 keys and Content-Disposition, but readable (Chinese is fine). */
const safeName = (s: string) => s.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').slice(0, 200) || 'file';

function disposition(filename: string, inline: boolean) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function parseMetaHeader(req: Request): Record<string, unknown> | null {
  const raw = req.headers.get('X-Attachment');
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw));
    return typeof v === 'object' && v ? v : null;
  } catch {
    return null;
  }
}

export async function handleAttachments(req: Request, env: Env, path: string): Promise<Response | null> {
  const db = env.DB;
  const method = req.method;

  const list = /^\/api\/(reactions|lots)\/([^/]+)\/attachments$/.exec(path);
  if (list) {
    const owner = list[1] as OwnerKind;
    const oid = decodeURIComponent(list[2]);
    const rid = ownerKey(owner, oid);
    if (method === 'GET') {
      const { results } = await db
        .prepare(`SELECT ${COLS} FROM attachments WHERE reaction_id = ? AND deleted_at IS NULL ORDER BY created_at`)
        .bind(rid)
        .all<AttRow>();
      return json(results.map(out));
    }
    if (method === 'POST') {
      if (!env.FILES) return error(503, 'files_not_configured');
      if (!(await ownerExists(db, owner, oid))) return error(404, 'owner_not_found');
      const meta = parseMetaHeader(req);
      if (!meta || typeof meta.filename !== 'string') return error(400, 'bad_meta');
      const size = Number(req.headers.get('Content-Length'));
      if (!Number.isFinite(size) || size <= 0) return error(411, 'length_required');
      if (size > MAX_FILE) return error(413, 'too_large', { max: MAX_FILE });
      if (!req.body) return error(400, 'empty');

      const id = crypto.randomUUID();
      const filename = safeName(meta.filename);
      const kind = (KINDS as readonly string[]).includes(meta.kind as string) ? (meta.kind as string) : 'other';
      const sha256 = typeof meta.sha256 === 'string' && /^[0-9a-f]{64}$/.test(meta.sha256) ? meta.sha256 : null;
      const contentType = req.headers.get('Content-Type') || 'application/octet-stream';
      const key = `${owner}/${oid}/${id}/${filename}`;
      try {
        // Streamed straight into R2; with sha256 given, R2 rejects a corrupted upload.
        await env.FILES.put(key, req.body, {
          httpMetadata: { contentType },
          customMetadata: { owner: rid, filename },
          ...(sha256 ? { sha256 } : {}),
        });
      } catch (e) {
        console.error(e);
        return error(422, 'upload_failed');
      }
      const now = Date.now();
      const compound = typeof meta.compoundId === 'string' ? meta.compoundId : null;
      const extra = JSON.stringify(typeof meta.meta === 'object' && meta.meta ? meta.meta : {}).slice(0, 8000);
      const note = typeof meta.note === 'string' ? meta.note.slice(0, 2000) : '';
      const nodeType = oneOf(NODE_TYPES, meta.nodeType);
      await db
        .prepare(
          `INSERT INTO attachments (id, reaction_id, compound_id, kind, filename, size, sha256, content_type, r2_key, meta, note, uploaded_by, created_at, node_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, rid, compound, kind, filename, size, sha256, contentType, key, extra, note, userOf(req), now, nodeType)
        .run();
      await linkParents(db, rid, id, meta.parentIds, oneOf(RELATIONS, meta.relation));
      return json(out((await getAtt(db, id))!), 201);
    }
    return error(405, 'method_not_allowed');
  }

  const graph = /^\/api\/(reactions|lots)\/([^/]+)\/(graph|nodes|links|positions)$/.exec(path);
  if (graph) return handleGraph(req, env, graph[1] as OwnerKind, decodeURIComponent(graph[2]), graph[3]);

  const one = /^\/api\/attachments\/([^/]+)(\/file|\/preview)?$/.exec(path);
  if (!one) return null;
  const id = decodeURIComponent(one[1]);
  if (!ID_RE.test(id)) return error(400, 'bad_id');
  const sub = one[2];
  const row = await getAtt(db, id);
  if (!row) return error(404, 'not_found');

  if (sub === '/file' && method === 'GET') {
    const obj = row.r2_key ? await env.FILES?.get(row.r2_key) : null;
    if (!obj) return error(404, 'file_missing');
    const type = row.content_type || 'application/octet-stream';
    return new Response(obj.body, {
      headers: {
        'Content-Type': type,
        'Content-Length': String(obj.size),
        'Content-Disposition': disposition(row.filename, INLINE.test(type) && new URL(req.url).searchParams.get('download') === null),
        'Cache-Control': 'private, max-age=3600',
        ETag: obj.httpEtag,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (sub === '/preview') {
    const key = `${row.r2_key}.preview.png`;
    if (method === 'PUT') {
      const size = Number(req.headers.get('Content-Length'));
      if (!size || size > MAX_PREVIEW) return error(413, 'too_large');
      if (!req.body) return error(400, 'empty');
      await env.FILES.put(key, req.body, { httpMetadata: { contentType: 'image/png' } });
      await db.prepare('UPDATE attachments SET preview_key = ? WHERE id = ?').bind(key, id).run();
      return new Response(null, { status: 204 });
    }
    if (method === 'GET') {
      const obj = row.preview_key ? await env.FILES?.get(row.preview_key) : null;
      if (!obj) return error(404, 'no_preview');
      return new Response(obj.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' } });
    }
    return error(405, 'method_not_allowed');
  }

  if (sub) return error(405, 'method_not_allowed');

  if (method === 'GET') return json(out(row));

  if (method === 'PATCH') {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return error(400, 'bad_json');
    }
    const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : row.note;
    const compound = body.compoundId === null ? null : typeof body.compoundId === 'string' ? body.compoundId : row.compound_id;
    const kind = (KINDS as readonly string[]).includes(body.kind as string) ? (body.kind as string) : row.kind;
    const meta =
      typeof body.meta === 'object' && body.meta ? JSON.stringify({ ...JSON.parse(row.meta || '{}'), ...body.meta }).slice(0, 20000) : row.meta;
    const nodeType = body.nodeType === undefined ? row.node_type : oneOf(NODE_TYPES, body.nodeType);
    const label = typeof body.label === 'string' ? body.label.slice(0, 200) : row.label;
    await db
      .prepare('UPDATE attachments SET note = ?, compound_id = ?, kind = ?, meta = ?, node_type = ?, label = ? WHERE id = ?')
      .bind(note, compound, kind, meta, nodeType, label, id)
      .run();
    return json(out((await getAtt(db, id))!));
  }

  if (method === 'DELETE') {
    await db.batch([
      db.prepare('UPDATE attachments SET deleted_at = ? WHERE id = ?').bind(Date.now(), id),
      // Downstream nodes stay; they just lose this upstream link.
      db.prepare('DELETE FROM attachment_links WHERE from_id = ? OR to_id = ?').bind(id, id),
    ]);
    // Free the storage; the D1 row is kept as a record of what existed.
    const keys = [row.r2_key, row.preview_key].filter((k): k is string => !!k);
    if (keys.length) await env.FILES?.delete(keys);
    return new Response(null, { status: 204 });
  }

  return error(405, 'method_not_allowed');
}

async function handleGraph(req: Request, env: Env, kind: OwnerKind, oid: string, what: string): Promise<Response> {
  const db = env.DB;
  const rid = ownerKey(kind, oid);
  const method = req.method;
  const readBody = async () => {
    try {
      return (await req.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  if (what === 'graph' && method === 'GET') {
    const [nodes, links] = await db.batch([
      db.prepare(`SELECT ${COLS} FROM attachments WHERE reaction_id = ? AND deleted_at IS NULL ORDER BY created_at`).bind(rid),
      db.prepare('SELECT from_id, to_id, relation FROM attachment_links WHERE reaction_id = ?').bind(rid),
    ]);
    return json({ nodes: (nodes.results as AttRow[]).map(out), links: (links.results as LinkRow[]).map(linkOut) });
  }

  if (!(await ownerExists(db, kind, oid))) return error(404, 'owner_not_found');

  if (what === 'nodes' && method === 'POST') {
    const body = await readBody();
    const nodeType = oneOf(['sample', 'peaklist'] as const, body?.nodeType);
    if (!body || !nodeType) return error(400, 'bad_node');
    const id = crypto.randomUUID();
    const label = typeof body.label === 'string' ? body.label.slice(0, 200) : '';
    const meta = JSON.stringify(typeof body.meta === 'object' && body.meta ? body.meta : {}).slice(0, 20000);
    const compound = typeof body.compoundId === 'string' ? body.compoundId : null;
    await db
      .prepare(
        `INSERT INTO attachments (id, reaction_id, compound_id, kind, filename, size, r2_key, meta, note, uploaded_by, created_at, node_type, label)
         VALUES (?, ?, ?, ?, ?, 0, '', ?, '', ?, ?, ?, ?)`,
      )
      .bind(id, rid, compound, nodeType === 'sample' ? 'sample' : 'text', label || nodeType, meta, userOf(req), Date.now(), nodeType, label)
      .run();
    await linkParents(db, rid, id, body.parentIds, nodeType === 'peaklist' ? 'peaklist' : null);
    return json(out((await getAtt(db, id))!), 201);
  }

  if (what === 'links' && method === 'POST') {
    const body = await readBody();
    const from = body?.from;
    const to = body?.to;
    if (typeof from !== 'string' || typeof to !== 'string' || from === to) return error(400, 'bad_link');
    const both = await db
      .prepare('SELECT COUNT(*) AS n FROM attachments WHERE id IN (?, ?) AND reaction_id = ? AND deleted_at IS NULL')
      .bind(from, to, rid)
      .first<{ n: number }>();
    if (both?.n !== 2) return error(404, 'node_not_found');
    if ((await downstream(db, rid, to)).has(from)) return error(409, 'cycle');
    await db
      .prepare('INSERT OR REPLACE INTO attachment_links (reaction_id, from_id, to_id, relation, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(rid, from, to, oneOf(RELATIONS, body?.relation), Date.now())
      .run();
    return json({ from, to, relation: oneOf(RELATIONS, body?.relation) ?? undefined }, 201);
  }

  if (what === 'links' && method === 'DELETE') {
    const q = new URL(req.url).searchParams;
    await db.prepare('DELETE FROM attachment_links WHERE reaction_id = ? AND from_id = ? AND to_id = ?').bind(rid, q.get('from'), q.get('to')).run();
    return new Response(null, { status: 204 });
  }

  if (what === 'positions' && method === 'PUT') {
    const body = await readBody();
    const positions = body?.positions;
    if (typeof positions !== 'object' || !positions) return error(400, 'bad_positions');
    const stmts = Object.entries(positions as Record<string, unknown>)
      .slice(0, 500)
      .map(([id, p]) => {
        const xy = Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)) ? (p as number[]) : null;
        return db.prepare('UPDATE attachments SET pos_x = ?, pos_y = ? WHERE id = ? AND reaction_id = ?').bind(xy?.[0] ?? null, xy?.[1] ?? null, id, rid);
      });
    if (stmts.length) await db.batch(stmts);
    return new Response(null, { status: 204 });
  }

  return error(405, 'method_not_allowed');
}
