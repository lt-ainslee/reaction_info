// API Worker: /api/* is handled here, everything else is served from the
// static assets (wrangler.toml: run_worker_first = ["/api/*"]).
// Every route but /api/health and /api/auth/* needs a signed-in user.
import { handleAbbrs } from './abbrs';
import { handleAttachments } from './attachments';
import { currentUser, handleAdmin, handleAuth } from './auth';
import { error, json, type Env } from './http';
import { handleLots } from './lots';
import { handleReactions } from './reactions';
import { ensureSchema, SCHEMA_VERSION } from './schema';

export type { Env };

/** Writes must come from this site (the session cookie is SameSite=Lax; this is a second check). */
function crossSite(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return false;
  const origin = req.headers.get('Origin');
  return !!origin && origin !== new URL(req.url).origin;
}

export default {
  async fetch(req, env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      await ensureSchema(env.DB);
      if (path === '/api/health' && req.method === 'GET') {
        return json({ ok: true, storage: 'd1', schema: SCHEMA_VERSION, files: !!env.FILES, auth: true });
      }
      if (crossSite(req)) return error(403, 'cross_site');
      const auth = await handleAuth(req, env, path);
      if (auth) return auth;
      const user = await currentUser(req, env);
      if (!user) return error(401, 'unauthorized');
      return (
        (await handleAdmin(req, env, path, user)) ??
        (await handleAttachments(req, env, path, user)) ??
        (await handleLots(req, env, path, user)) ??
        (await handleAbbrs(req, env, path, user)) ??
        (await handleReactions(req, env, path, user)) ??
        error(404, 'no_route')
      );
    } catch (e) {
      console.error(e);
      return error(500, 'server_error');
    }
  },
} satisfies ExportedHandler<Env>;
