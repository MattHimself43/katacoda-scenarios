import { Router } from 'express';
import { z } from 'zod';
import type { RouteContext } from './context.js';
import { actorOf, requirePermission } from '../auth/middleware.js';
import { commitImport, previewImport, type ImportInput } from '../services/brandImport.js';
import { getResearchRunResults, listResearchRuns } from '../services/researchRuns.js';
import { brandResearchJsonSchema, CSV_COLUMNS } from '../domain/brandResearch.js';
import { notFound } from '../lib/errors.js';

const MAX_CONTENT = 4_000_000;

const importInput = z.object({
  format: z.enum(['JSON', 'CSV']),
  content: z.string().min(1).max(MAX_CONTENT),
  fileName: z.string().max(255).nullish(),
  csvMeta: z.object({ configVersion: z.number().int().positive(), niche: z.string().trim().min(1).max(80) }).nullish(),
});

export function researchRoutes(ctx: RouteContext) {
  const r = Router();

  r.get('/brand-schema', requirePermission('dashboard.view'), (_req, res) => {
    res.json({ jsonSchema: brandResearchJsonSchema(), csvColumns: CSV_COLUMNS });
  });

  r.post('/brand-imports/preview', requirePermission('research.import'), (req, res) => {
    const body = importInput.parse(req.body);
    res.json({ analysis: previewImport(ctx.db, actorOf(req), body as ImportInput, ctx.clock()) });
  });

  r.post('/brand-imports/commit', requirePermission('research.import'), (req, res) => {
    const body = importInput
      .extend({
        expectedInputHash: z.string().length(64),
        acceptOutdatedConfig: z.boolean().optional(),
        includePossibleDuplicates: z.array(z.number().int().min(0)).max(200).optional(),
      })
      .parse(req.body);
    const { expectedInputHash, acceptOutdatedConfig, includePossibleDuplicates, ...input } = body;
    const result = commitImport(ctx.db, actorOf(req), input as ImportInput, { expectedInputHash, acceptOutdatedConfig, includePossibleDuplicates }, ctx.clock());
    res.status(201).json(result);
  });

  r.get('/runs', requirePermission('dashboard.view'), (req, res) => {
    const runType = z.enum(['BRAND_DISCOVERY', 'CREATOR_DISCOVERY']).optional().parse(req.query.type || undefined);
    res.json({ runs: listResearchRuns(ctx.db, { runType }) });
  });

  r.get('/runs/:id/results', requirePermission('dashboard.view'), (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const results = getResearchRunResults(ctx.db, id);
    if (!results) throw notFound('Research run not found');
    res.json({ results });
  });

  return r;
}
