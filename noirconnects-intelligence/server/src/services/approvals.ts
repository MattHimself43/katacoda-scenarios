import { randomUUID } from 'node:crypto';
import type { DB } from '../db/connection.js';
import type { Actor } from '../auth/actor.js';
import type { ApprovalStatus, Role } from '../domain/statuses.js';
import { canonicalJson, hashContent } from '../lib/util.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from './audit.js';

/**
 * Universal approval engine.
 *
 * An approval binds a human decision to an exact proposed action (hashed). The engine
 * guarantees:
 *   - only actors holding the required role can decide;
 *   - a decision applies only to the content hash the approver reviewed;
 *   - each approval is decided once and executed at most once (status compare-and-set);
 *   - expired approvals cannot be decided or executed.
 * Callers wrap engine calls in a transaction together with their own state changes.
 */

export interface ApprovalRecord {
  id: string;
  action_type: string;
  target_entity_type: string;
  target_entity_id: string;
  proposed_action: unknown;
  content_hash: string;
  content_version: number | null;
  required_role: Role;
  status: ApprovalStatus;
  requested_by: number | null;
  requested_by_name: string | null;
  requested_at: string;
  expires_at: string | null;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  executed_at: string | null;
  execution_result: unknown;
}

export interface CreateApprovalInput {
  actionType: string;
  targetEntityType: string;
  targetEntityId: string | number;
  proposedAction: unknown;
  contentVersion?: number;
  requiredRole?: 'ADMIN' | 'MANAGER';
  expiresAt?: Date | null;
}

const SELECT = `SELECT a.*, ru.display_name AS requested_by_name, du.display_name AS decided_by_name
                FROM approvals a
                LEFT JOIN users ru ON ru.id = a.requested_by
                LEFT JOIN users du ON du.id = a.decided_by`;

function hydrate(row: Record<string, unknown> | undefined): ApprovalRecord | undefined {
  if (!row) return undefined;
  const { proposed_action_json, execution_result_json, lock_version: _lv, ...rest } = row;
  return {
    ...(rest as Omit<ApprovalRecord, 'proposed_action' | 'execution_result'>),
    proposed_action: JSON.parse(proposed_action_json as string),
    execution_result: execution_result_json ? JSON.parse(execution_result_json as string) : null,
  };
}

export function getApproval(db: DB, id: string): ApprovalRecord | undefined {
  return hydrate(db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as Record<string, unknown> | undefined);
}

export function listApprovals(db: DB, filter: { status?: ApprovalStatus; actionType?: string; limit?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) { where.push('a.status = ?'); params.push(filter.status); }
  if (filter.actionType) { where.push('a.action_type = ?'); params.push(filter.actionType); }
  const rows = db
    .prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.requested_at DESC LIMIT ?`)
    .all(...params, Math.min(filter.limit ?? 100, 500)) as Record<string, unknown>[];
  return rows.map((r) => hydrate(r)!);
}

export function createApproval(db: DB, requester: Actor | 'SYSTEM', input: CreateApprovalInput, now: Date): ApprovalRecord {
  const id = randomUUID();
  try {
    db.prepare(
      `INSERT INTO approvals (id, action_type, target_entity_type, target_entity_id, proposed_action_json, content_hash,
                              content_version, required_role, status, requested_by, requested_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
    ).run(
      id,
      input.actionType,
      input.targetEntityType,
      String(input.targetEntityId),
      canonicalJson(input.proposedAction),
      hashContent(input.proposedAction),
      input.contentVersion ?? null,
      input.requiredRole ?? 'ADMIN',
      requester === 'SYSTEM' ? null : requester.userId,
      now.toISOString(),
      input.expiresAt ? input.expiresAt.toISOString() : null,
    );
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed: approvals/.test(e.message)) {
      throw conflict('An approval request for this item is already open');
    }
    throw e;
  }
  audit(db, requester, {
    action: 'APPROVAL_REQUESTED',
    entityType: 'approval',
    entityId: id,
    details: { actionType: input.actionType, target: `${input.targetEntityType}:${input.targetEntityId}` },
  }, now);
  return getApproval(db, id)!;
}

function roleSatisfies(actorRole: Role, required: Role): boolean {
  if (required === 'ADMIN') return actorRole === 'ADMIN';
  if (required === 'MANAGER') return actorRole === 'ADMIN' || actorRole === 'MANAGER';
  return false;
}

function assertCanDecide(actor: Actor, approval: ApprovalRecord) {
  if (!roleSatisfies(actor.role, approval.required_role)) {
    throw forbidden(`Only ${approval.required_role === 'ADMIN' ? 'administrators' : 'managers or administrators'} can decide this approval`);
  }
}

/**
 * Expiry is checked at decision/execution time (and refused); the scheduler's
 * expireDueApprovals() persists the EXPIRED state. Checking without writing keeps the
 * check correct even when the caller's transaction rolls back on the thrown error.
 */
function isExpired(approval: ApprovalRecord, now: Date): boolean {
  return (
    approval.expires_at !== null &&
    new Date(approval.expires_at) <= now &&
    (approval.status === 'PENDING' || approval.status === 'APPROVED')
  );
}

/**
 * Approve or reject. `reviewedHash` must equal the hash of the content the approver saw;
 * if the underlying proposal changed, the decision is refused.
 */
export function decideApproval(
  db: DB,
  actor: Actor,
  approvalId: string,
  decision: 'APPROVE' | 'REJECT',
  opts: { reviewedHash?: string; notes?: string | null },
  now: Date,
): ApprovalRecord {
  const approval = getApproval(db, approvalId);
  if (!approval) throw notFound('Approval not found');
  assertCanDecide(actor, approval);
  if (isExpired(approval, now)) throw conflict('This approval request has expired');
  if (approval.status !== 'PENDING') throw conflict(`This approval request is already ${approval.status}`);
  if (decision === 'APPROVE' && approval.content_hash !== opts.reviewedHash) {
    throw conflict('The proposal changed after you reviewed it. Review the current version and try again.', {
      currentHash: approval.content_hash,
    });
  }
  const newStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  // Compare-and-set: succeeds for exactly one concurrent decider.
  const res = db
    .prepare(
      `UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, decision_notes = ?, lock_version = lock_version + 1
       WHERE id = ? AND status = 'PENDING' AND content_hash = ?`,
    )
    .run(newStatus, actor.userId, now.toISOString(), opts.notes ?? null, approvalId, approval.content_hash);
  if (res.changes !== 1) throw conflict('This approval request was decided by someone else');
  audit(db, actor, {
    action: decision === 'APPROVE' ? 'APPROVAL_GRANTED' : 'APPROVAL_REJECTED',
    entityType: 'approval',
    entityId: approvalId,
    details: { actionType: approval.action_type, target: `${approval.target_entity_type}:${approval.target_entity_id}`, contentHash: approval.content_hash, notes: opts.notes ?? null },
  }, now);
  return getApproval(db, approvalId)!;
}

/**
 * Verifies an approval may be executed for exactly `currentAction` and atomically marks it
 * EXECUTED. Throws if it is not APPROVED, has expired, was already executed, or the action
 * differs from what was approved. Background jobs must call this; there is no bypass.
 */
export function consumeApproval(
  db: DB,
  approvalId: string,
  expected: { actionType: string; currentAction: unknown },
  result: unknown,
  now: Date,
): ApprovalRecord {
  const approval = getApproval(db, approvalId);
  if (!approval) throw notFound('Approval not found');
  if (approval.action_type !== expected.actionType) throw conflict('Approval does not cover this action type');
  if (isExpired(approval, now)) throw conflict('This approval has expired');
  if (approval.status !== 'APPROVED') throw conflict(`Approval is ${approval.status}, not APPROVED`);
  if (hashContent(expected.currentAction) !== approval.content_hash) {
    throw conflict('The action to execute differs from the approved content');
  }
  const res = db
    .prepare(
      `UPDATE approvals SET status = 'EXECUTED', executed_at = ?, execution_result_json = ?, lock_version = lock_version + 1
       WHERE id = ? AND status = 'APPROVED'`,
    )
    .run(now.toISOString(), JSON.stringify(result ?? null), approvalId);
  if (res.changes !== 1) throw conflict('Approval was already executed');
  audit(db, 'SYSTEM', { action: 'APPROVAL_EXECUTED', entityType: 'approval', entityId: approvalId, details: { actionType: approval.action_type } }, now);
  return getApproval(db, approvalId)!;
}

/** Cancels a PENDING or APPROVED (not yet executed) approval, e.g. because the content was edited. */
export function cancelApproval(db: DB, actor: Actor | 'SYSTEM', approvalId: string, reason: string, now: Date): boolean {
  const res = db
    .prepare(
      `UPDATE approvals SET status = 'CANCELLED', decision_notes = COALESCE(decision_notes || ' | ', '') || ?, lock_version = lock_version + 1
       WHERE id = ? AND status IN ('PENDING','APPROVED')`,
    )
    .run(reason, approvalId);
  if (res.changes === 1) {
    audit(db, actor, { action: 'APPROVAL_CANCELLED', entityType: 'approval', entityId: approvalId, details: { reason } }, now);
    return true;
  }
  return false;
}

/** Marks every overdue PENDING/APPROVED approval as EXPIRED. Returns the number expired. */
export function expireDueApprovals(db: DB, now: Date): number {
  const due = db
    .prepare(`SELECT id FROM approvals WHERE status IN ('PENDING','APPROVED') AND expires_at IS NOT NULL AND expires_at <= ?`)
    .all(now.toISOString()) as { id: string }[];
  for (const { id } of due) {
    db.prepare(`UPDATE approvals SET status = 'EXPIRED', lock_version = lock_version + 1 WHERE id = ? AND status IN ('PENDING','APPROVED')`).run(id);
    audit(db, 'SCHEDULER', { action: 'APPROVAL_EXPIRED', entityType: 'approval', entityId: id }, now);
  }
  return due.length;
}
