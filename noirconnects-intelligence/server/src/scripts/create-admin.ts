import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadEnv } from '../config/env.js';
import { initDatabase } from '../bootstrap.js';
import { countUsers, createOwner } from '../services/users.js';
import { MIN_PASSWORD_LENGTH } from '../auth/password.js';

/**
 * Creates the owner administrator. Runs only while the database has no users; afterwards,
 * users are managed from Settings → Team & Access. Values may be supplied via
 * OWNER_EMAIL / OWNER_NAME / OWNER_PASSWORD for non-interactive setups.
 */
async function main() {
  const env = loadEnv();
  const db = initDatabase(env.databasePath);
  try {
    if (countUsers(db) > 0) {
      console.error('An owner already exists. Manage users from the dashboard (Settings → Team & Access).');
      process.exitCode = 1;
      return;
    }
    const rl = createInterface({ input: stdin, output: stdout });
    const email = process.env.OWNER_EMAIL ?? (await rl.question('Owner email: '));
    const name = process.env.OWNER_NAME ?? (await rl.question('Display name: '));
    const password =
      process.env.OWNER_PASSWORD ?? (await rl.question(`Password (min ${MIN_PASSWORD_LENGTH} chars, input visible): `));
    rl.close();
    const user = await createOwner(db, { email, displayName: name || email, password }, new Date());
    console.log(`Owner administrator created: ${user.email}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

void main();
