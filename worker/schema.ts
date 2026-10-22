// Database schema, applied by the Worker itself (see ensureSchema): no
// separate migration step in the deploy pipeline, and production and
// preview databases are handled the same way.
//
// To change the schema, append a migration; never edit an applied one.
export const MIGRATIONS: { version: number; sql: string[] }[] = [
  {
    version: 1,
    sql: [
      `CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        data TEXT NOT NULL,
        search_text TEXT NOT NULL DEFAULT '',
        owner TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_reactions_live ON reactions (deleted_at, updated_at DESC)`,
      // Every saved version, for history / recovery.
      `CREATE TABLE IF NOT EXISTS reaction_versions (
        reaction_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        data TEXT NOT NULL,
        saved_by TEXT,
        saved_at INTEGER NOT NULL,
        PRIMARY KEY (reaction_id, version)
      )`,
    ],
  },
  {
    version: 2,
    sql: [
      // Files (spectra, MNova documents, PDFs, images…) live in R2; this is their index.
      `CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        reaction_id TEXT NOT NULL,
        compound_id TEXT,
        kind TEXT NOT NULL,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT,
        content_type TEXT,
        r2_key TEXT NOT NULL,
        preview_key TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        note TEXT NOT NULL DEFAULT '',
        uploaded_by TEXT,
        created_at INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_attachments_reaction ON attachments (reaction_id, deleted_at, created_at)`,
    ],
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

let applied: Promise<void> | null = null;

/** Bring the database up to SCHEMA_VERSION once per isolate. */
export function ensureSchema(db: D1Database): Promise<void> {
  applied ??= migrate(db).catch((e) => {
    applied = null; // retry on the next request
    throw e;
  });
  return applied;
}

async function migrate(db: D1Database) {
  await db.prepare('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)').run();
  const row = await db.prepare('SELECT MAX(version) AS v FROM schema_migrations').first<{ v: number | null }>();
  const current = row?.v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    // One batch = one transaction; a concurrent isolate applying the same
    // migration fails on the primary key and is ignored below.
    try {
      await db.batch([
        ...m.sql.map((s) => db.prepare(s)),
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').bind(m.version, Date.now()),
      ]);
    } catch (e) {
      const again = await db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').bind(m.version).first();
      if (!again) throw e;
    }
  }
}
