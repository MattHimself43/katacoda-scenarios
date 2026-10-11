import type { DB } from '../db/connection.js';
import { tx } from '../db/connection.js';
import type { Actor } from '../auth/actor.js';
import { can } from '../auth/permissions.js';
import { forbidden } from '../lib/errors.js';
import { audit } from './audit.js';
import { getActiveSettings } from './settings.js';
import type { IntelligenceConfig } from '../domain/config.js';

export type RunType = 'BRAND_DISCOVERY' | 'CREATOR_DISCOVERY';
export type RunSource = 'MANUAL_IMPORT' | 'SCHEDULED_IMPORT';

export interface ResearchRun {
  id: number;
  run_type: RunType;
  source: RunSource;
  status: string;
  settings_version_id: number;
  settings_version: number;
  config_snapshot: IntelligenceConfig;
  brand_id: number | null;
  started_by: number | null;
  started_at: string;
  completed_at: string | null;
  records_received: number;
  records_imported: number;
  records_duplicate: number;
  records_rejected: number;
  error_details: unknown;
}

/**
 * Starts a research run pinned to the configuration version active at this instant. The
 * snapshot is read and written inside one IMMEDIATE transaction, so a concurrent settings
 * approval cannot produce a mixed configuration; the snapshot is immutable afterwards
 * (enforced by a database trigger).
 */
export function startResearchRun(
  db: DB,
  actor: Actor | 'SCHEDULER',
  input: { runType: RunType; source: RunSource; brandId?: number; inputFileName?: string; inputHash?: string },
  now: Date,
): ResearchRun {
  if (actor !== 'SCHEDULER' && !can(actor.role, 'research.import')) throw forbidden('Your role cannot start research runs');
  return tx(db, () => {
    const active = getActiveSettings(db);
    const res = db
      .prepare(
        `INSERT INTO research_runs (run_type, source, status, settings_version_id, config_snapshot_json, brand_id, started_by, started_at, input_file_name, input_hash)
         VALUES (?, ?, 'STARTED', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runType,
        input.source,
        active.versionId,
        JSON.stringify(active.config),
        input.brandId ?? null,
        actor === 'SCHEDULER' ? null : actor.userId,
        now.toISOString(),
        input.inputFileName ?? null,
        input.inputHash ?? null,
      );
    const id = Number(res.lastInsertRowid);
    audit(db, actor, { action: 'RESEARCH_RUN_STARTED', entityType: 'research_run', entityId: id, details: { runType: input.runType, source: input.source, settingsVersion: active.version } }, now);
    return getResearchRun(db, id)!;
  });
}

export function getResearchRun(db: DB, id: number): ResearchRun | undefined {
  const row = db
    .prepare(
      `SELECT r.*, sv.version AS settings_version FROM research_runs r JOIN settings_versions sv ON sv.id = r.settings_version_id WHERE r.id = ?`,
    )
    .get(id) as (Record<string, unknown> & { config_snapshot_json: string; error_details_json: string | null }) | undefined;
  if (!row) return undefined;
  const { config_snapshot_json, error_details_json, ...rest } = row;
  return {
    ...(rest as unknown as Omit<ResearchRun, 'config_snapshot' | 'error_details'>),
    config_snapshot: JSON.parse(config_snapshot_json) as IntelligenceConfig,
    error_details: error_details_json ? JSON.parse(error_details_json) : null,
  };
}

export function lastSuccessfulRun(db: DB, runType: RunType = 'BRAND_DISCOVERY') {
  return db
    .prepare(
      `SELECT r.id, r.completed_at, r.records_imported, r.source, sv.version AS settings_version
       FROM research_runs r JOIN settings_versions sv ON sv.id = r.settings_version_id
       WHERE r.run_type = ? AND r.status = 'IMPORTED' ORDER BY r.completed_at DESC LIMIT 1`,
    )
    .get(runType) as { id: number; completed_at: string; records_imported: number; source: string; settings_version: number } | undefined;
}
