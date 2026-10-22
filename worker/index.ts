// API Worker: /api/* is handled here, everything else is served from the
// static assets (wrangler.toml: run_worker_first = ["/api/*"]).
import { handleAttachments } from './attachments';
import { error, json, type Env } from './http';
import { handleReactions } from './reactions';
import { ensureSchema, SCHEMA_VERSION } from './schema';

export type { Env };

export default {
  async fetch(req, env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      await ensureSchema(env.DB);
      if (path === '/api/health' && req.method === 'GET') {
        return json({ ok: true, storage: 'd1', schema: SCHEMA_VERSION, files: !!env.FILES });
      }
      return (await handleAttachments(req, env, path)) ?? (await handleReactions(req, env, path)) ?? error(404, 'no_route');
    } catch (e) {
      console.error(e);
      return error(500, 'server_error');
    }
  },
} satisfies ExportedHandler<Env>;
