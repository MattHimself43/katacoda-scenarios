import { describe, expect, it } from 'vitest';
import { normalizeBrandName, normalizeDomain } from '../src/domain/domains.js';
import { scoreBrand } from '../src/domain/qualityScore.js';
import { brandRecordSchema, csvToResearchPayload, parseCsv } from '../src/domain/brandResearch.js';
import { DEFAULT_CONFIG } from '../src/domain/config.js';
import { brandRecord } from './fixtures.js';

const now = new Date('2026-03-02T10:00:00Z');

describe('domain normalization (duplicate key)', () => {
  it.each([
    ['https://www.Example.com/path?q=1', 'example.com'],
    ['example.com', 'example.com'],
    ['http://shop.store.example.com', 'example.com'],
    ['https://www2.brand.co.uk/', 'brand.co.uk'],
    ['https://m.brand.com.au', 'brand.com.au'],
    ['HTTPS://BRAND.IO.', 'brand.io'],
  ])('%s → %s', (input, expected) => expect(normalizeDomain(input)).toBe(expected));

  it.each(['ftp://example.com', 'http://localhost:3000', 'http://192.168.0.1', 'not a url', ''])('rejects %s', (input) => {
    expect(() => normalizeDomain(input)).toThrow();
  });

  it('normalizes company names for secondary identity checks', () => {
    expect(normalizeBrandName('Acme Gaming, Inc.')).toBe(normalizeBrandName('ACME Gaming LLC'));
    expect(normalizeBrandName('Café & Co')).toBe('cafe and');
  });
});

describe('quality scoring', () => {
  const parse = (o: Record<string, unknown> = {}) => brandRecordSchema.parse(brandRecord(1, o));

  it('scores a strong, recent, contactable gaming brand highly with an explained breakdown', () => {
    const s = scoreBrand(parse(), DEFAULT_CONFIG, now);
    expect(s).toMatchObject({ recency: 25, contactability: 15, completeness: 10, nicheFit: 10 });
    expect(s.total).toBe(s.evidence + s.recency + s.contactability + s.completeness + s.nicheFit);
    expect(s.total).toBeGreaterThanOrEqual(80);
  });

  it('scores affiliate-only evidence far below paid sponsorship evidence', () => {
    const affiliateOnly = parse({
      evidence: [{ type: 'AFFILIATE_PROGRAM', description: 'Open affiliate program', sourceUrl: 'https://a.example/aff', date: '2026-02-01', verified: true }],
    });
    const paid = scoreBrand(parse(), DEFAULT_CONFIG, now).total;
    const aff = scoreBrand(affiliateOnly, DEFAULT_CONFIG, now);
    expect(aff.total).toBeLessThan(paid - 25);
    expect(aff.notes.join(' ')).toMatch(/No partnership evidence/);
  });

  it('rewards recency relative to the configured window', () => {
    const old = parse({
      evidence: [{ type: 'PAID_SPONSORSHIP', description: 'Old sponsorship video', sourceUrl: 'https://v.example/1', date: '2023-01-01', verified: true }],
    });
    expect(scoreBrand(old, DEFAULT_CONFIG, now).recency).toBe(3);
    expect(scoreBrand(old, { ...DEFAULT_CONFIG, sponsorshipRecencyMonths: 60 }, now).recency).toBe(18);
  });

  it('does not trust unverified contacts', () => {
    const s = scoreBrand(parse({ contactEmail: { value: 'x@y.example', verified: false }, contactChannelUrl: null }), DEFAULT_CONFIG, now);
    expect(s.contactability).toBe(5);
  });
});

describe('CSV conversion', () => {
  it('parses quoted fields and groups evidence rows by website', () => {
    expect(parseCsv('a,"b ""q"", c",d\r\n1,2,3\n')).toEqual([['a', 'b "q", c', 'd'], ['1', '2', '3']]);
    const header =
      'name,website,industry,subcategory,target_markets,products_services,influencer_activity_summary,recommendation_reason,researched_at,contact_name,contact_name_verified,contact_role,contact_role_verified,contact_email,contact_email_verified,contact_channel_url,evidence_type,evidence_description,evidence_source_url,evidence_date,evidence_creator_name,evidence_platform,evidence_verified';
    const row = (ev: string) =>
      `Test Co,https://test.example,Gaming,Controllers,US;UK,Pads,"Sponsors, streamers",Good fit,,,,,,deals@test.example,true,,${ev}`;
    const csv = [header, row('PAID_SPONSORSHIP,Sponsored stream,https://v.example/1,2026-02-01,Streamer,Twitch,yes'), row('affiliate_program,Affiliate page,https://test.example/aff,,,,no')].join('\n');
    const payload = csvToResearchPayload(csv, { configVersion: 1, niche: 'Gaming', generatedAt: now.toISOString() });
    const brands = payload.brands as Array<Record<string, unknown>>;
    expect(brands).toHaveLength(1);
    expect(brands[0]!.targetMarkets).toEqual(['US', 'UK']);
    expect(brands[0]!.contactEmail).toEqual({ value: 'deals@test.example', verified: true });
    expect(brands[0]!.evidence).toHaveLength(2);
    expect(brandRecordSchema.safeParse(brands[0]).success).toBe(true);
  });

  it('rejects CSVs with missing or unknown columns', () => {
    expect(() => csvToResearchPayload('name,website\nA,https://a.example', { configVersion: 1, niche: 'Gaming', generatedAt: now.toISOString() })).toThrow(/Missing CSV columns/);
  });
});
