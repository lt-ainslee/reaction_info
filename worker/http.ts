export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

export const error = (status: number, code: string, extra: Record<string, unknown> = {}) => json({ error: code, ...extra }, status);

/** Identity: set once Cloudflare Access is enabled (the JWT is verified there first). */
export const userOf = (_req: Request): string | null => null;

/**
 * The record in a request body `{ [field]: record, replaces? }`, validated with
 * the app's own rules. The id in the URL wins over the body's; a new record
 * without one gets a random id.
 */
export async function readRecord<T>(
  req: Request,
  field: string,
  normalize: (raw: unknown) => T | null,
  id?: string,
): Promise<{ record: T; replaces?: string } | Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return error(400, 'bad_json');
  }
  const raw = body?.[field] as Record<string, unknown> | undefined;
  const record = normalize(raw && { ...raw, id: id ?? raw.id ?? crypto.randomUUID() });
  if (!record) return error(422, `invalid_${field}`);
  return { record, ...(typeof body.replaces === 'string' ? { replaces: body.replaces } : {}) };
}

export const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
}
