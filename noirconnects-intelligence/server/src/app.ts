import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import type { DB } from './db/connection.js';
import { systemClock, type Clock } from './lib/util.js';
import { AppError } from './lib/errors.js';
import { loadActor, requireAuth, requireCsrfHeader } from './auth/middleware.js';
import { LoginRateLimiter } from './auth/rateLimit.js';
import type { RouteContext } from './routes/context.js';
import { authRoutes } from './routes/auth.js';
import { settingsRoutes } from './routes/settings.js';
import { approvalRoutes, auditRoutes, overviewRoutes, userRoutes } from './routes/misc.js';

export interface AppOptions {
  db: DB;
  clock?: Clock;
  cookieSecure?: boolean;
  sessionTtlHours?: number;
  webDistPath?: string;
  trustProxy?: boolean;
}

export function createApp(opts: AppOptions) {
  const ctx: RouteContext = {
    db: opts.db,
    clock: opts.clock ?? systemClock,
    cookieSecure: opts.cookieSecure ?? false,
    sessionTtlHours: opts.sessionTtlHours ?? 12,
    loginLimiter: new LoginRateLimiter(),
  };
  const app = express();
  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(requireCsrfHeader);
  api.use(loadActor(ctx.db, ctx.clock));
  api.get('/health', (_req, res) => {
    ctx.db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });
  api.use('/auth', authRoutes(ctx));
  api.use(requireAuth);
  api.use('/', overviewRoutes(ctx));
  api.use('/settings', settingsRoutes(ctx));
  api.use('/audit', auditRoutes(ctx));
  api.use('/approvals', approvalRoutes(ctx));
  api.use('/users', userRoutes(ctx));
  api.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Unknown API endpoint')));
  app.use('/api', api);

  if (opts.webDistPath && existsSync(join(opts.webDistPath, 'index.html'))) {
    const dist = opts.webDistPath;
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request is invalid',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected server error' } });
  });

  return app;
}
