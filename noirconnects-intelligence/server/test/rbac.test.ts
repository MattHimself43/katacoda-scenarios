import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeEach(async () => { env = await setupEnv(); });
afterEach(() => env.cleanup());

describe('role-based access control (unauthorized access attempts)', () => {
  it('viewers can read the dashboard but cannot propose settings changes', async () => {
    const v = await loginAs(env.app, 'viewer@example.test');
    expect((await v.get('/api/overview')).status).toBe(200);
    expect((await v.get('/api/settings')).status).toBe(200);
    const res = await v.post('/api/settings/change-requests', { changes: { activeNiche: 'Fitness' } });
    expect(res.status).toBe(403);
  });

  it('researchers and managers can propose but not approve settings changes', async () => {
    const r = await loginAs(env.app, 'researcher@example.test');
    const created = await r.post('/api/settings/change-requests', { changes: { activeNiche: 'Fitness' } });
    expect(created.status).toBe(201);
    const { id, content_hash } = created.body.request;
    expect((await r.post(`/api/settings/change-requests/${id}/approve`, { reviewedHash: content_hash })).status).toBe(403);
    const m = await loginAs(env.app, 'manager@example.test');
    expect((await m.post(`/api/settings/change-requests/${id}/approve`, { reviewedHash: content_hash })).status).toBe(403);
    expect((await m.post(`/api/settings/change-requests/${id}/reject`, {})).status).toBe(403);
    // Still pending, still version 1.
    const s = await r.get('/api/settings');
    expect(s.body.active.version).toBe(1);
    expect(s.body.pendingCount).toBe(1);
  });

  it('only administrators can propose follow-up policy changes', async () => {
    const m = await loginAs(env.app, 'manager@example.test');
    const policy = { firstFollowUpBusinessDays: 5, secondFollowUpBusinessDays: 4, maxFollowUps: 2, dormantAfterBusinessDays: 4, excludeWeekends: true, requireApproval: true };
    expect((await m.post('/api/settings/change-requests', { changes: { followUpPolicy: policy } })).status).toBe(403);
    const o = await loginAs(env.app, 'owner@example.test');
    expect((await o.post('/api/settings/change-requests', { changes: { followUpPolicy: policy } })).status).toBe(201);
  });

  it('only administrators can view and manage users', async () => {
    const m = await loginAs(env.app, 'manager@example.test');
    expect((await m.get('/api/users')).status).toBe(403);
    expect((await m.post('/api/users', { email: 'x@example.test', displayName: 'X', role: 'ADMIN', password: 'long-enough-password' })).status).toBe(403);
    expect((await m.patch(`/api/users/${env.users.manager.userId}`, { role: 'ADMIN' })).status).toBe(403);
  });

  it('viewers and researchers cannot read the audit log', async () => {
    expect((await (await loginAs(env.app, 'viewer@example.test')).get('/api/audit')).status).toBe(403);
    expect((await (await loginAs(env.app, 'researcher@example.test')).get('/api/audit')).status).toBe(403);
    expect((await (await loginAs(env.app, 'manager@example.test')).get('/api/audit')).status).toBe(200);
  });

  it('protects the owner and the last administrator', async () => {
    const o = await loginAs(env.app, 'owner@example.test');
    expect((await o.patch(`/api/users/${env.users.owner.userId}`, { role: 'VIEWER' })).status).toBe(409);
    expect((await o.patch(`/api/users/${env.users.owner.userId}`, { isActive: false })).status).toBe(409);
    const a2 = await loginAs(env.app, 'admin2@example.test');
    expect((await a2.post(`/api/users/${env.users.owner.userId}/password`, { password: 'another-long-password' })).status).toBe(409);
  });

  it('role changes take effect immediately', async () => {
    const r = await loginAs(env.app, 'researcher@example.test');
    expect((await r.get('/api/settings')).status).toBe(200);
    const o = await loginAs(env.app, 'owner@example.test');
    expect((await o.patch(`/api/users/${env.users.researcher.userId}`, { role: 'VIEWER' })).status).toBe(200);
    // Existing session revoked; re-login has viewer permissions.
    expect((await r.get('/api/settings')).status).toBe(401);
    const r2 = await loginAs(env.app, 'researcher@example.test');
    expect((await r2.post('/api/settings/change-requests', { changes: { activeNiche: 'Travel' } })).status).toBe(403);
  });
});
