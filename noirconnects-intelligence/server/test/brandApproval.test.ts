import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditActions, loginAs, setupEnv, type TestEnv } from './helpers.js';
import { brandRecord, jsonInput, researchFile } from './fixtures.js';
import { commitImport, previewImport } from '../src/services/brandImport.js';
import { decideBrand, getBrandDetail } from '../src/services/brands.js';
import { getApproval } from '../src/services/approvals.js';

let env: TestEnv;
let brandIds: number[];
beforeEach(async () => {
  env = await setupEnv();
  const input = jsonInput(researchFile([brandRecord(1), brandRecord(2), brandRecord(3)]));
  const p = previewImport(env.db, env.users.researcher, input, env.clock.now());
  brandIds = commitImport(env.db, env.users.researcher, input, { expectedInputHash: p.inputHash }, env.clock.now()).imported.map((i) => i.brandId);
});
afterEach(() => env.cleanup());

const now = () => env.clock.now();
const hashOf = (id: number) => getBrandDetail(env.db, id)!.approval!.content_hash;
const count = (sql: string) => (env.db.prepare(sql).get() as { n: number }).n;

describe('brand approval workflow', () => {
  it('APPROVE moves the brand to APPROVED_FOR_OUTREACH and records approver, time and notes', () => {
    const id = brandIds[0]!;
    const hash = hashOf(id);
    env.clock.advance(5 * 60_000);
    expect(decideBrand(env.db, env.users.manager, id, 'APPROVE', { reviewedHash: hash, notes: 'Strong fit' }, now()).status).toBe('APPROVED_FOR_OUTREACH');
    const d = getBrandDetail(env.db, id)!;
    expect(d.brand.status).toBe('APPROVED_FOR_OUTREACH');
    expect(d.decisions).toEqual([{ id: expect.any(Number), decision: 'APPROVED', decided_at: now().toISOString(), notes: 'Strong fit', decided_by: 'manager' }]);
    expect(getApproval(env.db, d.approval!.id)).toMatchObject({ status: 'EXECUTED', decided_by: env.users.manager.userId });
    expect(auditActions(env.db)).toContain('BRAND_APPROVED');
  });

  it('approval authorizes draft preparation only — nothing is sent or queued', () => {
    decideBrand(env.db, env.users.owner, brandIds[0]!, 'APPROVE', { reviewedHash: hashOf(brandIds[0]!) }, now());
    expect(count('SELECT COUNT(*) AS n FROM email_send_attempts')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM email_messages')).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM approvals WHERE action_type LIKE 'SEND%'`)).toBe(0);
  });

  it('DECLINE moves the brand to DECLINED, keeps it searchable, and rejects the approval', async () => {
    const id = brandIds[1]!;
    decideBrand(env.db, env.users.manager, id, 'DECLINE', { notes: 'Budget too small' }, now());
    const d = getBrandDetail(env.db, id)!;
    expect(d.brand.status).toBe('DECLINED');
    expect(d.decisions[0]).toMatchObject({ decision: 'DECLINED', notes: 'Budget too small' });
    expect(getApproval(env.db, d.approval!.id)!.status).toBe('REJECTED');
    const v = await loginAs(env.app, 'viewer@example.test');
    expect((await v.get('/api/search?q=synthetic peripherals 2')).body.brands[0]).toMatchObject({ status: 'DECLINED' });
  });

  it('a brand can only be decided once', () => {
    const id = brandIds[0]!;
    const hash = hashOf(id);
    decideBrand(env.db, env.users.manager, id, 'APPROVE', { reviewedHash: hash }, now());
    expect(() => decideBrand(env.db, env.users.owner, id, 'DECLINE', {}, now())).toThrow(/already been decided/);
    expect(() => decideBrand(env.db, env.users.owner, id, 'APPROVE', { reviewedHash: hash }, now())).toThrow(/already been decided/);
  });

  it('refuses approval if the brand data changed after it was reviewed', () => {
    const id = brandIds[0]!;
    const reviewed = hashOf(id);
    // Simulate the contact being changed after the reviewer looked at it.
    env.db.prepare(`UPDATE brands SET contact_email = 'someone-else@other.example' WHERE id = ?`).run(id);
    expect(() => decideBrand(env.db, env.users.manager, id, 'APPROVE', { reviewedHash: reviewed }, now())).toThrow(/differs from the approved content/);
    expect(getBrandDetail(env.db, id)!.brand.status).toBe('PENDING_BRAND_APPROVAL');
  });

  it('requires the exact reviewed hash', () => {
    expect(() => decideBrand(env.db, env.users.manager, brandIds[0]!, 'APPROVE', { reviewedHash: '0'.repeat(64) }, now())).toThrow(/changed after you reviewed/);
  });

  it('researchers and viewers cannot decide brands', async () => {
    expect(() => decideBrand(env.db, env.users.researcher, brandIds[0]!, 'APPROVE', { reviewedHash: hashOf(brandIds[0]!) }, now())).toThrow(/cannot approve/);
    const v = await loginAs(env.app, 'viewer@example.test');
    expect((await v.post(`/api/brands/${brandIds[0]}/decline`, {})).status).toBe(403);
    const r = await loginAs(env.app, 'researcher@example.test');
    expect((await r.post(`/api/brands/${brandIds[0]}/approve`, { reviewedHash: hashOf(brandIds[0]!) })).status).toBe(403);
  });

  it('simultaneous decisions over HTTP: exactly one wins', async () => {
    const id = brandIds[2]!;
    const a = await loginAs(env.app, 'owner@example.test');
    const m = await loginAs(env.app, 'manager@example.test');
    const [r1, r2] = await Promise.all([
      a.post(`/api/brands/${id}/approve`, { reviewedHash: hashOf(id) }),
      m.post(`/api/brands/${id}/decline`, { notes: 'no' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(count(`SELECT COUNT(*) AS n FROM brand_approvals WHERE brand_id = ${id}`)).toBe(1);
  });

  it('HTTP: list the queue, open a profile, approve with the reviewed hash', async () => {
    const m = await loginAs(env.app, 'manager@example.test');
    const queue = await m.get('/api/brands?status=PENDING_BRAND_APPROVAL&sort=score');
    expect(queue.body.total).toBe(3);
    const id = queue.body.brands[0].id;
    const detail = await m.get(`/api/brands/${id}`);
    expect(detail.body.evidence.length).toBeGreaterThan(0);
    expect(detail.body.brand.quality_breakdown.total).toBe(detail.body.brand.quality_score);
    const res = await m.post(`/api/brands/${id}/approve`, { reviewedHash: detail.body.approval.content_hash, notes: 'ok' });
    expect(res.status).toBe(200);
    const after = await m.get('/api/overview');
    expect(after.body.metrics.brandsAwaitingApproval).toBe(2);
  });
});
