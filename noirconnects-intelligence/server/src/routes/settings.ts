import { Router } from 'express';
import { z } from 'zod';
import type { RouteContext } from './context.js';
import { actorOf, requirePermission } from '../auth/middleware.js';
import {
  approveSettingsChange,
  cancelSettingsChange,
  getActiveSettings,
  listChangeRequests,
  listVersions,
  proposeSettingsChange,
  rejectSettingsChange,
} from '../services/settings.js';
import {
  ADMIN_ONLY_PROPOSAL_KEYS,
  DISCOVERY_MODES,
  LOCKED_KEYS,
  NICHE_OPTIONS,
  RESEARCH_FREQUENCIES,
  effectiveNiche,
} from '../domain/config.js';
import { lastSuccessfulRun } from '../services/researchRuns.js';

const idParam = z.coerce.number().int().positive();
const notesSchema = z.string().trim().max(2000).nullish();

export function settingsRoutes(ctx: RouteContext) {
  const r = Router();

  r.get('/', requirePermission('settings.view'), (_req, res) => {
    const active = getActiveSettings(ctx.db);
    const pending = listChangeRequests(ctx.db, { status: 'PENDING' });
    res.json({
      active: { ...active, effectiveNiche: effectiveNiche(active.config) },
      options: { niches: NICHE_OPTIONS, researchFrequencies: RESEARCH_FREQUENCIES, discoveryModes: DISCOVERY_MODES },
      adminOnlyKeys: [...ADMIN_ONLY_PROPOSAL_KEYS],
      lockedKeys: [...LOCKED_KEYS],
      pendingCount: pending.length,
      lastSuccessfulResearchRun: lastSuccessfulRun(ctx.db) ?? null,
      // Reported honestly: no scheduler or Claude sync is configured or verified yet.
      researchScheduling: {
        status: 'NOT_CONFIGURED',
        detail:
          'No scheduled research is connected. Research results are imported manually (Brand Discovery → Import) until a supported, verified scheduled integration exists.',
      },
    });
  });

  r.get('/versions', requirePermission('settings.view'), (_req, res) => {
    res.json({ versions: listVersions(ctx.db) });
  });

  r.get('/change-requests', requirePermission('settings.view'), (req, res) => {
    const status = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED']).optional().parse(req.query.status || undefined);
    res.json({ requests: listChangeRequests(ctx.db, { status }) });
  });

  r.post('/change-requests', requirePermission('settings.propose'), (req, res) => {
    const body = z
      .object({ changes: z.record(z.string(), z.unknown()), reason: z.string().trim().max(2000).nullish() })
      .parse(req.body);
    const request = proposeSettingsChange(ctx.db, actorOf(req), body.changes as never, body.reason ?? null, ctx.clock());
    res.status(201).json({ request });
  });

  r.post('/change-requests/:id/approve', requirePermission('settings.approve'), (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z.object({ reviewedHash: z.string().length(64), notes: notesSchema }).parse(req.body);
    const result = approveSettingsChange(ctx.db, actorOf(req), id, body.reviewedHash, body.notes ?? null, ctx.clock());
    res.json(result);
  });

  r.post('/change-requests/:id/reject', requirePermission('settings.approve'), (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z.object({ notes: notesSchema }).parse(req.body ?? {});
    rejectSettingsChange(ctx.db, actorOf(req), id, body.notes ?? null, ctx.clock());
    res.json({ ok: true });
  });

  r.post('/change-requests/:id/cancel', requirePermission('settings.view'), (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z.object({ notes: notesSchema }).parse(req.body ?? {});
    cancelSettingsChange(ctx.db, actorOf(req), id, body.notes ?? null, ctx.clock());
    res.json({ ok: true });
  });

  return r;
}
