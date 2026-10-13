import { Router } from 'express';
import { z } from 'zod';
import type { RouteContext } from './context.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import { createSession, revokeSession, SESSION_COOKIE } from '../auth/sessions.js';
import { actorOf, requireAuth } from '../auth/middleware.js';
import { permissionsFor } from '../auth/permissions.js';
import { audit } from '../services/audit.js';
import { unauthorized, AppError } from '../lib/errors.js';
import { tx } from '../db/connection.js';
import type { Role } from '../domain/statuses.js';

const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(256) });

// Verifying against a dummy hash for unknown users keeps response timing uniform.
const dummyHashPromise = hashPassword('timing-equalisation-placeholder');

export function authRoutes(ctx: RouteContext) {
  const r = Router();

  r.post('/login', async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const limiterKey = `${req.ip}|${email.toLowerCase()}`;
    const nowMs = ctx.clock().getTime();
    if (ctx.loginLimiter.isBlocked(limiterKey, nowMs)) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many failed sign-in attempts. Try again in 15 minutes.');
    }
    const user = ctx.db
      .prepare('SELECT id, password_hash, is_active FROM users WHERE email = ?')
      .get(email) as { id: number; password_hash: string; is_active: number } | undefined;
    const ok = await verifyPassword(password, user?.password_hash ?? (await dummyHashPromise));
    const now = ctx.clock();
    if (!user || !ok || !user.is_active) {
      ctx.loginLimiter.recordFailure(limiterKey, nowMs);
      audit(ctx.db, 'SYSTEM', { action: 'LOGIN_FAILED', entityType: 'user', entityId: user?.id, details: { email, ip: req.ip } }, now);
      throw unauthorized('Incorrect email or password');
    }
    ctx.loginLimiter.reset(limiterKey);
    const session = tx(ctx.db, () => {
      const s = createSession(ctx.db, user.id, now, ctx.sessionTtlHours, { ip: req.ip, userAgent: req.get('user-agent') });
      ctx.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now.toISOString(), user.id);
      const role = (ctx.db.prepare('SELECT r.name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(user.id) as { name: Role }).name;
      audit(ctx.db, { userId: user.id, email, displayName: email, role, isOwner: false, ip: req.ip }, { action: 'LOGIN_SUCCEEDED', entityType: 'user', entityId: user.id }, now);
      return s;
    });
    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: ctx.cookieSecure,
      // Relative lifetime; the server independently enforces expiry from the sessions table.
      maxAge: session.expiresAt.getTime() - now.getTime(),
      path: '/',
    });
    res.json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) revokeSession(ctx.db, token, ctx.clock());
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.get('/me', requireAuth, (req, res) => {
    const actor = actorOf(req);
    res.json({
      user: { id: actor.userId, email: actor.email, displayName: actor.displayName, role: actor.role, isOwner: actor.isOwner },
      permissions: permissionsFor(actor.role),
    });
  });

  return r;
}
