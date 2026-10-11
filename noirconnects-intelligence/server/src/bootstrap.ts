import { openDatabase, type DB } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { ensureInitialSettings } from './services/settings.js';

/** Opens the database, applies migrations and seeds configuration version 1 if needed. */
export function initDatabase(path: string, now: Date = new Date()): DB {
  const db = openDatabase(path);
  migrate(db);
  ensureInitialSettings(db, now);
  return db;
}
