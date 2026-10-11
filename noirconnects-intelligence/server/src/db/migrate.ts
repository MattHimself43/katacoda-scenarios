import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { DB } from './connection.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface MigrationResult {
  applied: string[];
  current: string | null;
}

/** Applies pending SQL migrations in filename order. Each migration runs in its own transaction. */
export function migrate(db: DB, dir: string = MIGRATIONS_DIR): MigrationResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const applied = new Map(
    (db.prepare('SELECT name, checksum FROM schema_migrations').all() as { name: string; checksum: string }[])
      .map((r) => [r.name, r.checksum]),
  );
  const newlyApplied: string[] = [];
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = applied.get(file);
    if (existing) {
      if (existing !== checksum) {
        throw new Error(`Migration ${file} was modified after being applied. Create a new migration instead.`);
      }
      continue;
    }
    // Foreign keys must be toggled outside a transaction; keep them on but defer checks.
    db.transaction(() => {
      db.pragma('defer_foreign_keys = ON');
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)')
        .run(file, checksum, new Date().toISOString());
    })();
    newlyApplied.push(file);
  }
  return { applied: newlyApplied, current: files.at(-1) ?? null };
}
