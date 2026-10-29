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
  {
    version: 3,
    sql: [
      // Node graph: attachments become nodes (some without a file: sample groups,
      // peak-list text), connected by directed links (upstream → downstream).
      `ALTER TABLE attachments ADD COLUMN node_type TEXT`,
      `ALTER TABLE attachments ADD COLUMN label TEXT`,
      `ALTER TABLE attachments ADD COLUMN pos_x REAL`,
      `ALTER TABLE attachments ADD COLUMN pos_y REAL`,
      `CREATE TABLE IF NOT EXISTS attachment_links (
        reaction_id TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        relation TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (from_id, to_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_links_reaction ON attachment_links (reaction_id)`,
    ],
  },
  {
    version: 4,
    sql: [
      // List summary (code, number of runs, best yield) as JSON; filled on save,
      // and lazily by the list endpoint for rows saved before this column existed.
      `ALTER TABLE reactions ADD COLUMN meta TEXT`,
    ],
  },
  {
    version: 5,
    sql: [
      // Reusable reagent lots (bottles). Their spectra are attachments whose
      // reaction_id is the owner key "lot:<id>".
      `CREATE TABLE IF NOT EXISTS reagent_lots (
        id TEXT PRIMARY KEY,
        compound_key TEXT NOT NULL,
        data TEXT NOT NULL,
        search_text TEXT NOT NULL DEFAULT '',
        created_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_lots_key ON reagent_lots (compound_key, deleted_at)`,
    ],
  },
  {
    version: 6,
    sql: [
      // Abbreviation table (THF, Boc2O, SM-1…), shared by the group.
      `CREATE TABLE IF NOT EXISTS abbreviations (
        id TEXT PRIMARY KEY,
        abbr TEXT NOT NULL,
        data TEXT NOT NULL,
        created_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
    ],
  },
  {
    version: 7,
    sql: [
      // One live entry per abbreviation: keep the most recently updated of any
      // duplicates (possible before this check existed), then enforce it.
      `UPDATE abbreviations SET deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
        WHERE deleted_at IS NULL AND EXISTS (
          SELECT 1 FROM abbreviations b
          WHERE b.abbr = abbreviations.abbr AND b.deleted_at IS NULL AND b.id != abbreviations.id
            AND (b.updated_at > abbreviations.updated_at OR (b.updated_at = abbreviations.updated_at AND b.id > abbreviations.id))
        )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_abbr_live ON abbreviations (abbr) WHERE deleted_at IS NULL`,
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
