import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, setupEnv, type TestEnv } from './helpers.js';
import { startOfDayInTimeZone } from '../src/lib/util.js';
import { approveSettingsChange, getActiveSettings, proposeSettingsChange } from '../src/services/settings.js';

let env: TestEnv;
beforeEach(async () => { env = await setupEnv(); });
afterEach(() => env.cleanup());

function insertBrand(domain: string, status: string, createdAt: string) {
  const v = getActiveSettings(env.db).versionId;
  env.db
    .prepare(
      `INSERT INTO brands (name, normalized_name, website_url, website_domain, discovery_niche, settings_version_id, researched_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Gaming', ?, ?, ?, ?, ?)`,
    )
    .run(domain, domain, `https://${domain}`, domain, v, createdAt, status, createdAt, createdAt);
}

describe('overview metrics', () => {
  it('reports zero for every metric on a fresh database (no fabricated numbers)', async () => {
    const o = await loginAs(env.app, 'viewer@example.test');
    const res = await o.get('/api/overview');
    expect(res.status).toBe(200);
    for (const value of Object.values(res.body.metrics)) expect(value).toBe(0);
    expect(res.body.integrations.mail.status).toBe('NOT_CONFIGURED');
    expect(res.body.lastSuccessfulResearchRun).toBeNull();
  });

  it('derives counts from database records', async () => {
    const today = env.clock.now().toISOString();
    insertBrand('a.example', 'PENDING_BRAND_APPROVAL', today);
    insertBrand('b.example', 'PENDING_BRAND_APPROVAL', today);
    insertBrand('c.example', 'DORMANT_OUTREACH', '2026-01-01T00:00:00.000Z');
    insertBrand('d.example', 'CREATOR_RESEARCH_RECOMMENDED', '2026-01-01T00:00:00.000Z');
    insertBrand('e.example', 'SHORTLIST_IN_REVIEW', '2026-01-01T00:00:00.000Z');
    const o = await loginAs(env.app, 'viewer@example.test');
    const { metrics } = (await o.get('/api/overview')).body;
    expect(metrics).toMatchObject({
      brandsDiscoveredToday: 2,
      brandsAwaitingApproval: 2,
      dormantOutreach: 1,
      brandsRequestingCreators: 1,
      shortlistsAwaitingApproval: 1,
      emailsSent: 0,
    });
  });

  it('"today" follows the configured business time zone', () => {
    // 2026-03-02T10:00Z is 2026-03-02 05:00 in New York (EST, UTC-5).
    const now = env.clock.now();
    expect(startOfDayInTimeZone(now, 'UTC').toISOString()).toBe('2026-03-02T00:00:00.000Z');
    expect(startOfDayInTimeZone(now, 'America/New_York').toISOString()).toBe('2026-03-02T05:00:00.000Z');
    expect(startOfDayInTimeZone(now, 'Asia/Tokyo').toISOString()).toBe('2026-03-01T15:00:00.000Z');
    // Across a DST change (US DST starts 2026-03-08).
    expect(startOfDayInTimeZone(new Date('2026-03-08T12:00:00Z'), 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(startOfDayInTimeZone(new Date('2026-03-09T12:00:00Z'), 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');

    const req = proposeSettingsChange(env.db, env.users.owner, { businessTimeZone: 'Asia/Tokyo' }, null, now);
    approveSettingsChange(env.db, env.users.owner, req.id, req.content_hash!, null, now);
    insertBrand('late.example', 'PENDING_BRAND_APPROVAL', '2026-03-01T16:00:00.000Z'); // Mar 2 01:00 Tokyo
    insertBrand('early.example', 'PENDING_BRAND_APPROVAL', '2026-03-01T14:00:00.000Z'); // Mar 1 23:00 Tokyo
    return loginAs(env.app, 'viewer@example.test')
      .then((o) => o.get('/api/overview'))
      .then((res) => expect(res.body.metrics.brandsDiscoveredToday).toBe(1));
  });

  it('global search finds brands by name or domain', async () => {
    insertBrand('razer.example', 'DECLINED', env.clock.now().toISOString());
    const o = await loginAs(env.app, 'viewer@example.test');
    const res = await o.get('/api/search?q=razer');
    expect(res.body.brands).toHaveLength(1);
    expect(res.body.brands[0].status).toBe('DECLINED');
    expect((await o.get('/api/search?q=%25')).body.brands).toHaveLength(0);
  });
});
