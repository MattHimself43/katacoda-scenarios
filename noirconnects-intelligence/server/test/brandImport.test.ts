import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, setupEnv, type TestEnv } from './helpers.js';
import { brandRecord, jsonInput, researchFile } from './fixtures.js';
import { commitImport, previewImport } from '../src/services/brandImport.js';
import { approveSettingsChange, proposeSettingsChange } from '../src/services/settings.js';
import { decideBrand, getBrandDetail } from '../src/services/brands.js';
import { getResearchRun } from '../src/services/researchRuns.js';
import { getApproval } from '../src/services/approvals.js';

let env: TestEnv;
beforeEach(async () => { env = await setupEnv(); });
afterEach(() => env.cleanup());

const now = () => env.clock.now();
const count = (sql: string) => (env.db.prepare(sql).get() as { n: number }).n;

function importFile(file: unknown, opts: { acceptOutdatedConfig?: boolean; includePossibleDuplicates?: number[] } = {}, fileName?: string) {
  const input = jsonInput(file, fileName);
  const preview = previewImport(env.db, env.users.researcher, input, now());
  return { preview, result: commitImport(env.db, env.users.researcher, input, { expectedInputHash: preview.inputHash, ...opts }, now()) };
}

describe('research import preview', () => {
  it('validates and scores records without writing anything', () => {
    const file = researchFile([brandRecord(1), brandRecord(2)]);
    const a = previewImport(env.db, env.users.researcher, jsonInput(file), now());
    expect(a.fileErrors).toEqual([]);
    expect(a.summary).toMatchObject({ received: 2, NEW: 2 });
    expect(a.records[0]!.domain).toBe('synthetic-peripherals-1.example');
    expect(a.records[0]!.score!.total).toBeGreaterThanOrEqual(60);
    expect(a.config).toMatchObject({ version: 1, niche: 'Gaming', outdated: false, dailyBrandTarget: 15 });
    expect(count('SELECT COUNT(*) AS n FROM brands')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM research_runs')).toBe(0);
  });

  it('reports record-level errors without rejecting the whole file', () => {
    const file = researchFile([
      brandRecord(1),
      brandRecord(2, { evidence: [] }),
      brandRecord(3, { evidence: [{ type: 'PAID_SPONSORSHIP', description: 'Claimed sponsorship', sourceUrl: null, date: null, verified: false }] }),
      brandRecord(4, { website: 'http://localhost' }),
      brandRecord(5, { evidence: [{ type: 'PAID_SPONSORSHIP', description: 'Verified but unsourced', date: null, verified: true }] }),
      brandRecord(6, { evidence: [{ type: 'PAID_SPONSORSHIP', description: 'From the future', sourceUrl: 'https://v.example/f', date: '2027-01-01', verified: true }] }),
      brandRecord(7, { budget: '$50k' }),
      'not an object',
    ]);
    const a = previewImport(env.db, env.users.researcher, jsonInput(file), now());
    const outcomes = a.records.map((r) => r.outcome);
    expect(outcomes).toEqual(['NEW', 'INVALID', 'INVALID', 'INVALID', 'INVALID', 'INVALID', 'INVALID', 'INVALID']);
    expect(a.records[1]!.errors.join()).toMatch(/At least one piece of influencer marketing evidence/);
    expect(a.records[2]!.errors.join()).toMatch(/No verifiable evidence/);
    expect(a.records[4]!.errors.join()).toMatch(/Verified evidence must include a sourceUrl/);
    expect(a.records[5]!.errors.join()).toMatch(/in the future/);
    expect(a.records[6]!.errors.join()).toMatch(/budget/); // unknown fields (e.g. invented budgets) are rejected
  });

  it('rejects files with an unknown schema, configuration version or mismatched niche', () => {
    const errs = (f: unknown) => previewImport(env.db, env.users.researcher, jsonInput(f), now()).fileErrors.join(' ');
    expect(errs(researchFile([brandRecord(1)], { schemaVersion: 'v0' }))).toMatch(/schemaVersion/);
    expect(errs(researchFile([brandRecord(1)], { configVersion: 7 }))).toMatch(/v7 does not exist/);
    expect(errs(researchFile([brandRecord(1)], { niche: 'Beauty' }))).toMatch(/targets "Gaming"/);
    expect(previewImport(env.db, env.users.researcher, { format: 'JSON', content: '{nope' }, now()).fileErrors.join()).toMatch(/Not valid JSON/);
  });
});

describe('research import commit', () => {
  it('imports brands transactionally into the approval queue, pinned to the configuration version', () => {
    const { result } = importFile(researchFile([brandRecord(1), brandRecord(2)]));
    expect(result.imported).toHaveLength(2);
    const run = getResearchRun(env.db, result.runId)!;
    expect(run).toMatchObject({ status: 'IMPORTED', settings_version: 1, records_received: 2, records_imported: 2, source: 'MANUAL_IMPORT' });

    const detail = getBrandDetail(env.db, result.imported[0]!.brandId)!;
    expect(detail.brand).toMatchObject({
      status: 'PENDING_BRAND_APPROVAL',
      website_domain: 'synthetic-peripherals-1.example',
      discovery_niche: 'Gaming',
      settings_version: 1,
      research_run_id: result.runId,
      contact_email_verified: 1,
      researched_at: '2026-03-01T09:00:00.000Z',
    });
    expect(detail.evidence).toHaveLength(2);
    expect(detail.approval).toMatchObject({ status: 'PENDING' });
    expect(getApproval(env.db, detail.approval!.id)).toMatchObject({ action_type: 'BRAND_QUALIFICATION', required_role: 'MANAGER' });
  });

  it('feeds the overview counts', async () => {
    importFile(researchFile([brandRecord(1), brandRecord(2), brandRecord(3)]));
    const o = await loginAs(env.app, 'viewer@example.test');
    const { metrics } = (await o.get('/api/overview')).body;
    expect(metrics.brandsDiscoveredToday).toBe(3);
    expect(metrics.brandsAwaitingApproval).toBe(3);
  });

  it('refuses to commit content that differs from the preview', () => {
    const preview = previewImport(env.db, env.users.researcher, jsonInput(researchFile([brandRecord(1)])), now());
    expect(() =>
      commitImport(env.db, env.users.researcher, jsonInput(researchFile([brandRecord(1), brandRecord(2)])), { expectedInputHash: preview.inputHash }, now()),
    ).toThrow(/differs from the one you previewed/);
    expect(count('SELECT COUNT(*) AS n FROM brands')).toBe(0);
  });

  it('records failed imports in run history', () => {
    const input = jsonInput(researchFile([brandRecord(1)], { configVersion: 9 }));
    const preview = previewImport(env.db, env.users.researcher, input, now());
    expect(() => commitImport(env.db, env.users.researcher, input, { expectedInputHash: preview.inputHash }, now())).toThrow(/could not be imported/);
    const run = env.db.prepare(`SELECT status, error_details_json FROM research_runs`).get() as { status: string; error_details_json: string };
    expect(run.status).toBe('FAILED');
    expect(run.error_details_json).toMatch(/v9 does not exist/);
    expect(count('SELECT COUNT(*) AS n FROM brands')).toBe(0);
  });

  it('excludes brands below the configured minimum quality score', () => {
    const weak = brandRecord(2, {
      contactEmail: null,
      contactChannelUrl: null,
      subcategory: null,
      productsServices: null,
      evidence: [{ type: 'AFFILIATE_PROGRAM', description: 'Open affiliate program', sourceUrl: 'https://x.example/aff', date: null, verified: false }],
    });
    const { preview, result } = importFile(researchFile([brandRecord(1), weak]));
    expect(preview.records[1]!.outcome).toBe('BELOW_THRESHOLD');
    expect(result.imported.map((i) => i.index)).toEqual([0]);
    expect(getResearchRun(env.db, result.runId)!.records_rejected).toBe(1);
  });
});

describe('duplicate lead prevention', () => {
  it('never re-imports the same file twice', () => {
    const file = researchFile([brandRecord(1)]);
    importFile(file);
    const preview = previewImport(env.db, env.users.researcher, jsonInput(file), now());
    expect(preview.alreadyImported).not.toBeNull();
    expect(() => commitImport(env.db, env.users.researcher, jsonInput(file), { expectedInputHash: preview.inputHash }, now())).toThrow(/already imported/);
  });

  it('detects duplicates by normalized domain, including subdomain/www variants and in-file repeats', () => {
    importFile(researchFile([brandRecord(1)]));
    const { preview, result } = importFile(
      researchFile([
        brandRecord(1, { name: 'Renamed Brand', website: 'http://shop.synthetic-peripherals-1.example/en' }),
        brandRecord(2),
        brandRecord(2, { name: 'Again' }),
      ], { generatedAt: '2026-03-02T09:00:00.000Z' }),
    );
    expect(preview.records.map((r) => r.outcome)).toEqual(['DUPLICATE', 'NEW', 'DUPLICATE_IN_FILE']);
    expect(preview.records[0]!.existingBrand!.domain).toBe('synthetic-peripherals-1.example');
    expect(result.imported).toHaveLength(1);
    expect(count('SELECT COUNT(*) AS n FROM brands')).toBe(2);
  });

  it('declined brands are never rediscovered as new leads', () => {
    const { result } = importFile(researchFile([brandRecord(1)]));
    const id = result.imported[0]!.brandId;
    decideBrand(env.db, env.users.manager, id, 'DECLINE', { notes: 'Not a fit' }, now());
    const { preview } = importFile(researchFile([brandRecord(1)], { generatedAt: '2026-03-02T09:30:00.000Z' }));
    expect(preview.records[0]!.outcome).toBe('DUPLICATE');
    expect(preview.records[0]!.existingBrand!.status).toBe('DECLINED');
    expect(count('SELECT COUNT(*) AS n FROM brands')).toBe(1);
  });

  it('flags same-name/different-domain records and imports them only when explicitly included', () => {
    importFile(researchFile([brandRecord(1)]));
    const file = researchFile([brandRecord(9, { name: 'Synthetic Peripherals 1 Inc.' })], { generatedAt: '2026-03-02T09:45:00.000Z' });
    const input = jsonInput(file);
    const preview = previewImport(env.db, env.users.researcher, input, now());
    expect(preview.records[0]!.outcome).toBe('POSSIBLE_DUPLICATE');
    const skipped = commitImport(env.db, env.users.researcher, input, { expectedInputHash: preview.inputHash }, now());
    expect(skipped.imported).toHaveLength(0);
    const file2 = researchFile([brandRecord(9, { name: 'Synthetic Peripherals 1 Inc.' })], { generatedAt: '2026-03-02T09:50:00.000Z' });
    const p2 = previewImport(env.db, env.users.researcher, jsonInput(file2), now());
    const forced = commitImport(env.db, env.users.researcher, jsonInput(file2), { expectedInputHash: p2.inputHash, includePossibleDuplicates: [0] }, now());
    expect(forced.imported).toHaveLength(1);
  });

  it('the database enforces one brand per domain even if checks are bypassed', () => {
    importFile(researchFile([brandRecord(1)]));
    expect(() =>
      env.db
        .prepare(`INSERT INTO brands (name, normalized_name, website_url, website_domain, discovery_niche, settings_version_id, researched_at, created_at, updated_at)
                  VALUES ('x','x','https://x','synthetic-peripherals-1.example','Gaming',1,'t','t','t')`)
        .run(),
    ).toThrow(/UNIQUE/);
  });
});

describe('configuration version validation', () => {
  it('requires confirmation for research produced under an older version and keeps that version', () => {
    const req = proposeSettingsChange(env.db, env.users.owner, { minBrandQualityScore: 65 }, null, now());
    approveSettingsChange(env.db, env.users.owner, req.id, req.content_hash!, null, now());

    const input = jsonInput(researchFile([brandRecord(1)])); // configVersion 1
    const preview = previewImport(env.db, env.users.researcher, input, now());
    expect(preview.config).toMatchObject({ version: 1, activeVersion: 2, outdated: true });
    expect(preview.fileWarnings.join()).toMatch(/older|v2/);
    expect(() => commitImport(env.db, env.users.researcher, input, { expectedInputHash: preview.inputHash }, now())).toThrow(/older configuration/);
    const res = commitImport(env.db, env.users.researcher, input, { expectedInputHash: preview.inputHash, acceptOutdatedConfig: true }, now());
    expect(getResearchRun(env.db, res.runId)!.settings_version).toBe(1);
    expect(getBrandDetail(env.db, res.imported[0]!.brandId)!.brand.settings_version).toBe(1);
  });

  it('existing leads are untouched when the niche changes', () => {
    const { result } = importFile(researchFile([brandRecord(1)]));
    const req = proposeSettingsChange(env.db, env.users.owner, { activeNiche: 'Fitness' }, null, now());
    approveSettingsChange(env.db, env.users.owner, req.id, req.content_hash!, null, now());
    const b = getBrandDetail(env.db, result.imported[0]!.brandId)!.brand;
    expect(b).toMatchObject({ status: 'PENDING_BRAND_APPROVAL', discovery_niche: 'Gaming' });
    // A Gaming file can no longer claim the new active version.
    const errs = previewImport(env.db, env.users.researcher, jsonInput(researchFile([brandRecord(2)], { configVersion: 2 })), now()).fileErrors;
    expect(errs.join()).toMatch(/targets "Fitness"/);
  });
});

describe('CSV and HTTP import', () => {
  it('imports a CSV through the API with preview → commit', async () => {
    const header =
      'name,website,industry,subcategory,target_markets,products_services,influencer_activity_summary,recommendation_reason,researched_at,contact_name,contact_name_verified,contact_role,contact_role_verified,contact_email,contact_email_verified,contact_channel_url,evidence_type,evidence_description,evidence_source_url,evidence_date,evidence_creator_name,evidence_platform,evidence_verified';
    const csv = `${header}\nCsv Controllers,https://csv-controllers.example,Gaming,Controllers and accessories,US,Gamepads,Sponsors streamers,Fit,,,,,,deals@csv-controllers.example,true,,PAID_SPONSORSHIP,Sponsored stream segment,https://stream.example/1,2026-02-10,Streamer,Twitch,true\n`;
    const r = await loginAs(env.app, 'researcher@example.test');
    const body = { format: 'CSV', content: csv, fileName: 'leads.csv', csvMeta: { configVersion: 1, niche: 'Gaming' } };
    const preview = await r.post('/api/research/brand-imports/preview', body);
    expect(preview.status).toBe(200);
    expect(preview.body.analysis.summary.NEW).toBe(1);
    const commit = await r.post('/api/research/brand-imports/commit', { ...body, expectedInputHash: preview.body.analysis.inputHash });
    expect(commit.status).toBe(201);
    const runs = await r.get('/api/research/runs');
    expect(runs.body.runs[0]).toMatchObject({ status: 'IMPORTED', input_format: 'CSV', records_imported: 1, settings_version: 1, niche: 'Gaming' });
    const list = await r.get('/api/brands?status=PENDING_BRAND_APPROVAL');
    expect(list.body.total).toBe(1);
    expect(list.body.brands[0]).toMatchObject({ name: 'Csv Controllers', partnership_evidence: 1 });
  });

  it('viewers cannot import research', async () => {
    const v = await loginAs(env.app, 'viewer@example.test');
    const res = await v.post('/api/research/brand-imports/preview', jsonInput(researchFile([brandRecord(1)])));
    expect(res.status).toBe(403);
  });

  it('publishes the JSON Schema for research producers', async () => {
    const v = await loginAs(env.app, 'viewer@example.test');
    const res = await v.get('/api/research/brand-schema');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.jsonSchema)).toContain('brand-research/v1');
    expect(res.body.csvColumns).toContain('evidence_verified');
  });
});

describe('documentation examples', () => {
  it('the documented JSON and CSV examples validate and import', async () => {
    const { readFileSync } = await import('node:fs');
    const json = readFileSync(new URL('../../docs/research/brand-research.example.json', import.meta.url), 'utf8');
    const p = previewImport(env.db, env.users.researcher, { format: 'JSON', content: json }, now());
    expect(p.fileErrors).toEqual([]);
    expect(p.records.every((r) => r.errors.length === 0)).toBe(true);
    const csv = readFileSync(new URL('../../docs/research/brand-research.example.csv', import.meta.url), 'utf8');
    const c = previewImport(env.db, env.users.researcher, { format: 'CSV', content: csv, csvMeta: { configVersion: 1, niche: 'Gaming' } }, now());
    expect(c.fileErrors).toEqual([]);
    expect(c.records).toHaveLength(1);
    expect(c.records[0]!.errors).toEqual([]);
  });
});
