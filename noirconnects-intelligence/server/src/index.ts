import { createApp } from './app.js';
import { initDatabase } from './bootstrap.js';
import { loadEnv } from './config/env.js';
import { countUsers } from './services/users.js';

const env = loadEnv();
const db = initDatabase(env.databasePath);
const app = createApp({
  db,
  cookieSecure: env.cookieSecure,
  sessionTtlHours: env.sessionTtlHours,
  webDistPath: env.webDistPath,
});

const server = app.listen(env.port, '127.0.0.1', () => {
  console.log(`NoirConnects Intelligence API listening on http://127.0.0.1:${env.port}`);
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
