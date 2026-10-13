import { Router } from 'express';
import { z } from 'zod';
import type { RouteContext } from './context.js';
import { actorOf, requirePermission } from '../auth/middleware.js';
import { decideBrand, getBrandDetail, listBrandNiches, listBrands } from '../services/brands.js';
import { notFound } from '../lib/errors.js';

const idParam = z.coerce.number().int().positive();

export function brandRoutes(ctx: RouteContext) {
  const r = Router();

  r.get('/', requirePermission('dashboard.view'), (req, res) => {
    const q = z
      .object({
        status: z.string().max(60).optional(),
        q: z.string().max(100).optional(),
        niche: z.string().max(80).optional(),
        sort: z.enum(['score', 'recent', 'name']).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
    res.json(listBrands(ctx.db, q));
  });

  r.get('/niches', requirePermission('dashboard.view'), (_req, res) => {
    res.json({ niches: listBrandNiches(ctx.db) });
  });

  r.get('/:id', requirePermission('dashboard.view'), (req, res) => {
    const detail = getBrandDetail(ctx.db, idParam.parse(req.params.id));
    if (!detail) throw notFound('Brand not found');
    res.json(detail);
  });

  const decision = z.object({ reviewedHash: z.string().length(64).optional(), notes: z.string().trim().max(2000).nullish() });

  r.post('/:id/approve', requirePermission('brands.decide'), (req, res) => {
    const body = decision.parse(req.body ?? {});
    res.json(decideBrand(ctx.db, actorOf(req), idParam.parse(req.params.id), 'APPROVE', { reviewedHash: body.reviewedHash, notes: body.notes }, ctx.clock()));
  });

  r.post('/:id/decline', requirePermission('brands.decide'), (req, res) => {
    const body = decision.parse(req.body ?? {});
    res.json(decideBrand(ctx.db, actorOf(req), idParam.parse(req.params.id), 'DECLINE', { notes: body.notes }, ctx.clock()));
  });

  return r;
}
