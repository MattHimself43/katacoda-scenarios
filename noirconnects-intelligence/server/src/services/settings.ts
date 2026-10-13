import type { DB } from '../db/connection.js';
import { tx } from '../db/connection.js';
import type { Actor } from '../auth/actor.js';
import { can } from '../auth/permissions.js';
import {
  ADMIN_ONLY_PROPOSAL_KEYS,
  DEFAULT_CONFIG,
  LOCKED_KEYS,
  diffConfig,
  intelligenceConfigSchema,
  type ConfigChange,
  type ConfigKey,
  type IntelligenceConfig,
} from '../domain/config.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { hashContent, parseJson } from '../lib/util.js';
import { audit } from './audit.js';
import { cancelApproval, consumeApproval, createApproval, decideApproval, getApproval } from './approvals.js';

export const SETTINGS_CHANGE_ACTION = 'SETTINGS_CHANGE';

export interface ActiveSettings {
  versionId: number;
  version: number;
  config: IntelligenceConfig;
  configHash: string;
  createdAt: string;
  approvedBy: string | null;
  notes: string | null;
}

/** Creates configuration version 1 from defaults on a fresh database. Idempotent. */
export function ensureInitialSettings(db: DB, now: Date): void {
  tx(db, () => {
    const existing = db.prepare('SELECT COUNT(*) AS n FROM settings_versions').get() as { n: number };
    if (existing.n > 0) return;
    const config = intelligenceConfigSchema.parse(DEFAULT_CONFIG);
    const res = db
      .prepare(
        `INSERT INTO settings_versions (version, config_json, config_hash, change_request_id, created_by, approved_by, created_at, notes)
         VALUES (1, ?, ?, NULL, NULL, NULL, ?, 'Initial configuration')`,
      )
      .run(JSON.stringify(config), hashContent(config), now.toISOString());
    writeActiveRows(db, Number(res.lastInsertRowid), config, now);
    audit(db, 'SYSTEM', { action: 'SETTINGS_INITIALIZED', entityType: 'settings_version', entityId: 1, details: { config } }, now);
  });
}

function writeActiveRows(db: DB, versionId: number, config: IntelligenceConfig, now: Date) {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value_json, settings_version_id, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, settings_version_id = excluded.settings_version_id, updated_at = excluded.updated_at`,
  );
  for (const [key, value] of Object.entries(config)) upsert.run(key, JSON.stringify(value), versionId, now.toISOString());
  // Remove keys no longer part of the schema so the active row set mirrors the version exactly.
  const keys = Object.keys(config);
  db.prepare(`DELETE FROM settings WHERE key NOT IN (${keys.map(() => '?').join(',')})`).run(...keys);
}

export function getActiveSettings(db: DB): ActiveSettings {
  const rows = db.prepare('SELECT key, value_json, settings_version_id FROM settings').all() as {
    key: string;
    value_json: string;
    settings_version_id: number;
  }[];
  if (rows.length === 0) throw new Error('Settings not initialized');
  const versionIds = new Set(rows.map((r) => r.settings_version_id));
  if (versionIds.size !== 1) throw new Error('Settings rows reference multiple versions — integrity violation');
  const config = intelligenceConfigSchema.parse(Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value_json)])));
  const versionId = rows[0]!.settings_version_id;
  const v = db
    .prepare(
      `SELECT sv.version, sv.config_hash, sv.created_at, sv.notes, u.display_name AS approved_by
       FROM settings_versions sv LEFT JOIN users u ON u.id = sv.approved_by WHERE sv.id = ?`,
    )
    .get(versionId) as { version: number; config_hash: string; created_at: string; notes: string | null; approved_by: string | null };
  if (hashContent(config) !== v.config_hash) throw new Error('Active settings do not match their version snapshot — integrity violation');
  return { versionId, version: v.version, config, configHash: v.config_hash, createdAt: v.created_at, approvedBy: v.approved_by, notes: v.notes };
}

export interface SettingsVersionView {
  id: number;
  version: number;
  config: IntelligenceConfig;
  config_hash: string;
  change_request_id: number | null;
  created_at: string;
  notes: string | null;
  requested_by: string | null;
  approved_by: string | null;
}

export function listVersions(db: DB): SettingsVersionView[] {
  const rows = db
    .prepare(
      `SELECT sv.id, sv.version, sv.config_json, sv.config_hash, sv.change_request_id, sv.created_at, sv.notes,
              cu.display_name AS requested_by, au.display_name AS approved_by
       FROM settings_versions sv
       LEFT JOIN users cu ON cu.id = sv.created_by
       LEFT JOIN users au ON au.id = sv.approved_by
       ORDER BY sv.version DESC`,
    )
    .all() as Array<Omit<SettingsVersionView, 'config'> & { config_json: string }>;
  return rows.map(({ config_json, ...r }) => ({ ...r, config: JSON.parse(config_json) as IntelligenceConfig }));
}

export interface ChangeRequestView {
  id: number;
  base_version: number;
  status: string;
  reason: string | null;
  changes: ConfigChange[];
  proposed_config: IntelligenceConfig;
  approval_id: string | null;
  approval_status: string | null;
  content_hash: string | null;
  requested_by: number;
  requested_by_name: string;
  requested_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  resulting_version: number | null;
  is_stale: boolean;
}

export function listChangeRequests(db: DB, filter: { status?: string } = {}): ChangeRequestView[] {
  const active = getActiveSettings(db);
  const rows = db
    .prepare(
      `SELECT r.*, ru.display_name AS requested_by_name, du.display_name AS decided_by_name,
              a.status AS approval_status, a.content_hash, sv.version AS resulting_version
       FROM settings_change_requests r
       JOIN users ru ON ru.id = r.requested_by
       LEFT JOIN users du ON du.id = r.decided_by
       LEFT JOIN approvals a ON a.id = r.approval_id
       LEFT JOIN settings_versions sv ON sv.id = r.resulting_version_id
       ${filter.status ? 'WHERE r.status = ?' : ''}
       ORDER BY r.id DESC LIMIT 200`,
    )
    .all(...(filter.status ? [filter.status] : [])) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    base_version: r.base_version as number,
    status: r.status as string,
    reason: r.reason as string | null,
    changes: parseJson<ConfigChange[]>(r.changes_json as string, []),
    proposed_config: JSON.parse(r.proposed_config_json as string) as IntelligenceConfig,
    approval_id: r.approval_id as string | null,
    approval_status: r.approval_status as string | null,
    content_hash: r.content_hash as string | null,
    requested_by: r.requested_by as number,
    requested_by_name: r.requested_by_name as string,
    requested_at: r.requested_at as string,
    decided_by_name: r.decided_by_name as string | null,
    decided_at: r.decided_at as string | null,
    decision_notes: r.decision_notes as string | null,
    resulting_version: r.resulting_version as number | null,
    is_stale: r.status === 'PENDING' && (r.base_version as number) !== active.version,
  }));
}

function getRequest(db: DB, id: number) {
  return db.prepare('SELECT * FROM settings_change_requests WHERE id = ?').get(id) as
    | { id: number; base_version: number; status: string; approval_id: string; requested_by: number; proposed_config_json: string; changes_json: string }
    | undefined;
}

function approvalPayload(requestId: number, baseVersion: number, proposedConfig: IntelligenceConfig) {
  return { changeRequestId: requestId, baseVersion, proposedConfig };
}

/**
 * Proposes a configuration change. Nothing takes effect until an administrator approves it.
 * `patch` contains only the keys being changed.
 */
export function proposeSettingsChange(
  db: DB,
  actor: Actor,
  patch: Partial<IntelligenceConfig>,
  reason: string | null,
  now: Date,
): ChangeRequestView {
  if (!can(actor.role, 'settings.propose')) throw forbidden('Your role cannot propose settings changes');
  return tx(db, () => {
    const active = getActiveSettings(db);
    const merged: Record<string, unknown> = { ...active.config, ...patch };
    if (patch.activeNiche && patch.activeNiche !== 'Custom' && !('customNiche' in patch)) merged.customNiche = null;
    const parsed = intelligenceConfigSchema.safeParse(merged);
    if (!parsed.success) {
      throw badRequest('Invalid configuration', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    const proposed = parsed.data;
    const changes = diffConfig(active.config, proposed);
    if (changes.length === 0) throw badRequest('The proposed configuration is identical to the active configuration');
    const locked = changes.filter((c) => LOCKED_KEYS.has(c.key));
    if (locked.length) throw badRequest(`These settings cannot be changed: ${locked.map((c) => c.key).join(', ')}`);
    const sensitive = changes.filter((c) => ADMIN_ONLY_PROPOSAL_KEYS.has(c.key as ConfigKey));
    if (sensitive.length && !can(actor.role, 'settings.propose_sensitive')) {
      throw forbidden(`Only administrators can propose changes to: ${sensitive.map((c) => c.key).join(', ')}`);
    }

    const res = db
      .prepare(
        `INSERT INTO settings_change_requests (base_version, proposed_config_json, changes_json, reason, status, requested_by, requested_at)
         VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
      )
      .run(active.version, JSON.stringify(proposed), JSON.stringify(changes), reason?.trim() || null, actor.userId, now.toISOString());
    const requestId = Number(res.lastInsertRowid);
    const approval = createApproval(
      db,
      actor,
      {
        actionType: SETTINGS_CHANGE_ACTION,
        targetEntityType: 'settings_change_request',
        targetEntityId: requestId,
        proposedAction: approvalPayload(requestId, active.version, proposed),
        contentVersion: active.version,
        requiredRole: 'ADMIN',
      },
      now,
    );
    db.prepare('UPDATE settings_change_requests SET approval_id = ? WHERE id = ?').run(approval.id, requestId);
    audit(db, actor, {
      action: 'SETTINGS_CHANGE_PROPOSED',
      entityType: 'settings_change_request',
      entityId: requestId,
      details: { baseVersion: active.version, changes, reason },
    }, now);
    return listChangeRequests(db).find((r) => r.id === requestId)!;
  });
}

function supersede(db: DB, requestId: number, approvalId: string | null, newVersion: number, now: Date) {
  db.prepare(
    `UPDATE settings_change_requests SET status = 'SUPERSEDED', decided_at = ?, decision_notes = ? WHERE id = ? AND status = 'PENDING'`,
  ).run(now.toISOString(), `Superseded by configuration version ${newVersion}; re-propose against the current settings.`, requestId);
  if (approvalId) cancelApproval(db, 'SYSTEM', approvalId, `Superseded by configuration version ${newVersion}`, now);
  audit(db, 'SYSTEM', { action: 'SETTINGS_CHANGE_SUPERSEDED', entityType: 'settings_change_request', entityId: requestId, details: { activeVersion: newVersion } }, now);
}

/**
 * Approves a pending change: verifies the approver reviewed the exact proposal, then in one
 * transaction writes a new immutable version, updates the active rows, and records the decision.
 */
export function approveSettingsChange(
  db: DB,
  actor: Actor,
  requestId: number,
  reviewedHash: string,
  notes: string | null,
  now: Date,
): { version: number } {
  if (!can(actor.role, 'settings.approve')) throw forbidden('Only administrators can approve settings changes');
  const outcome = tx(db, (): { ok: true; version: number } | { ok: false; error: Error } => {
    const req = getRequest(db, requestId);
    if (!req) return { ok: false, error: notFound('Change request not found') };
    if (req.status !== 'PENDING') return { ok: false, error: conflict(`This change request is already ${req.status}`) };
    const active = getActiveSettings(db);
    if (req.base_version !== active.version) {
      supersede(db, req.id, req.approval_id, active.version, now);
      return { ok: false, error: conflict(`This request was based on version ${req.base_version}, but version ${active.version} is now active. It has been marked superseded.`) };
    }
    const proposed = intelligenceConfigSchema.parse(JSON.parse(req.proposed_config_json));
    decideApproval(db, actor, req.approval_id, 'APPROVE', { reviewedHash, notes }, now);

    const newVersion = active.version + 1;
    const vres = db
      .prepare(
        `INSERT INTO settings_versions (version, config_json, config_hash, change_request_id, created_by, approved_by, created_at, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(newVersion, JSON.stringify(proposed), hashContent(proposed), req.id, req.requested_by, actor.userId, now.toISOString(), notes?.trim() || null);
    const versionId = Number(vres.lastInsertRowid);
    writeActiveRows(db, versionId, proposed, now);
    db.prepare(
      `UPDATE settings_change_requests SET status = 'APPROVED', decided_by = ?, decided_at = ?, decision_notes = ?, resulting_version_id = ? WHERE id = ?`,
    ).run(actor.userId, now.toISOString(), notes?.trim() || null, versionId, req.id);
    consumeApproval(
      db,
      req.approval_id,
      { actionType: SETTINGS_CHANGE_ACTION, currentAction: approvalPayload(req.id, req.base_version, proposed) },
      { settingsVersion: newVersion },
      now,
    );
    audit(db, actor, {
      action: 'SETTINGS_CHANGE_APPROVED',
      entityType: 'settings_change_request',
      entityId: req.id,
      details: { fromVersion: active.version, toVersion: newVersion, changes: JSON.parse(req.changes_json), notes },
    }, now);

    // Any other open proposals were drafted against an older version and are now stale.
    const others = db
      .prepare(`SELECT id, approval_id FROM settings_change_requests WHERE status = 'PENDING' AND id != ?`)
      .all(req.id) as { id: number; approval_id: string | null }[];
    for (const o of others) supersede(db, o.id, o.approval_id, newVersion, now);
    return { ok: true, version: newVersion };
  });
  if (!outcome.ok) throw outcome.error;
  return { version: outcome.version };
}

export function rejectSettingsChange(db: DB, actor: Actor, requestId: number, notes: string | null, now: Date): void {
  if (!can(actor.role, 'settings.approve')) throw forbidden('Only administrators can reject settings changes');
  tx(db, () => {
    const req = getRequest(db, requestId);
    if (!req) throw notFound('Change request not found');
    if (req.status !== 'PENDING') throw conflict(`This change request is already ${req.status}`);
    decideApproval(db, actor, req.approval_id, 'REJECT', { notes }, now);
    db.prepare(
      `UPDATE settings_change_requests SET status = 'REJECTED', decided_by = ?, decided_at = ?, decision_notes = ? WHERE id = ?`,
    ).run(actor.userId, now.toISOString(), notes?.trim() || null, requestId);
    audit(db, actor, { action: 'SETTINGS_CHANGE_REJECTED', entityType: 'settings_change_request', entityId: requestId, details: { notes } }, now);
  });
}

/** The requester (or an administrator) may withdraw a pending change. */
export function cancelSettingsChange(db: DB, actor: Actor, requestId: number, notes: string | null, now: Date): void {
  tx(db, () => {
    const req = getRequest(db, requestId);
    if (!req) throw notFound('Change request not found');
    if (req.requested_by !== actor.userId && !can(actor.role, 'settings.approve')) {
      throw forbidden('Only the requester or an administrator can cancel this change request');
    }
    if (req.status !== 'PENDING') throw conflict(`This change request is already ${req.status}`);
    cancelApproval(db, actor, req.approval_id, notes?.trim() || 'Cancelled by user', now);
    db.prepare(
      `UPDATE settings_change_requests SET status = 'CANCELLED', decided_by = ?, decided_at = ?, decision_notes = ? WHERE id = ?`,
    ).run(actor.userId, now.toISOString(), notes?.trim() || null, requestId);
    audit(db, actor, { action: 'SETTINGS_CHANGE_CANCELLED', entityType: 'settings_change_request', entityId: requestId, details: { notes } }, now);
  });
}

export { getApproval };
