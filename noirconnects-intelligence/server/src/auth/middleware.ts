import type { NextFunction, Request, Response } from 'express';
import type { DB } from '../db/connection.js';
import type { Clock } from '../lib/util.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { can, type Permission } from './permissions.js';
import { resolveSession, SESSION_COOKIE } from './sessions.js';
import type { Actor } from './actor.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'NoirConnects';

/** Loads the authenticated actor (if any) from the session cookie. */
export function loadActor(db: DB, clock: Clock) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) {
      const actor = resolveSession(db, token, clock());
      if (actor) req.actor = { ...actor, ip: req.ip };
    }
    next();
  };
}

/**
 * CSRF defence for cookie-authenticated APIs: state-changing requests must carry a custom
 * header. Browsers cannot attach custom headers cross-origin without a CORS preflight, which
 * this server never approves. Combined with SameSite=Strict cookies.
 */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get(CSRF_HEADER) !== CSRF_VALUE) return next(forbidden('Missing request verification header'));
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.actor) return next(unauthorized());
  next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.actor) return next(unauthorized());
    if (!can(req.actor.role, permission)) return next(forbidden());
    next();
  };
}

export function actorOf(req: Request): Actor {
  if (!req.actor) throw unauthorized();
  return req.actor;
}
