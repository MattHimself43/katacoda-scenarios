import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const projectRoot = resolve(serverRoot, '..');

export interface AppEnv {
  nodeEnv: string;
  port: number;
  host: string;
  trustProxy: boolean;
  databasePath: string;
  cookieSecure: boolean;
  sessionTtlHours: number;
  webDistPath: string;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const dbPath = env.DATABASE_PATH ?? './data/noirconnects.db';
  const ttl = Number(env.SESSION_TTL_HOURS ?? 12);
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port: Number(env.PORT ?? 4000),
    // Local default is loopback-only. Hosting platforms set HOST=0.0.0.0.
    host: env.HOST ?? '127.0.0.1',
    trustProxy: env.TRUST_PROXY === 'true',
    // Relative paths resolve from the project root so all npm scripts share one database.
    databasePath: dbPath === ':memory:' ? dbPath : resolve(projectRoot, dbPath),
    cookieSecure: env.COOKIE_SECURE === 'true',
    sessionTtlHours: Number.isFinite(ttl) && ttl > 0 && ttl <= 24 * 30 ? ttl : 12,
    webDistPath: resolve(projectRoot, 'web', 'dist'),
  };
}
