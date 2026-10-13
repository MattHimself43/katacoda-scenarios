import { randomBytes } from 'node:crypto';
import type { DB } from '../db/connection.js';
import { sha256 } from '../lib/util.js';
import type { Actor } from './actor.js';
import type { Role } from '../domain/statuses.js';

export const SESSION_COOKIE = 'nc_session';

export function createSession(
  db: DB,
  userId: number,
  now: Date,
  ttlHours: number,
  meta: { ip?: string; userAgent?: string },
): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + ttlHours * 3600_000);
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(sha256(token), userId, now.toISOString(), expiresAt.toISOString(), now.toISOString(), meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null);
  return { token, expiresAt };
}

interface SessionRow {
  session_id: number;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at: string;
  user_id: number;
  email: string;
  display_name: string;
  is_active: number;
  is_owner: number;
  role: Role;
}

/** Resolves a session token to an active user. Returns null for unknown, expired, revoked or deactivated. */
export function resolveSession(db: DB, token: string, now: Date): Actor | null {
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, s.revoked_at, s.last_seen_at,
              u.id AS user_id, u.email, u.display_name, u.is_active, u.is_owner, r.name AS role
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
       WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as SessionRow | undefined;
  if (!row || row.revoked_at || !row.is_active || new Date(row.expires_at) <= now) return null;
  // Throttle last-seen writes to once a minute.
  if (now.getTime() - new Date(row.last_seen_at).getTime() > 60_000) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now.toISOString(), row.session_id);
  }
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isOwner: row.is_owner === 1,
  };
}

export function revokeSession(db: DB, token: string, now: Date): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(now.toISOString(), sha256(token));
}

export function revokeAllUserSessions(db: DB, userId: number, now: Date): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now.toISOString(), userId);
}
