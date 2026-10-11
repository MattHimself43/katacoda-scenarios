import { loadEnv } from '../config/env.js';
import { openDatabase } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { ensureInitialSettings } from '../services/settings.js';

const env = loadEnv();
const db = openDatabase(env.databasePath);
const result = migrate(db);
ensureInitialSettings(db, new Date());
console.log(result.applied.length ? `Applied: ${result.applied.join(', ')}` : 'Database is up to date.');
console.log(`Schema version: ${result.current}`);
db.close();
