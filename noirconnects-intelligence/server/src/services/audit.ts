import type { DB } from '../db/connection.js';
import type { Actor } from '../auth/actor.js';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string | number;
  details?: Record<string, unknown>;
}

export function audit(db: DB, actor: Actor | 'SYSTEM' | 'SCHEDULER', entry: AuditEntry, at: Date): void {
  const isUser = typeof actor === 'object';
  db.prepare(
    `INSERT INTO audit_logs (occurred_at, actor_type, actor_user_id, action, entity_type, entity_id, details_json, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    at.toISOString(),
    isUser ? 'USER' : actor,
    isUser ? actor.userId : null,
    entry.action,
    entry.entityType ?? null,
    entry.entityId != null ? String(entry.entityId) : null,
    JSON.stringify(entry.details ?? {}),
    isUser ? (actor.ip ?? null) : null,
  );
}

export interface AuditQuery {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: number;
  q?: string;
  limit?: number;
  beforeId?: number;
}

export function listAuditLogs(db: DB, query: AuditQuery) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.action) { where.push('a.action = ?'); params.push(query.action); }
  if (query.entityType) { where.push('a.entity_type = ?'); params.push(query.entityType); }
  if (query.entityId) { where.push('a.entity_id = ?'); params.push(query.entityId); }
  if (query.actorUserId) { where.push('a.actor_user_id = ?'); params.push(query.actorUserId); }
  if (query.beforeId) { where.push('a.id < ?'); params.push(query.beforeId); }
  if (query.q) {
    where.push("(a.action LIKE ? ESCAPE '\\' OR a.details_json LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(query.q)}%`;
    params.push(like, like);
  }
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const rows = db
    .prepare(
      `SELECT a.id, a.occurred_at, a.actor_type, a.actor_user_id, u.display_name AS actor_name, u.email AS actor_email,
              a.action, a.entity_type, a.entity_id, a.details_json, a.ip
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(...params, limit) as Array<Record<string, unknown> & { details_json: string }>;
  return rows.map(({ details_json, ...r }) => ({ ...r, details: JSON.parse(details_json) as unknown }));
}

export function listAuditActions(db: DB): string[] {
  return (db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all() as { action: string }[]).map(
    (r) => r.action,
  );
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
