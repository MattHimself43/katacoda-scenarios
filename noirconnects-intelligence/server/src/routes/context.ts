import type { DB } from '../db/connection.js';
import type { Clock } from '../lib/util.js';
import type { LoginRateLimiter } from '../auth/rateLimit.js';

export interface RouteContext {
  db: DB;
  clock: Clock;
  cookieSecure: boolean;
  sessionTtlHours: number;
  loginLimiter: LoginRateLimiter;
}
