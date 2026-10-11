import { createApp } from './app.js';
import { initDatabase } from './bootstrap.js';
import { loadEnv } from './config/env.js';
import { bootstrapOwnerFromEnv, countUsers } from './services/users.js';

const env = loadEnv();
const db = initDatabase(env.databasePath);
if ((await bootstrapOwnerFromEnv(db, process.env, new Date())) === 'created') {
  console.log(`Owner administrator created from OWNER_EMAIL (${process.env.OWNER_EMAIL}).`);
}
const app = createApp({
  db,
  cookieSecure: env.cookieSecure,
  sessionTtlHours: env.sessionTtlHours,
  webDistPath: env.webDistPath,
  trustProxy: env.trustProxy,
});

const server = app.listen(env.port, env.host, () => {
  console.log(`NoirConnects Intelligence listening on http://${env.host}:${env.port}`);
  console.log(`Database: ${env.databasePath}`);
  if (countUsers(db) === 0) {
    console.log('No users exist yet. Create the owner administrator with: npm run create-admin');
  }
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
