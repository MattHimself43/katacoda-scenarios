import { Router } from 'express';
import { z } from 'zod';
import type { RouteContext } from './context.js';
import { actorOf, requirePermission } from '../auth/middleware.js';
import { getOverview } from '../services/overview.js';
import { globalSearch } from '../services/search.js';
import { listAuditActions, listAuditLogs } from '../services/audit.js';
import { createUser, listUsers, resetPassword, updateUser } from '../services/users.js';
import { listApprovals } from '../services/approvals.js';
import { APPROVAL_STATUS, ROLES } from '../domain/statuses.js';

export function overviewRoutes(ctx: RouteContext) {
  const r = Router();
  r.get('/overview', requirePermission('dashboard.view'), (_req, res) => {
    res.json(getOverview(ctx.db, ctx.clock()));
  });
  r.get('/search', requirePermission('dashboard.view'), (req, res) => {
    const q = z.string().max(100).default('').parse(req.query.q ?? '');
    res.json(globalSearch(ctx.db, q));
  });
  return r;
}

export function auditRoutes(ctx: RouteContext) {
  const r = Router();
  r.get('/', requirePermission('audit.view'), (req, res) => {
    const q = z
      .object({
        action: z.string().max(100).optional(),
        entityType: z.string().max(100).optional(),
        entityId: z.string().max(100).optional(),
        q: z.string().max(200).optional(),
        beforeId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
    res.json({ entries: listAuditLogs(ctx.db, q) });
  });
  r.get('/actions', requirePermission('audit.view'), (_req, res) => {
    res.json({ actions: listAuditActions(ctx.db) });
  });
  return r;
}

export function approvalRoutes(ctx: RouteContext) {
  const r = Router();
  r.get('/', requirePermission('audit.view'), (req, res) => {
    const status = z.enum(APPROVAL_STATUS).optional().parse(req.query.status || undefined);
    res.json({ approvals: listApprovals(ctx.db, { status }) });
  });
  return r;
}

const newUserSchema = z.object({
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(ROLES),
  password: z.string().max(256),
});

export function userRoutes(ctx: RouteContext) {
  const r = Router();
  r.get('/', requirePermission('users.view'), (_req, res) => {
    res.json({ users: listUsers(ctx.db) });
  });
  r.post('/', requirePermission('users.manage'), async (req, res) => {
    const body = newUserSchema.parse(req.body);
    const user = await createUser(ctx.db, actorOf(req), body, ctx.clock());
    res.status(201).json({ user });
  });
  r.patch('/:id', requirePermission('users.manage'), (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = z
      .object({ role: z.enum(ROLES).optional(), isActive: z.boolean().optional(), displayName: z.string().trim().min(1).max(120).optional() })
      .strict()
      .parse(req.body);
    res.json({ user: updateUser(ctx.db, actorOf(req), id, body, ctx.clock()) });
  });
  r.post('/:id/password', requirePermission('users.manage'), async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const { password } = z.object({ password: z.string().max(256) }).parse(req.body);
    await resetPassword(ctx.db, actorOf(req), id, password, ctx.clock());
    res.json({ ok: true });
  });
  return r;
}
