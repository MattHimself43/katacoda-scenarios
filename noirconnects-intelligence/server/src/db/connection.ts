import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

/**
 * Runs `fn` inside an IMMEDIATE transaction (takes the write lock up front), so
 * read-check-write sequences cannot interleave with other writers.
 */
export function tx<T>(db: DB, fn: () => T): T {
  return db.transaction(fn).immediate();
}
