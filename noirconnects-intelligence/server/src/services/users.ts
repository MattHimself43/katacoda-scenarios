import type { DB } from '../db/connection.js';
import { tx } from '../db/connection.js';
import type { Actor } from '../auth/actor.js';
import { hashPassword, validatePasswordStrength } from '../auth/password.js';
import { revokeAllUserSessions } from '../auth/sessions.js';
import { ROLES, type Role } from '../domain/statuses.js';
import { audit } from './audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

export interface UserRecord {
  id: number;
  email: string;
  display_name: string;
  role: Role;
  is_active: number;
  is_owner: number;
  created_at: string;
  last_login_at: string | null;
}

const USER_SELECT = `SELECT u.id, u.email, u.display_name, r.name AS role, u.is_active, u.is_owner, u.created_at, u.last_login_at
                     FROM users u JOIN roles r ON r.id = u.role_id`;

function roleId(db: DB, role: Role): number {
  const row = db.prepare('SELECT id FROM roles WHERE name = ?').get(role) as { id: number } | undefined;
  if (!row) throw badRequest(`Unknown role ${role}`);
  return row.id;
}

export function listUsers(db: DB): UserRecord[] {
  return db.prepare(`${USER_SELECT} ORDER BY u.id`).all() as UserRecord[];
}

export function getUser(db: DB, id: number): UserRecord | undefined {
  return db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(id) as UserRecord | undefined;
}

export function countUsers(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export interface NewUser {
  email: string;
  displayName: string;
  role: Role;
  password: string;
}

/** Creates the initial owner administrator. Only allowed while no users exist. */
export async function createOwner(db: DB, input: Omit<NewUser, 'role'>, now: Date): Promise<UserRecord> {
  const weak = validatePasswordStrength(input.password);
  if (weak) throw badRequest(weak);
  const hash = await hashPassword(input.password);
  return tx(db, () => {
    if (countUsers(db) > 0) throw conflict('An owner already exists. Use the dashboard to manage users.');
    const res = db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, role_id, is_active, is_owner, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 1, ?, ?)`,
      )
      .run(input.email.trim(), input.displayName.trim(), hash, roleId(db, 'ADMIN'), now.toISOString(), now.toISOString());
    audit(db, 'SYSTEM', { action: 'OWNER_CREATED', entityType: 'user', entityId: Number(res.lastInsertRowid), details: { email: input.email } }, now);
    return getUser(db, Number(res.lastInsertRowid))!;
  });
}

export async function createUser(db: DB, actor: Actor, input: NewUser, now: Date): Promise<UserRecord> {
  if (!ROLES.includes(input.role)) throw badRequest('Invalid role');
  const weak = validatePasswordStrength(input.password);
  if (weak) throw badRequest(weak);
  const hash = await hashPassword(input.password);
  return tx(db, () => {
    const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email.trim());
    if (exists) throw conflict('A user with this email already exists');
    const res = db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, role_id, is_active, is_owner, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 0, ?, ?)`,
      )
      .run(input.email.trim(), input.displayName.trim(), hash, roleId(db, input.role), now.toISOString(), now.toISOString());
    const id = Number(res.lastInsertRowid);
    audit(db, actor, { action: 'USER_CREATED', entityType: 'user', entityId: id, details: { email: input.email, role: input.role } }, now);
    return getUser(db, id)!;
  });
}

function activeAdminCount(db: DB): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'ADMIN' AND u.is_active = 1`).get() as {
      n: number;
    }
  ).n;
}

export function updateUser(
  db: DB,
  actor: Actor,
  userId: number,
  patch: { role?: Role; isActive?: boolean; displayName?: string },
  now: Date,
): UserRecord {
  return tx(db, () => {
    const user = getUser(db, userId);
    if (!user) throw notFound('User not found');
    const demoting = patch.role !== undefined && patch.role !== 'ADMIN' && user.role === 'ADMIN';
    const deactivating = patch.isActive === false && user.is_active === 1;
    if (user.is_owner && (demoting || deactivating)) throw conflict('The owner account cannot be demoted or deactivated');
    if (user.role === 'ADMIN' && user.is_active && (demoting || deactivating) && activeAdminCount(db) <= 1) {
      throw conflict('At least one active administrator is required');
    }
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (patch.role !== undefined && patch.role !== user.role) {
      if (!ROLES.includes(patch.role)) throw badRequest('Invalid role');
      db.prepare('UPDATE users SET role_id = ?, updated_at = ? WHERE id = ?').run(roleId(db, patch.role), now.toISOString(), userId);
      changes.role = { from: user.role, to: patch.role };
    }
    if (patch.isActive !== undefined && (patch.isActive ? 1 : 0) !== user.is_active) {
      db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(patch.isActive ? 1 : 0, now.toISOString(), userId);
      changes.isActive = { from: user.is_active === 1, to: patch.isActive };
    }
    if (patch.displayName !== undefined && patch.displayName.trim() !== user.display_name) {
      db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').run(patch.displayName.trim(), now.toISOString(), userId);
      changes.displayName = { from: user.display_name, to: patch.displayName.trim() };
    }
    // Permission changes take effect immediately: drop existing sessions on role change or deactivation.
    if (changes.role || changes.isActive) revokeAllUserSessions(db, userId, now);
    if (Object.keys(changes).length) {
      audit(db, actor, { action: 'USER_UPDATED', entityType: 'user', entityId: userId, details: { email: user.email, changes } }, now);
    }
    return getUser(db, userId)!;
  });
}

export async function resetPassword(db: DB, actor: Actor, userId: number, password: string, now: Date): Promise<void> {
  const weak = validatePasswordStrength(password);
  if (weak) throw badRequest(weak);
  const hash = await hashPassword(password);
  tx(db, () => {
    const user = getUser(db, userId);
    if (!user) throw notFound('User not found');
    if (user.is_owner && actor.userId !== userId) throw conflict("Only the owner can change the owner's password");
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, now.toISOString(), userId);
    revokeAllUserSessions(db, userId, now);
    audit(db, actor, { action: 'USER_PASSWORD_RESET', entityType: 'user', entityId: userId, details: { email: user.email } }, now);
  });
}

/**
 * Creates the owner from OWNER_EMAIL / OWNER_PASSWORD (/ OWNER_NAME) when the database has
 * no users. Used on hosts without shell access. Never overwrites an existing account.
 */
export async function bootstrapOwnerFromEnv(db: DB, env: NodeJS.ProcessEnv, now: Date): Promise<'created' | 'skipped'> {
  const email = env.OWNER_EMAIL?.trim();
  const password = env.OWNER_PASSWORD;
  if (!email || !password || countUsers(db) > 0) return 'skipped';
  await createOwner(db, { email, displayName: env.OWNER_NAME?.trim() || email, password }, now);
  return 'created';
}
