import type { DB } from '../db/connection.js';
import { tx } from '../db/connection.js';
import type { Actor } from '../auth/actor.js';
import { can } from '../auth/permissions.js';
import { BRAND_STATUS } from '../domain/statuses.js';
import { PARTNERSHIP_EVIDENCE } from '../domain/brandResearch.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { parseJson } from '../lib/util.js';
import { audit, escapeLike } from './audit.js';
import { consumeApproval, decideApproval, getApproval } from './approvals.js';

export const BRAND_QUALIFICATION_ACTION = 'BRAND_QUALIFICATION';

const PARTNERSHIP_TYPES_SQL = [...PARTNERSHIP_EVIDENCE].map((t) => `'${t}'`).join(',');

/**
 * The exact thing a brand approval authorizes. Hashed by the approval engine, so if the
 * brand's identity, contact or evidence changes after review, the decision is refused.
 * Approval authorizes preparing an outreach draft only — never sending.
 */
export function brandApprovalPayload(db: DB, brandId: number) {
  const b = db
    .prepare('SELECT id, name, website_domain, contact_email, contact_email_verified, quality_score FROM brands WHERE id = ?')
    .get(brandId) as
    | { id: number; name: string; website_domain: string; contact_email: string | null; contact_email_verified: number; quality_score: number | null }
    | undefined;
  if (!b) throw notFound('Brand not found');
  const evidenceIds = (db.prepare('SELECT id FROM brand_evidence WHERE brand_id = ? ORDER BY id').all(brandId) as { id: number }[]).map((r) => r.id);
  return {
    brandId: b.id,
    name: b.name,
    domain: b.website_domain,
    contactEmail: b.contact_email,
    contactEmailVerified: b.contact_email_verified === 1,
    qualityScore: b.quality_score,
    evidenceIds,
    authorizes: 'PREPARE_OUTREACH_DRAFT',
  };
}

export interface BrandListQuery {
  status?: string;
  q?: string;
  niche?: string;
  sort?: 'score' | 'recent' | 'name';
  limit?: number;
  offset?: number;
}

export function listBrands(db: DB, query: BrandListQuery) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.status) { where.push('b.status = ?'); params.push(query.status); }
  if (query.niche) { where.push('b.discovery_niche = ?'); params.push(query.niche); }
  if (query.q && query.q.trim()) {
    const like = `%${escapeLike(query.q.trim().toLowerCase())}%`;
    where.push(`(b.normalized_name LIKE ? ESCAPE '\\' OR b.website_domain LIKE ? ESCAPE '\\' OR lower(b.name) LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order =
    query.sort === 'name' ? 'b.name COLLATE NOCASE ASC' : query.sort === 'recent' ? 'b.created_at DESC, b.id DESC' : 'b.quality_score DESC, b.created_at DESC';
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM brands b ${whereSql}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT b.id, b.name, b.website_url, b.website_domain, b.industry, b.subcategory, b.quality_score, b.status,
              b.discovery_niche, b.contact_email, b.contact_email_verified, b.contact_channel_url, b.created_at, b.researched_at,
              b.warnings_json, sv.version AS settings_version,
              (SELECT COUNT(*) FROM brand_evidence e WHERE e.brand_id = b.id AND e.evidence_type IN (${PARTNERSHIP_TYPES_SQL})) AS partnership_evidence,
              (SELECT COUNT(*) FROM brand_evidence e WHERE e.brand_id = b.id AND e.evidence_type = 'AFFILIATE_PROGRAM') AS affiliate_evidence,
              (SELECT COUNT(*) FROM brand_evidence e WHERE e.brand_id = b.id AND e.verification_status = 'VERIFIED') AS verified_evidence,
              (SELECT COUNT(*) FROM brand_evidence e WHERE e.brand_id = b.id) AS total_evidence
       FROM brands b JOIN settings_versions sv ON sv.id = b.settings_version_id
       ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<Record<string, unknown> & { warnings_json: string }>;
  return {
    total,
    brands: rows.map(({ warnings_json, ...r }) => ({ ...r, warnings: parseJson<string[]>(warnings_json, []) })),
  };
}

export function listBrandNiches(db: DB): string[] {
  return (db.prepare('SELECT DISTINCT discovery_niche FROM brands ORDER BY discovery_niche').all() as { discovery_niche: string }[]).map(
    (r) => r.discovery_niche,
  );
}

/** Brand row as returned by getBrandDetail (all brands columns plus derived fields). */
export interface BrandDetailRecord {
  [column: string]: unknown;
  id: number;
  name: string;
  status: string;
  website_domain: string;
  discovery_niche: string;
  settings_version: number;
  approval_id: string | null;
  target_markets: string[];
  quality_breakdown: Record<string, unknown>;
  warnings: string[];
}

export function getBrandDetail(db: DB, id: number) {
  const row = db
    .prepare(
      `SELECT b.*, sv.version AS settings_version FROM brands b JOIN settings_versions sv ON sv.id = b.settings_version_id WHERE b.id = ?`,
    )
    .get(id) as (Record<string, unknown> & { target_markets_json: string; quality_breakdown_json: string; warnings_json: string; approval_id: string | null }) | undefined;
  if (!row) return undefined;
  const { target_markets_json, quality_breakdown_json, warnings_json, ...brand } = row;
  const evidence = db
    .prepare(`SELECT id, evidence_type, description, source_url, evidence_date, creator_name, platform, verification_status, captured_at, research_run_id
              FROM brand_evidence WHERE brand_id = ? ORDER BY evidence_date IS NULL, evidence_date DESC, id`)
    .all(id);
  const decisions = db
    .prepare(`SELECT ba.id, ba.decision, ba.decided_at, ba.notes, u.display_name AS decided_by
              FROM brand_approvals ba JOIN users u ON u.id = ba.decided_by WHERE ba.brand_id = ? ORDER BY ba.id DESC`)
    .all(id);
  const approval = row.approval_id ? getApproval(db, row.approval_id) : null;
  const brandView = {
    ...brand,
    target_markets: parseJson<string[]>(target_markets_json, []),
    quality_breakdown: parseJson<Record<string, unknown>>(quality_breakdown_json, {}),
    warnings: parseJson<string[]>(warnings_json, []),
  } as BrandDetailRecord;
  return {
    brand: brandView,
    evidence,
    decisions,
    approval: approval
      ? { id: approval.id, status: approval.status, content_hash: approval.content_hash, requested_at: approval.requested_at, requested_by_name: approval.requested_by_name }
      : null,
  };
}

/**
 * APPROVE: PENDING_BRAND_APPROVAL → APPROVED_FOR_OUTREACH (authorizes preparing a draft only).
 * DECLINE: PENDING_BRAND_APPROVAL → DECLINED (stays searchable; never rediscovered as new).
 */
export function decideBrand(
  db: DB,
  actor: Actor,
  brandId: number,
  decision: 'APPROVE' | 'DECLINE',
  opts: { reviewedHash?: string; notes?: string | null },
  now: Date,
): { status: string } {
  if (!can(actor.role, 'brands.decide')) throw forbidden('Your role cannot approve or decline brands');
  return tx(db, () => {
    const brand = db.prepare('SELECT id, name, website_domain, status, approval_id FROM brands WHERE id = ?').get(brandId) as
      | { id: number; name: string; website_domain: string; status: string; approval_id: string | null }
      | undefined;
    if (!brand) throw notFound('Brand not found');
    if (brand.status !== BRAND_STATUS.PENDING_BRAND_APPROVAL) throw conflict(`This brand has already been decided (${brand.status})`);
    if (!brand.approval_id) throw conflict('This brand has no open approval request');
    const notes = opts.notes?.trim() || null;
    const newStatus = decision === 'APPROVE' ? BRAND_STATUS.APPROVED_FOR_OUTREACH : BRAND_STATUS.DECLINED;

    if (decision === 'APPROVE') {
      decideApproval(db, actor, brand.approval_id, 'APPROVE', { reviewedHash: opts.reviewedHash, notes }, now);
      consumeApproval(
        db,
        brand.approval_id,
        { actionType: BRAND_QUALIFICATION_ACTION, currentAction: brandApprovalPayload(db, brandId) },
        { brandStatus: newStatus },
        now,
      );
    } else {
      decideApproval(db, actor, brand.approval_id, 'REJECT', { notes }, now);
    }

    const res = db
      .prepare('UPDATE brands SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
      .run(newStatus, now.toISOString(), brandId, BRAND_STATUS.PENDING_BRAND_APPROVAL);
    if (res.changes !== 1) throw conflict('This brand was decided by someone else');
    db.prepare('INSERT INTO brand_approvals (brand_id, decision, decided_by, decided_at, notes, approval_id) VALUES (?, ?, ?, ?, ?, ?)').run(
      brandId,
      decision === 'APPROVE' ? 'APPROVED' : 'DECLINED',
      actor.userId,
      now.toISOString(),
      notes,
      brand.approval_id,
    );
    audit(db, actor, {
      action: decision === 'APPROVE' ? 'BRAND_APPROVED' : 'BRAND_DECLINED',
      entityType: 'brand',
      entityId: brandId,
      details: { name: brand.name, domain: brand.website_domain, notes, newStatus },
    }, now);
    return { status: newStatus };
  });
}
