import type { DB } from '../db/connection.js';
import { BRAND_STATUS } from '../domain/statuses.js';
import { startOfDayInTimeZone } from '../lib/util.js';
import { getActiveSettings } from './settings.js';
import { lastSuccessfulRun } from './researchRuns.js';
import { effectiveNiche } from '../domain/config.js';

const count = (db: DB, sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n;

/** Every number here is computed from the database at request time. Nothing is estimated. */
export function getOverview(db: DB, now: Date) {
  const settings = getActiveSettings(db);
  const tz = settings.config.businessTimeZone;
  const dayStart = startOfDayInTimeZone(now, tz).toISOString();
  const nowIso = now.toISOString();

  const metrics = {
    brandsDiscoveredToday: count(db, 'SELECT COUNT(*) AS n FROM brands WHERE created_at >= ?', dayStart),
    brandsAwaitingApproval: count(db, 'SELECT COUNT(*) AS n FROM brands WHERE status = ?', BRAND_STATUS.PENDING_BRAND_APPROVAL),
    emailDraftsAwaitingApproval: count(
      db,
      `SELECT COUNT(*) AS n FROM outreach_drafts WHERE status IN ('PENDING_EMAIL_APPROVAL','PENDING_FOLLOWUP_APPROVAL')`,
    ),
    emailsSent: count(
      db,
      `SELECT COUNT(*) AS n FROM email_send_attempts WHERE status = 'SUCCEEDED'`,
    ),
    responsesReceived: count(db, `SELECT COUNT(*) AS n FROM email_messages WHERE direction = 'INBOUND' AND brand_id IS NOT NULL`),
    followUpsDue: count(db, `SELECT COUNT(*) AS n FROM followup_jobs WHERE status = 'SCHEDULED' AND due_at <= ?`, nowIso),
    brandsRequestingCreators: count(
      db,
      'SELECT COUNT(*) AS n FROM brands WHERE status = ?',
      BRAND_STATUS.CREATOR_RESEARCH_RECOMMENDED,
    ),
    shortlistsAwaitingApproval: count(db, 'SELECT COUNT(*) AS n FROM brands WHERE status = ?', BRAND_STATUS.SHORTLIST_IN_REVIEW),
    proposalsAwaitingApproval: count(db, `SELECT COUNT(*) AS n FROM proposals WHERE status = 'PENDING_PROPOSAL_APPROVAL'`),
    dormantOutreach: count(db, 'SELECT COUNT(*) AS n FROM brands WHERE status = ?', BRAND_STATUS.DORMANT_OUTREACH),
  };

  const pendingSettingsChanges = count(db, `SELECT COUNT(*) AS n FROM settings_change_requests WHERE status = 'PENDING'`);
  const lastRun = lastSuccessfulRun(db);

  return {
    generatedAt: nowIso,
    dayStartsAt: dayStart,
    timeZone: tz,
    metrics,
    pendingSettingsChanges,
    configuration: {
      version: settings.version,
      niche: effectiveNiche(settings.config),
      dailyBrandTarget: settings.config.dailyBrandTarget,
    },
    lastSuccessfulResearchRun: lastRun ?? null,
    // Integration status is reported honestly: nothing is shown as connected until verified.
    integrations: {
      mail: { status: 'NOT_CONFIGURED', detail: 'Hostinger Mail integration is built in Phase 3 and not yet connected.' },
      research: { status: 'NOT_CONFIGURED', detail: 'Research import is built in Phase 2. No scheduled Claude research sync is verified.' },
      scheduler: { status: 'NOT_CONFIGURED', detail: 'Deterministic job scheduler is built in Phase 4.' },
    },
  };
}
