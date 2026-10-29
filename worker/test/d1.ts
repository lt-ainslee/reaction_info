// An in-memory D1Database for tests, backed by Node's built-in SQLite (the
// engine D1 runs on). Covers what the Worker uses: prepare / bind / first /
// all / run, and batch as one transaction.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const isRead = (sql: string) => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql);
const plain = (row: unknown) => ({ ...(row as Record<string, unknown>) });

export function memoryD1(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');

  class Statement {
    constructor(
      readonly sql: string,
      readonly args: SQLInputValue[] = [],
    ) {}
    bind(...args: unknown[]) {
      return new Statement(this.sql, args as SQLInputValue[]);
    }
    async first<T>(column?: string): Promise<T | null> {
      const row = sqlite.prepare(this.sql).get(...this.args);
      if (!row) return null;
      return (column ? (row as Record<string, unknown>)[column] : plain(row)) as T;
    }
    async all<T>() {
      return this.exec() as unknown as D1Result<T>;
    }
    async run() {
      return this.exec();
    }
    exec() {
      if (isRead(this.sql)) return { success: true, results: sqlite.prepare(this.sql).all(...this.args).map(plain), meta: { changes: 0 } };
      const r = sqlite.prepare(this.sql).run(...this.args);
      return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
  }

  const db = {
    prepare: (sql: string) => new Statement(sql),
    async batch(stmts: Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.exec());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}
