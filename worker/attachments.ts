// Attachments (spectra, MNova files, PDFs, images…): bytes in R2, index in D1.
//
//   GET    /api/reactions/:rid/attachments        list
//   POST   /api/reactions/:rid/attachments        upload; body = file bytes,
//                                                 header X-Attachment = encodeURIComponent(JSON meta)
//   GET    /api/attachments/:id/file              download (inline for PDF / images)
//   PUT    /api/attachments/:id/preview           upload a PNG thumbnail
//   GET    /api/attachments/:id/preview           thumbnail
//   PATCH  /api/attachments/:id                   edit note / compound / kind / meta
//   DELETE /api/attachments/:id                   delete (row soft-deleted, R2 objects removed)
import { getRow } from './reactions';
import { error, ID_RE, json, userOf, type Env } from './http';

/** Request bodies above ~100 MB are rejected by Workers anyway. */
const MAX_FILE = 95 * 1024 * 1024;
const MAX_PREVIEW = 2 * 1024 * 1024;
const KINDS = ['nmr', 'mnova', 'jcamp', 'ms', 'hplc', 'ir', 'xrd', 'cif', 'pdf', 'image', 'other'] as const;
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
}

const COLS = 'id, reaction_id, compound_id, kind, filename, size, sha256, content_type, r2_key, preview_key, meta, note, uploaded_by, created_at';

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
});

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

  const list = /^\/api\/reactions\/([^/]+)\/attachments$/.exec(path);
  if (list) {
    const rid = decodeURIComponent(list[1]);
    if (method === 'GET') {
      const { results } = await db
        .prepare(`SELECT ${COLS} FROM attachments WHERE reaction_id = ? AND deleted_at IS NULL ORDER BY created_at`)
        .bind(rid)
        .all<AttRow>();
      return json(results.map(out));
    }
    if (method === 'POST') {
      if (!env.FILES) return error(503, 'files_not_configured');
      if (!(await getRow(db, rid))) return error(404, 'reaction_not_found');
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
      const key = `reactions/${rid}/${id}/${filename}`;
      try {
        // Streamed straight into R2; with sha256 given, R2 rejects a corrupted upload.
        await env.FILES.put(key, req.body, {
          httpMetadata: { contentType },
          customMetadata: { reaction: rid, filename },
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
      await db
        .prepare(
          `INSERT INTO attachments (id, reaction_id, compound_id, kind, filename, size, sha256, content_type, r2_key, meta, note, uploaded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, rid, compound, kind, filename, size, sha256, contentType, key, extra, note, userOf(req), now)
        .run();
      return json(out((await getAtt(db, id))!), 201);
    }
    return error(405, 'method_not_allowed');
  }

  const one = /^\/api\/attachments\/([^/]+)(\/file|\/preview)?$/.exec(path);
  if (!one) return null;
  const id = decodeURIComponent(one[1]);
  if (!ID_RE.test(id)) return error(400, 'bad_id');
  const sub = one[2];
  const row = await getAtt(db, id);
  if (!row) return error(404, 'not_found');

  if (sub === '/file' && method === 'GET') {
    const obj = await env.FILES?.get(row.r2_key);
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
      typeof body.meta === 'object' && body.meta ? JSON.stringify({ ...JSON.parse(row.meta || '{}'), ...body.meta }).slice(0, 8000) : row.meta;
    await db.prepare('UPDATE attachments SET note = ?, compound_id = ?, kind = ?, meta = ? WHERE id = ?').bind(note, compound, kind, meta, id).run();
    return json(out((await getAtt(db, id))!));
  }

  if (method === 'DELETE') {
    await db.prepare('UPDATE attachments SET deleted_at = ? WHERE id = ?').bind(Date.now(), id).run();
    // Free the storage; the D1 row is kept as a record of what existed.
    await env.FILES?.delete([row.r2_key, ...(row.preview_key ? [row.preview_key] : [])]);
    return new Response(null, { status: 204 });
  }

  return error(405, 'method_not_allowed');
}
