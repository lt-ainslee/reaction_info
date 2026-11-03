// Accounts and sign-in.
//
//   GET    /api/auth/me              { user, prefs } or 401 { needsSetup, signup }
//   POST   /api/auth/setup           first account (becomes admin); only while there are no users
//   POST   /api/auth/register        { username, password, name? } (when sign-up is open)
//   POST   /api/auth/login           { username, password }
//   POST   /api/auth/logout
//   PUT    /api/auth/password        { current, password }
//   PUT    /api/auth/profile         { name?, prefs? }   default visibility of new records
//   GET    /api/admin/users          admin: accounts and settings
//   POST   /api/admin/users          admin: create an account { username, password, name?, role? }
//   PATCH  /api/admin/users/:id      admin: { role?, disabled?, password?, name? }
//   PUT    /api/admin/settings       admin: { signup: 'open' | 'closed' }
//
// Passwords: PBKDF2-SHA256. Sessions: a random token in an HttpOnly cookie;
// the database keeps only its SHA-256.
import { normalizePrefs, type AccessUser, type UserPrefs } from '../src/storage/access';
import { error, json, type Env } from './http';

export interface User extends AccessUser {
  username: string;
  name: string;
  prefs: UserPrefs;
}

interface UserRow {
  id: string;
  username: string;
  name: string;
  pw: string;
  role: string;
  prefs: string;
  disabled: number;
  created_at: number;
  last_login: number | null;
}

const COOKIE = 'ri_session';
const SESSION_DAYS = 30;
const ITERATIONS = 100_000; // the most Workers allow for PBKDF2
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const MIN_PASSWORD = 6;

const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !salt || !hash) return false;
  const got = new Uint8Array(await pbkdf2(password, unb64(salt), Number(iter)));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

const toUser = (r: UserRow): User => {
  let prefs: unknown = {};
  try {
    prefs = JSON.parse(r.prefs || '{}');
  } catch {
    /* defaults */
  }
  return { id: r.id, username: r.username, name: r.name || r.username, role: r.role === 'admin' ? 'admin' : 'member', prefs: normalizePrefs(prefs) };
};

const publicUser = (u: User) => ({ id: u.id, username: u.username, name: u.name, role: u.role, prefs: u.prefs });

function cookieOf(req: Request, name: string): string | null {
  for (const part of (req.headers.get('Cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function sessionCookie(req: Request, token: string, maxAge: number) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** The signed-in user, or null. */
export async function currentUser(req: Request, env: Env): Promise<User | null> {
  const token = cookieOf(req, COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`,
  )
    .bind(await sha256(token), Date.now())
    .first<UserRow>();
  return row ? toUser(row) : null;
}

async function startSession(req: Request, env: Env, user: User, status = 200) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(
      await sha256(token),
      user.id,
      now,
      now + SESSION_DAYS * 86400_000,
    ),
    env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now, user.id),
    // Housekeeping: expired sessions.
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
  ]);
  return json({ user: publicUser(user) }, status, { 'Set-Cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
}

const userCount = async (db: D1Database) => (await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())?.n ?? 0;

export async function signupPolicy(db: D1Database): Promise<'open' | 'closed'> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'signup'`).first<{ value: string }>();
  return row?.value === 'closed' ? 'closed' : 'open';
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return typeof b === 'object' && b ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Validate a new account's fields; returns an error response or the values. */
function accountFields(b: Record<string, unknown> | null): Response | { username: string; password: string; name: string } {
  const username = typeof b?.username === 'string' ? b.username.trim().toLowerCase() : '';
  const password = typeof b?.password === 'string' ? b.password : '';
  const name = typeof b?.name === 'string' ? b.name.trim().slice(0, 40) : '';
  if (!USERNAME.test(username)) return error(422, 'bad_username');
  if (password.length < MIN_PASSWORD || password.length > 200) return error(422, 'weak_password', { min: MIN_PASSWORD });
  return { username, password, name };
}

async function createUser(db: D1Database, f: { username: string; password: string; name: string }, role: 'admin' | 'member'): Promise<User | Response> {
  const id = crypto.randomUUID();
  try {
    await db
      .prepare('INSERT INTO users (id, username, name, pw, role, prefs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, f.username, f.name, await hashPassword(f.password), role, '{}', Date.now())
      .run();
  } catch {
    return error(409, 'username_taken');
  }
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  return toUser(row!);
}

/** /api/auth/*; null for other paths. */
export async function handleAuth(req: Request, env: Env, path: string): Promise<Response | null> {
  if (!path.startsWith('/api/auth/')) return null;
  const db = env.DB;
  const what = path.slice('/api/auth/'.length);
  const method = req.method;

  if (what === 'me' && method === 'GET') {
    const user = await currentUser(req, env);
    if (user) return json({ user: publicUser(user) });
    return error(401, 'unauthorized', { needsSetup: (await userCount(db)) === 0, signup: await signupPolicy(db) });
  }

  if (what === 'setup' && method === 'POST') {
    if ((await userCount(db)) > 0) return error(409, 'already_set_up');
    const f = accountFields(await readBody(req));
    if (f instanceof Response) return f;
    const user = await createUser(db, f, 'admin');
    return user instanceof Response ? user : startSession(req, env, user, 201);
  }

  if (what === 'register' && method === 'POST') {
    if ((await userCount(db)) === 0) return error(409, 'needs_setup');
    if ((await signupPolicy(db)) === 'closed') return error(403, 'signup_closed');
    const f = accountFields(await readBody(req));
    if (f instanceof Response) return f;
    const user = await createUser(db, f, 'member');
    return user instanceof Response ? user : startSession(req, env, user, 201);
  }

  if (what === 'login' && method === 'POST') {
    const b = await readBody(req);
    const username = typeof b?.username === 'string' ? b.username.trim().toLowerCase() : '';
    const password = typeof b?.password === 'string' ? b.password : '';
    const row = username ? await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<UserRow>() : null;
    // Same work and answer whether or not the account exists.
    const ok = row ? await checkPassword(password, row.pw) : (await hashPassword(password), false);
    if (!row || !ok) return error(401, 'bad_credentials');
    if (row.disabled) return error(403, 'account_disabled');
    return startSession(req, env, toUser(row));
  }

  if (what === 'logout' && method === 'POST') {
    const token = cookieOf(req, COOKIE);
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return new Response(null, { status: 204, headers: { 'Set-Cookie': sessionCookie(req, '', 0) } });
  }

  const user = await currentUser(req, env);
  if (!user) return error(401, 'unauthorized');

  if (what === 'password' && method === 'PUT') {
    const b = await readBody(req);
    const row = await db.prepare('SELECT pw FROM users WHERE id = ?').bind(user.id).first<{ pw: string }>();
    if (!row || !(await checkPassword(typeof b?.current === 'string' ? b.current : '', row.pw))) return error(403, 'bad_credentials');
    const password = typeof b?.password === 'string' ? b.password : '';
    if (password.length < MIN_PASSWORD || password.length > 200) return error(422, 'weak_password', { min: MIN_PASSWORD });
    // Sign out everywhere else.
    const token = cookieOf(req, COOKIE) ?? '';
    await db.batch([
      db.prepare('UPDATE users SET pw = ? WHERE id = ?').bind(await hashPassword(password), user.id),
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, await sha256(token)),
    ]);
    return new Response(null, { status: 204 });
  }

  if (what === 'profile' && method === 'PUT') {
    const b = await readBody(req);
    const name = typeof b?.name === 'string' ? b.name.trim().slice(0, 40) : user.name;
    const prefs = b?.prefs !== undefined ? normalizePrefs({ ...user.prefs, ...(b.prefs as object) }) : user.prefs;
    await db.prepare('UPDATE users SET name = ?, prefs = ? WHERE id = ?').bind(name, JSON.stringify(prefs), user.id).run();
    return json({ user: publicUser({ ...user, name: name || user.username, prefs }) });
  }

  return error(404, 'no_route');
}

/** /api/admin/*; null for other paths. `user` is signed in. */
export async function handleAdmin(req: Request, env: Env, path: string, user: User): Promise<Response | null> {
  if (!path.startsWith('/api/admin/')) return null;
  if (user.role !== 'admin') return error(403, 'forbidden');
  const db = env.DB;
  const method = req.method;

  if (path === '/api/admin/users' && method === 'GET') {
    const { results } = await db
      .prepare(
        `SELECT u.id, u.username, u.name, u.role, u.disabled, u.created_at, u.last_login,
          (SELECT COUNT(*) FROM reactions r WHERE r.owner = u.id AND r.deleted_at IS NULL) AS reactions
         FROM users u ORDER BY u.created_at`,
      )
      .all<Omit<UserRow, 'pw' | 'prefs'> & { reactions: number }>();
    return json({
      users: results.map((r) => ({
        id: r.id, username: r.username, name: r.name, role: r.role, disabled: !!r.disabled, createdAt: r.created_at, lastLogin: r.last_login ?? undefined, reactions: r.reactions,
      })),
      signup: await signupPolicy(db),
    });
  }

  if (path === '/api/admin/users' && method === 'POST') {
    const b = await readBody(req);
    const f = accountFields(b);
    if (f instanceof Response) return f;
    const created = await createUser(db, f, b?.role === 'admin' ? 'admin' : 'member');
    return created instanceof Response ? created : json({ user: publicUser(created) }, 201);
  }

  const m = /^\/api\/admin\/users\/([^/]+)$/.exec(path);
  if (m && method === 'PATCH') {
    const id = decodeURIComponent(m[1]);
    const b = await readBody(req);
    if (!b) return error(400, 'bad_json');
    const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
    if (!row) return error(404, 'not_found');
    // Never leave the site without an active admin.
    const demote = (b.role === 'member' || b.disabled === true) && row.role === 'admin';
    if (demote) {
      const admins = await db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0`).first<{ n: number }>();
      if ((admins?.n ?? 0) <= 1) return error(409, 'last_admin');
    }
    const stmts: D1PreparedStatement[] = [];
    if (b.role === 'admin' || b.role === 'member') stmts.push(db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(b.role, id));
    if (typeof b.name === 'string') stmts.push(db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(b.name.trim().slice(0, 40), id));
    if (typeof b.disabled === 'boolean') {
      stmts.push(db.prepare('UPDATE users SET disabled = ? WHERE id = ?').bind(b.disabled ? 1 : 0, id));
      if (b.disabled) stmts.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
    }
    if (typeof b.password === 'string') {
      if (b.password.length < MIN_PASSWORD || b.password.length > 200) return error(422, 'weak_password', { min: MIN_PASSWORD });
      stmts.push(db.prepare('UPDATE users SET pw = ? WHERE id = ?').bind(await hashPassword(b.password), id));
      stmts.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
    }
    if (stmts.length) await db.batch(stmts);
    return new Response(null, { status: 204 });
  }

  if (path === '/api/admin/settings' && method === 'PUT') {
    const b = await readBody(req);
    if (b?.signup !== 'open' && b?.signup !== 'closed') return error(422, 'bad_settings');
    await db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('signup', ?)`).bind(b.signup).run();
    return new Response(null, { status: 204 });
  }

  return error(404, 'no_route');
}
