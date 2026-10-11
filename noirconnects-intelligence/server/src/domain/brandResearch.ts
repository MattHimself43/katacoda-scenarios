import { z } from 'zod';

/**
 * Brand research interchange format, version 1.
 *
 * This is the contract between research producers (Claude, a human researcher, or any other
 * tool) and the application. It is documented in docs/research/brand-research-v1.md and
 * exported as JSON Schema at GET /api/research/brand-schema.
 */
export const BRAND_RESEARCH_SCHEMA_VERSION = 'brand-research/v1';

export const EVIDENCE_TYPES = [
  'PAID_SPONSORSHIP',
  'AMBASSADOR_PROGRAM',
  'CREATOR_ANNOUNCEMENT',
  'AFFILIATE_PROGRAM',
  'OTHER',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** Evidence types that demonstrate paid/committed creator partnerships (as opposed to an open affiliate program). */
export const PARTNERSHIP_EVIDENCE: ReadonlySet<EvidenceType> = new Set(['PAID_SPONSORSHIP', 'AMBASSADOR_PROGRAM', 'CREATOR_ANNOUNCEMENT']);

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\/[^\s]+$/i.test(v), { message: 'Must be an http(s) URL' });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** YYYY-MM-DD or YYYY-MM (month precision); null when the date is unknown. */
const evidenceDate = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/, { message: 'Use YYYY-MM-DD or YYYY-MM' })
  .nullish()
  .transform((v) => v ?? null);

export const evidenceSchema = z
  .object({
    type: z.enum(EVIDENCE_TYPES),
    description: z.string().trim().min(5).max(1000),
    sourceUrl: httpUrl.nullish().transform((v) => v ?? null),
    date: evidenceDate,
    creatorName: optionalText(200),
    platform: optionalText(60),
    verified: z.boolean(),
  })
  .strict()
  .refine((e) => !e.verified || e.sourceUrl, { message: 'Verified evidence must include a sourceUrl', path: ['sourceUrl'] });

export type EvidenceInput = z.infer<typeof evidenceSchema>;

const verifiedField = <T extends z.ZodTypeAny>(value: T) =>
  z
    .object({ value, verified: z.boolean() })
    .strict()
    .nullish()
    .transform((v) => v ?? null);

export const brandRecordSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    website: z.string().trim().min(3).max(2000),
    industry: optionalText(120),
    subcategory: optionalText(120),
    targetMarkets: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    productsServices: optionalText(2000),
    influencerActivitySummary: optionalText(3000),
    recommendationReason: optionalText(3000),
    researchedAt: z.iso.datetime({ offset: true }).nullish().transform((v) => v ?? null),
    contactName: verifiedField(z.string().trim().min(1).max(200)),
    contactRole: verifiedField(z.string().trim().min(1).max(200)),
    contactEmail: verifiedField(z.email().max(254)),
    contactChannelUrl: httpUrl.nullish().transform((v) => v ?? null),
    evidence: z.array(evidenceSchema).min(1, { message: 'At least one piece of influencer marketing evidence is required' }).max(50),
  })
  .strict();

export type BrandRecordInput = z.infer<typeof brandRecordSchema>;

/** Envelope. Records are validated individually so one bad record does not reject the file. */
export const researchFileSchema = z
  .object({
    schemaVersion: z.literal(BRAND_RESEARCH_SCHEMA_VERSION),
    configVersion: z.number().int().positive(),
    niche: z.string().trim().min(1).max(80),
    generatedAt: z.iso.datetime({ offset: true }),
    producedBy: optionalText(200),
    notes: optionalText(3000),
    brands: z.array(z.unknown()).max(200),
  })
  .strict();

export type ResearchFile = z.infer<typeof researchFileSchema>;

/** JSON Schema for producers (a strict, documentation-oriented view of the same rules). */
export function brandResearchJsonSchema() {
  const file = researchFileSchema.extend({ brands: z.array(brandRecordSchema).max(200) });
  return z.toJSONSchema(file, { io: 'input', unrepresentable: 'any' });
}

// ─────────────────────────────────────────────────────────── CSV

export const CSV_COLUMNS = [
  'name',
  'website',
  'industry',
  'subcategory',
  'target_markets',
  'products_services',
  'influencer_activity_summary',
  'recommendation_reason',
  'researched_at',
  'contact_name',
  'contact_name_verified',
  'contact_role',
  'contact_role_verified',
  'contact_email',
  'contact_email_verified',
  'contact_channel_url',
  'evidence_type',
  'evidence_description',
  'evidence_source_url',
  'evidence_date',
  'evidence_creator_name',
  'evidence_platform',
  'evidence_verified',
] as const;

export class CsvError extends Error {}

/** RFC 4180 parser (quoted fields, escaped quotes, CRLF/LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const src = text.replace(/^﻿/, '');
  while (i < src.length) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\n' || c === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += c === '\r' && src[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  if (quoted) throw new CsvError('Unterminated quoted field');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const bool = (v: string | undefined) => /^(true|yes|y|1)$/i.test((v ?? '').trim());
const blank = (v: string | undefined) => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/**
 * Converts the CSV format (one row per evidence item; brand columns repeated, grouped by
 * website) into a v1 research payload. Metadata that the CSV cannot carry is supplied by the
 * importer.
 */
export function csvToResearchPayload(
  text: string,
  meta: { configVersion: number; niche: string; generatedAt: string },
): Record<string, unknown> {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new CsvError('The CSV needs a header row and at least one data row');
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new CsvError(`Missing CSV columns: ${missing.join(', ')}`);
  const unknown = header.filter((h) => !(CSV_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) throw new CsvError(`Unknown CSV columns: ${unknown.join(', ')}`);

  const groups = new Map<string, Record<string, unknown>>();
  for (const r of rows.slice(1)) {
    const get = (c: (typeof CSV_COLUMNS)[number]) => r[header.indexOf(c)];
    const website = (get('website') ?? '').trim();
    const key = website.toLowerCase() || `__row${groups.size}`;
    let brand = groups.get(key);
    if (!brand) {
      const contact = (value: string | null, verified: string | undefined) => (value ? { value, verified: bool(verified) } : null);
      brand = {
        name: (get('name') ?? '').trim(),
        website,
        industry: blank(get('industry')),
        subcategory: blank(get('subcategory')),
        targetMarkets: (get('target_markets') ?? '').split(';').map((s) => s.trim()).filter(Boolean),
        productsServices: blank(get('products_services')),
        influencerActivitySummary: blank(get('influencer_activity_summary')),
        recommendationReason: blank(get('recommendation_reason')),
        researchedAt: blank(get('researched_at')),
        contactName: contact(blank(get('contact_name')), get('contact_name_verified')),
        contactRole: contact(blank(get('contact_role')), get('contact_role_verified')),
        contactEmail: contact(blank(get('contact_email')), get('contact_email_verified')),
        contactChannelUrl: blank(get('contact_channel_url')),
        evidence: [] as unknown[],
      };
      groups.set(key, brand);
    }
    if (blank(get('evidence_type')) || blank(get('evidence_description'))) {
      (brand.evidence as unknown[]).push({
        type: (get('evidence_type') ?? '').trim().toUpperCase(),
        description: (get('evidence_description') ?? '').trim(),
        sourceUrl: blank(get('evidence_source_url')),
        date: blank(get('evidence_date')),
        creatorName: blank(get('evidence_creator_name')),
        platform: blank(get('evidence_platform')),
        verified: bool(get('evidence_verified')),
      });
    }
  }
  return {
    schemaVersion: BRAND_RESEARCH_SCHEMA_VERSION,
    configVersion: meta.configVersion,
    niche: meta.niche,
    generatedAt: meta.generatedAt,
    producedBy: 'CSV import',
    brands: [...groups.values()],
  };
}
