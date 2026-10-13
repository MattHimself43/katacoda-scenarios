import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditActions, loginAs, setupEnv, type TestEnv } from './helpers.js';
import {
  approveSettingsChange,
  cancelSettingsChange,
  getActiveSettings,
  listChangeRequests,
  listVersions,
  proposeSettingsChange,
  rejectSettingsChange,
} from '../src/services/settings.js';
import { getApproval } from '../src/services/approvals.js';
import { DEFAULT_CONFIG } from '../src/domain/config.js';

let env: TestEnv;
beforeEach(async () => { env = await setupEnv(); });
afterEach(() => env.cleanup());

const now = () => env.clock.now();

describe('initial configuration', () => {
  it('starts at version 1 with the specified Gaming defaults', () => {
    const s = getActiveSettings(env.db);
    expect(s.version).toBe(1);
    expect(s.config.activeNiche).toBe('Gaming');
    expect(s.config.dailyBrandTarget).toBe(15);
    expect(s.config.targetGeography).toBe('Global — English-speaking');
    expect(s.config.researchFrequency).toBe('DAILY');
    expect(s.config.automaticExternalCommunication).toBe(false);
    expect(s.config.humanApprovalRequired).toBe(true);
    expect(s.config.followUpPolicy).toMatchObject({ firstFollowUpBusinessDays: 4, secondFollowUpBusinessDays: 4, maxFollowUps: 2 });
    expect(s.config.creatorRankingWeights).toEqual(DEFAULT_CONFIG.creatorRankingWeights);
  });
});

describe('settings change approval', () => {
  it('a proposal does not take effect until an administrator approves it', () => {
    const req = proposeSettingsChange(env.db, env.users.researcher, { activeNiche: 'Fitness', dailyBrandTarget: 10 }, 'Q2 focus', now());
    expect(req.status).toBe('PENDING');
    expect(req.changes).toEqual([
      { key: 'activeNiche', from: 'Gaming', to: 'Fitness' },
      { key: 'dailyBrandTarget', from: 15, to: 10 },
    ]);
    expect(getActiveSettings(env.db).config.activeNiche).toBe('Gaming');
    expect(getActiveSettings(env.db).version).toBe(1);
  });

  it('approval writes a new version, updates active settings and records the approver', () => {
    const req = proposeSettingsChange(env.db, env.users.manager, { activeNiche: 'Fitness' }, null, now());
    env.clock.advance(60_000);
    const result = approveSettingsChange(env.db, env.users.owner, req.id, req.content_hash!, 'Looks good', now());
    expect(result.version).toBe(2);
    const active = getActiveSettings(env.db);
    expect(active.version).toBe(2);
    expect(active.config.activeNiche).toBe('Fitness');
    expect(active.approvedBy).toBe('Owner');

    const after = listChangeRequests(env.db).find((r) => r.id === req.id)!;
    expect(after.status).toBe('APPROVED');
    expect(after.resulting_version).toBe(2);
    expect(after.decided_by_name).toBe('Owner');
    expect(getApproval(env.db, req.approval_id!)!.status).toBe('EXECUTED');

    const log = env.db
      .prepare(`SELECT actor_user_id, occurred_at, details_json FROM audit_logs WHERE action = 'SETTINGS_CHANGE_APPROVED'`)
      .get() as { actor_user_id: number; occurred_at: string; details_json: string };
    expect(log.actor_user_id).toBe(env.users.owner.userId);
    expect(log.occurred_at).toBe(now().toISOString());
    expect(JSON.parse(log.details_json)).toMatchObject({ fromVersion: 1, toVersion: 2, changes: [{ key: 'activeNiche', from: 'Gaming', to: 'Fitness' }] });
  });

  it('keeps every historical version and they are immutable', () => {
    const req = proposeSettingsChange(env.db, env.users.owner, { activeNiche: 'Travel' }, null, now());
    approveSettingsChange(env.db, env.users.owner, req.id, req.content_hash!, null, now());
    const versions = listVersions(env.db);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[1]!.config.activeNiche).toBe('Gaming');
    expect(() => env.db.prepare('UPDATE settings_versions SET config_json = ? WHERE version = 1').run('{}')).toThrow(/immutable/);
    expect(() => env.db.prepare('DELETE FROM settings_versions WHERE version = 1').run()).toThrow(/immutable/);
  });

  it('rejects approval when the reviewed content hash does not match', () => {
    const req = proposeSettingsChange(env.db, env.users.manager, { activeNiche: 'Fitness' }, null, now());
    expect(() => approveSettingsChange(env.db, env.users.owner, req.id, 'f'.repeat(64), null, now())).toThrow(/changed after you reviewed/);
    expect(getActiveSettings(env.db).version).toBe(1);
    expect(listChangeRequests(env.db)[0]!.status).toBe('PENDING');
  });

  it('prevents approval reuse and double approval', () => {
    const req = proposeSettingsChange(env.db, env.users.manager, { activeNiche: 'Fitness' }, null, now());
    approveSettingsChange(env.db, env.users.owner, req.id, req.content_hash!, null, now());
    expect(() => approveSettingsChange(env.db, env.users.admin2, req.id, req.content_hash!, null, now())).toThrow(/already APPROVED/);
    expect(getActiveSettings(env.db).version).toBe(2);
  });

  it('simultaneous approvals over HTTP produce exactly one new version', async () => {
    const req = proposeSettingsChange(env.db, env.users.manager, { dailyBrandTarget: 20 }, null, now());
    const a = await loginAs(env.app, 'owner@example.test');
    const b = await loginAs(env.app, 'admin2@example.test');
    const [r1, r2] = await Promise.all([
      a.post(`/api/settings/change-requests/${req.id}/approve`, { reviewedHash: req.content_hash }),
      b.post(`/api/settings/change-requests/${req.id}/approve`, { reviewedHash: req.content_hash }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(listVersions(env.db)).toHaveLength(2);
  });

  it('supersedes other pending requests once one is approved (stale base version)', () => {
    const a = proposeSettingsChange(env.db, env.users.manager, { activeNiche: 'Fitness' }, null, now());
    const b = proposeSettingsChange(env.db, env.users.researcher, { activeNiche: 'Travel' }, null, now());
    approveSettingsChange(env.db, env.users.owner, a.id, a.content_hash!, null, now());
    const bAfter = listChangeRequests(env.db).find((r) => r.id === b.id)!;
    expect(bAfter.status).toBe('SUPERSEDED');
    expect(getApproval(env.db, b.approval_id!)!.status).toBe('CANCELLED');
    expect(() => approveSettingsChange(env.db, env.users.owner, b.id, b.content_hash!, null, now())).toThrow(/already SUPERSEDED/);
    expect(getActiveSettings(env.db).config.activeNiche).toBe('Fitness');
  });

  it('supports rejection with notes', () => {
    const req = proposeSettingsChange(env.db, env.users.manager, { activeNiche: 'Beauty' }, null, now());
    rejectSettingsChange(env.db, env.users.owner, req.id, 'Not this quarter', now());
    const r = listChangeRequests(env.db)[0]!;
    expect(r.status).toBe('REJECTED');
    expect(r.decision_notes).toBe('Not this quarter');
    expect(getApproval(env.db, req.approval_id!)!.status).toBe('REJECTED');
    expect(getActiveSettings(env.db).config.activeNiche).toBe('Gaming');
  });

  it('allows the requester (or an admin) to cancel, but not other users', () => {
    const req = proposeSettingsChange(env.db, env.users.researcher, { activeNiche: 'Beauty' }, null, now());
    expect(() => cancelSettingsChange(env.db, env.users.manager, req.id, null, now())).toThrow(/Only the requester/);
    cancelSettingsChange(env.db, env.users.researcher, req.id, 'Changed my mind', now());
    expect(listChangeRequests(env.db)[0]!.status).toBe('CANCELLED');
    expect(getApproval(env.db, req.approval_id!)!.status).toBe('CANCELLED');
  });

  it('validates proposals', () => {
    const p = (patch: object) => () => proposeSettingsChange(env.db, env.users.owner, patch as never, null, now());
    expect(p({ activeNiche: 'Custom' })).toThrow(/Invalid configuration/);
    expect(p({ activeNiche: 'Underwater Basket Weaving' })).toThrow(/Invalid configuration/);
    expect(p({ dailyBrandTarget: 0 })).toThrow(/Invalid configuration/);
    expect(p({ creatorRankingWeights: { relevance: 50, engagement: 25, contentQuality: 20, sponsorshipSuitability: 15, budgetPracticality: 10 } })).toThrow(/Invalid configuration/);
    expect(p({ automaticExternalCommunication: true })).toThrow(/Invalid configuration/);
    expect(p({ unknownKey: 1 })).toThrow(/Invalid configuration/);
    expect(p({ activeNiche: 'Gaming' })).toThrow(/identical/);
    expect(p({ businessTimeZone: 'Mars/Olympus_Mons' })).toThrow(/Invalid configuration/);
  });

  it('accepts a custom niche and clears it when switching back to a predefined niche', () => {
    const r1 = proposeSettingsChange(env.db, env.users.owner, { activeNiche: 'Custom', customNiche: 'Esports Coaching' }, null, now());
    approveSettingsChange(env.db, env.users.owner, r1.id, r1.content_hash!, null, now());
    expect(getActiveSettings(env.db).config.customNiche).toBe('Esports Coaching');
    const r2 = proposeSettingsChange(env.db, env.users.owner, { activeNiche: 'Gaming' }, null, now());
    expect(r2.proposed_config.customNiche).toBeNull();
  });

  it('opening or reading settings never counts as approval', async () => {
    proposeSettingsChange(env.db, env.users.manager, { activeNiche: 'Fitness' }, null, now());
    const o = await loginAs(env.app, 'owner@example.test');
    await o.get('/api/settings');
    await o.get('/api/settings/change-requests');
    await o.get('/api/settings/versions');
    expect(getActiveSettings(env.db).version).toBe(1);
    expect(auditActions(env.db)).not.toContain('SETTINGS_CHANGE_APPROVED');
  });

  it('end-to-end over HTTP: propose → review → approve', async () => {
    const m = await loginAs(env.app, 'manager@example.test');
    const created = await m.post('/api/settings/change-requests', { changes: { activeNiche: 'Technology', minBrandQualityScore: 70 }, reason: 'Expand' });
    expect(created.status).toBe(201);
    const o = await loginAs(env.app, 'owner@example.test');
    const pending = await o.get('/api/settings/change-requests?status=PENDING');
    const req = pending.body.requests[0];
    expect(req.changes).toHaveLength(2);
    const approved = await o.post(`/api/settings/change-requests/${req.id}/approve`, { reviewedHash: req.content_hash, notes: 'ok' });
    expect(approved.status).toBe(200);
    expect(approved.body.version).toBe(2);
    const s = await o.get('/api/settings');
    expect(s.body.active.effectiveNiche).toBe('Technology');
    expect(s.body.active.version).toBe(2);
  });
});
