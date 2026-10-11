import type { DB } from '../db/connection.js';
import { tx } from '../db/connection.js';
import type { Actor } from '../auth/actor.js';
import { can } from '../auth/permissions.js';
import {
  BRAND_RESEARCH_SCHEMA_VERSION,
  CsvError,
  brandRecordSchema,
  csvToResearchPayload,
  researchFileSchema,
  type BrandRecordInput,
} from '../domain/brandResearch.js';
import { DomainError, normalizeBrandName, normalizeDomain, parseWebsite } from '../domain/domains.js';
import { brandWarnings, evidenceDateToTime, scoreBrand, type QualityBreakdown } from '../domain/qualityScore.js';
import { effectiveNiche, type IntelligenceConfig } from '../domain/config.js';
import { BRAND_STATUS } from '../domain/statuses.js';
import { AppError, conflict, forbidden } from '../lib/errors.js';
import { canonicalJson, sha256 } from '../lib/util.js';
import { audit } from './audit.js';
import { createApproval } from './approvals.js';
import { getActiveSettings } from './settings.js';
import { getVersionSnapshot, startResearchRun } from './researchRuns.js';
import { BRAND_QUALIFICATION_ACTION, brandApprovalPayload } from './brands.js';

export interface ImportInput {
  format: 'JSON' | 'CSV';
  content: string;
  fileName?: string | null;
  /** Required for CSV, which cannot carry file-level metadata. */
  csvMeta?: { configVersion: number; niche: string } | null;
}

export type RecordOutcome = 'NEW' | 'DUPLICATE' | 'DUPLICATE_IN_FILE' | 'POSSIBLE_DUPLICATE' | 'BELOW_THRESHOLD' | 'INVALID';

export interface RecordResult {
  index: number;
  name: string | null;
  website: string | null;
  domain: string | null;
  outcome: RecordOutcome;
  errors: string[];
  warnings: string[];
  score: QualityBreakdown | null;
  existingBrand: { id: number; name: string; domain: string; status: string } | null;
  partnershipEvidence: number;
  affiliateEvidence: number;
  verifiedEvidence: number;
}

export interface ImportAnalysis {
  inputHash: string;
  format: 'JSON' | 'CSV';
  fileName: string | null;
  fileErrors: string[];
  fileWarnings: string[];
  schemaVersion: string | null;
  generatedAt: string | null;
  producedBy: string | null;
  config: {
    version: number;
    niche: string;
    activeVersion: number;
    activeNiche: string;
    outdated: boolean;
    dailyBrandTarget: number;
    minBrandQualityScore: number;
  } | null;
  summary: Record<RecordOutcome | 'received', number>;
  records: RecordResult[];
  alreadyImported: { runId: number; completedAt: string } | null;
}

interface Internal {
  analysis: ImportAnalysis;
  payload: Record<string, unknown> | null;
  parsedRecords: Map<number, { record: BrandRecordInput; domain: string; websiteUrl: string; score: QualityBreakdown; warnings: string[] }>;
  configSnapshot: { versionId: number; version: number; config: IntelligenceConfig } | null;
}

function emptySummary(): ImportAnalysis['summary'] {
  return { received: 0, NEW: 0, DUPLICATE: 0, DUPLICATE_IN_FILE: 0, POSSIBLE_DUPLICATE: 0, BELOW_THRESHOLD: 0, INVALID: 0 };
}

function zodMessages(issues: { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message));
}

/**
 * Validates a research file against the schema, configuration and existing database without
 * writing anything. The same analysis is recomputed inside the commit transaction.
 */
function analyze(db: DB, input: ImportInput, now: Date): Internal {
  const fileErrors: string[] = [];
  const fileWarnings: string[] = [];
  let payload: Record<string, unknown> | null = null;

  if (input.format === 'JSON') {
    try {
      const parsed: unknown = JSON.parse(input.content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fileErrors.push('The file must contain a JSON object');
      else payload = parsed as Record<string, unknown>;
    } catch (e) {
      fileErrors.push(`Not valid JSON: ${(e as Error).message}`);
    }
  } else {
    if (!input.csvMeta) fileErrors.push('CSV imports need the configuration version and niche the research was produced under');
    else {
      try {
        payload = csvToResearchPayload(input.content, { ...input.csvMeta, generatedAt: now.toISOString() });
      } catch (e) {
        if (e instanceof CsvError) fileErrors.push(e.message);
        else throw e;
      }
    }
  }

  // CSV payloads embed generatedAt=now, so hash the source text + metadata instead.
  const inputHash =
    input.format === 'CSV'
      ? sha256(canonicalJson({ format: 'CSV', content: input.content, meta: input.csvMeta ?? null }))
      : sha256(canonicalJson({ format: 'JSON', payload: payload ?? input.content }));

  const internal: Internal = {
    analysis: {
      inputHash,
      format: input.format,
      fileName: input.fileName?.slice(0, 255) ?? null,
      fileErrors,
      fileWarnings,
      schemaVersion: null,
      generatedAt: null,
      producedBy: null,
      config: null,
      summary: emptySummary(),
      records: [],
      alreadyImported: null,
    },
    payload,
    parsedRecords: new Map(),
    configSnapshot: null,
  };
  if (!payload) return internal;

  const file = researchFileSchema.safeParse(payload);
  if (!file.success) {
    fileErrors.push(...zodMessages(file.error.issues));
    if (payload.schemaVersion !== BRAND_RESEARCH_SCHEMA_VERSION) {
      fileErrors.push(`schemaVersion must be "${BRAND_RESEARCH_SCHEMA_VERSION}"`);
    }
    return internal;
  }
  const meta = file.data;
  internal.analysis.schemaVersion = meta.schemaVersion;
  internal.analysis.generatedAt = meta.generatedAt;
  internal.analysis.producedBy = meta.producedBy;

  // Configuration version validation.
  const snapshot = getVersionSnapshot(db, meta.configVersion);
  const active = getActiveSettings(db);
  if (!snapshot) {
    fileErrors.push(`Configuration version v${meta.configVersion} does not exist (active is v${active.version})`);
    return internal;
  }
  const versionNiche = effectiveNiche(snapshot.config);
  if (versionNiche.toLowerCase() !== meta.niche.trim().toLowerCase()) {
    fileErrors.push(`The file says niche "${meta.niche}", but configuration v${snapshot.version} targets "${versionNiche}"`);
    return internal;
  }
  internal.configSnapshot = snapshot;
  const outdated = snapshot.version !== active.version;
  internal.analysis.config = {
    version: snapshot.version,
    niche: versionNiche,
    activeVersion: active.version,
    activeNiche: effectiveNiche(active.config),
    outdated,
    dailyBrandTarget: snapshot.config.dailyBrandTarget,
    minBrandQualityScore: snapshot.config.minBrandQualityScore,
  };
  if (outdated) {
    fileWarnings.push(
      `This research was produced under configuration v${snapshot.version} (${versionNiche}); v${active.version} (${effectiveNiche(active.config)}) is now active. Imported brands will be tagged with v${snapshot.version}.`,
    );
  }
  if (new Date(meta.generatedAt) > now) fileErrors.push('generatedAt is in the future');

  const prior = db
    .prepare(`SELECT id, completed_at FROM research_runs WHERE input_hash = ? AND status = 'IMPORTED' ORDER BY id DESC LIMIT 1`)
    .get(inputHash) as { id: number; completed_at: string } | undefined;
  if (prior) internal.analysis.alreadyImported = { runId: prior.id, completedAt: prior.completed_at };

  const findByDomain = db.prepare('SELECT id, name, website_domain AS domain, status FROM brands WHERE website_domain = ?');
  const findByName = db.prepare('SELECT id, name, website_domain AS domain, status FROM brands WHERE normalized_name = ? LIMIT 1');
  const seenDomains = new Set<string>();
  const seenNames = new Map<string, number>();
  const config = snapshot.config;

  meta.brands.forEach((raw, index) => {
    const r = raw as Record<string, unknown> | null;
    const result: RecordResult = {
      index,
      name: typeof r?.name === 'string' ? r.name : null,
      website: typeof r?.website === 'string' ? r.website : null,
      domain: null,
      outcome: 'INVALID',
      errors: [],
      warnings: [],
      score: null,
      existingBrand: null,
      partnershipEvidence: 0,
      affiliateEvidence: 0,
      verifiedEvidence: 0,
    };
    internal.analysis.records.push(result);

    const parsed = brandRecordSchema.safeParse(raw);
    if (!parsed.success) {
      result.errors.push(...zodMessages(parsed.error.issues));
      return;
    }
    const record = parsed.data;
    let domain: string;
    let websiteUrl: string;
    try {
      domain = normalizeDomain(record.website);
      websiteUrl = parseWebsite(record.website).href;
    } catch (e) {
      if (e instanceof DomainError) {
        result.errors.push(e.message);
        return;
      }
      throw e;
    }
    result.domain = domain;
    result.partnershipEvidence = record.evidence.filter((e) => ['PAID_SPONSORSHIP', 'AMBASSADOR_PROGRAM', 'CREATOR_ANNOUNCEMENT'].includes(e.type)).length;
    result.affiliateEvidence = record.evidence.filter((e) => e.type === 'AFFILIATE_PROGRAM').length;
    result.verifiedEvidence = record.evidence.filter((e) => e.verified).length;

    // Discovery mode: verifiable influencer marketing activity requires at least one sourced item.
    if (!record.evidence.some((e) => e.sourceUrl)) {
      result.errors.push('No verifiable evidence: at least one evidence item needs a sourceUrl');
    }
    record.evidence.forEach((e, i) => {
      const t = evidenceDateToTime(e.date);
      if (t !== null && t > now.getTime()) result.errors.push(`evidence.${i}.date is in the future`);
    });
    if (record.researchedAt && new Date(record.researchedAt) > now) result.errors.push('researchedAt is in the future');
    if (result.errors.length) return;

    const score = scoreBrand(record, config, now);
    const warnings = brandWarnings(record, domain, config, now);
    result.score = score;
    result.warnings = warnings;
    internal.parsedRecords.set(index, { record, domain, websiteUrl, score, warnings });

    const normName = normalizeBrandName(record.name);
    const existing = findByDomain.get(domain) as RecordResult['existingBrand'] | undefined;
    if (seenDomains.has(domain)) {
      result.outcome = 'DUPLICATE_IN_FILE';
    } else if (existing) {
      result.outcome = 'DUPLICATE';
      result.existingBrand = existing;
    } else {
      const sameName = normName ? (findByName.get(normName) as RecordResult['existingBrand'] | undefined) : undefined;
      if (sameName) {
        result.outcome = 'POSSIBLE_DUPLICATE';
        result.existingBrand = sameName;
        result.warnings.unshift(`Same name as existing brand "${sameName.name}" (${sameName.domain}, ${sameName.status}) on a different domain`);
      } else if (normName && seenNames.has(normName)) {
        result.outcome = 'POSSIBLE_DUPLICATE';
        result.warnings.unshift(`Same name as record #${seenNames.get(normName)! + 1} in this file on a different domain`);
      } else if (score.total < config.minBrandQualityScore) {
        result.outcome = 'BELOW_THRESHOLD';
      } else {
        result.outcome = 'NEW';
      }
    }
    seenDomains.add(domain);
    if (normName && !seenNames.has(normName)) seenNames.set(normName, index);
  });

  const s = internal.analysis.summary;
  s.received = internal.analysis.records.length;
  for (const r of internal.analysis.records) s[r.outcome]++;
  if (s.received === 0) fileWarnings.push('The file contains no brand records');
  return internal;
}

export function previewImport(db: DB, actor: Actor, input: ImportInput, now: Date): ImportAnalysis {
  if (!can(actor.role, 'research.import')) throw forbidden('Your role cannot import research');
  return analyze(db, input, now).analysis;
}

export interface CommitOptions {
  /** Hash returned by the preview; guarantees the committed content is what was previewed. */
  expectedInputHash: string;
  acceptOutdatedConfig?: boolean;
  /** Record indexes flagged POSSIBLE_DUPLICATE that the importer reviewed and wants to import anyway. */
  includePossibleDuplicates?: number[];
}

export interface CommitResult {
  runId: number;
  imported: { index: number; brandId: number; name: string; domain: string; score: number }[];
  summary: ImportAnalysis['summary'];
}

/** Imports NEW records (and explicitly included possible duplicates) in one transaction. */
export function commitImport(db: DB, actor: Actor, input: ImportInput, opts: CommitOptions, now: Date): CommitResult {
  if (!can(actor.role, 'research.import')) throw forbidden('Your role cannot import research');

  const outcome = tx(db, (): { ok: true; result: CommitResult } | { ok: false; fileErrors: string[]; internal: Internal } => {
    const internal = analyze(db, input, now);
    const a = internal.analysis;
    if (a.inputHash !== opts.expectedInputHash) {
      throw conflict('The file differs from the one you previewed. Preview it again before importing.');
    }
    if (a.fileErrors.length || !internal.configSnapshot) return { ok: false, fileErrors: a.fileErrors, internal };
    if (a.alreadyImported) throw conflict(`This exact file was already imported in research run #${a.alreadyImported.runId}`);
    if (a.config?.outdated && !opts.acceptOutdatedConfig) {
      throw conflict('This research was produced under an older configuration version. Confirm to import it tagged with that version.');
    }
    const include = new Set(opts.includePossibleDuplicates ?? []);
    for (const i of include) {
      if (a.records[i]?.outcome !== 'POSSIBLE_DUPLICATE') throw conflict(`Record #${i + 1} is not a possible duplicate and cannot be force-included`);
      if ((a.records[i]!.score?.total ?? 0) < internal.configSnapshot.config.minBrandQualityScore) {
        throw conflict(`Record #${i + 1} is below the minimum quality score and cannot be included`);
      }
    }

    const run = startResearchRun(
      db,
      actor,
      {
        runType: 'BRAND_DISCOVERY',
        source: 'MANUAL_IMPORT',
        inputFileName: a.fileName,
        inputHash: a.inputHash,
        inputFormat: input.format,
        schemaVersion: a.schemaVersion ?? undefined,
        settingsVersion: internal.configSnapshot.version,
      },
      now,
    );
    const snapshot = internal.configSnapshot;
    const niche = effectiveNiche(snapshot.config);
    const fileGeneratedAt = a.generatedAt!;

    const insertBrand = db.prepare(
      `INSERT INTO brands (name, normalized_name, website_url, website_domain, industry, subcategory, target_markets_json, products_services,
                           influencer_activity_summary, contact_name, contact_name_verified, contact_role, contact_role_verified,
                           contact_email, contact_email_verified, contact_channel_url, quality_score, quality_breakdown_json, warnings_json,
                           recommendation_reason, discovery_niche, settings_version_id, research_run_id, researched_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertEvidence = db.prepare(
      `INSERT INTO brand_evidence (brand_id, research_run_id, evidence_type, description, source_url, evidence_date, creator_name, platform, verification_status, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const imported: CommitResult['imported'] = [];
    for (const r of a.records) {
      if (!(r.outcome === 'NEW' || (r.outcome === 'POSSIBLE_DUPLICATE' && include.has(r.index)))) continue;
      const p = internal.parsedRecords.get(r.index)!;
      const rec = p.record;
      const iso = now.toISOString();
      const res = insertBrand.run(
        rec.name,
        normalizeBrandName(rec.name),
        p.websiteUrl,
        p.domain,
        rec.industry,
        rec.subcategory,
        JSON.stringify(rec.targetMarkets),
        rec.productsServices,
        rec.influencerActivitySummary,
        rec.contactName?.value ?? null,
        rec.contactName?.verified ? 1 : 0,
        rec.contactRole?.value ?? null,
        rec.contactRole?.verified ? 1 : 0,
        rec.contactEmail?.value ?? null,
        rec.contactEmail?.verified ? 1 : 0,
        rec.contactChannelUrl,
        p.score.total,
        JSON.stringify(p.score),
        JSON.stringify(r.warnings),
        rec.recommendationReason,
        niche,
        snapshot.versionId,
        run.id,
        rec.researchedAt ?? fileGeneratedAt,
        BRAND_STATUS.PENDING_BRAND_APPROVAL,
        iso,
        iso,
      );
      const brandId = Number(res.lastInsertRowid);
      for (const e of rec.evidence) {
        insertEvidence.run(brandId, run.id, e.type, e.description, e.sourceUrl, e.date, e.creatorName, e.platform, e.verified ? 'VERIFIED' : 'UNVERIFIED', iso);
      }
      const approval = createApproval(
        db,
        actor,
        {
          actionType: BRAND_QUALIFICATION_ACTION,
          targetEntityType: 'brand',
          targetEntityId: brandId,
          proposedAction: brandApprovalPayload(db, brandId),
          requiredRole: 'MANAGER',
        },
        now,
      );
      db.prepare('UPDATE brands SET approval_id = ? WHERE id = ?').run(approval.id, brandId);
      imported.push({ index: r.index, brandId, name: rec.name, domain: p.domain, score: p.score.total });
    }

    const s = a.summary;
    const notImportedPossible = s.POSSIBLE_DUPLICATE - [...include].length;
    db.prepare(
      `UPDATE research_runs SET status = 'IMPORTED', completed_at = ?, records_received = ?, records_imported = ?, records_duplicate = ?,
              records_rejected = ?, input_payload_json = ?, results_json = ?, warnings_json = ? WHERE id = ?`,
    ).run(
      now.toISOString(),
      s.received,
      imported.length,
      s.DUPLICATE + s.DUPLICATE_IN_FILE + notImportedPossible,
      s.INVALID + s.BELOW_THRESHOLD,
      JSON.stringify(internal.payload),
      JSON.stringify(a.records.map((r) => ({ ...r, imported: imported.some((i) => i.index === r.index) }))),
      JSON.stringify(a.fileWarnings),
      run.id,
    );
    audit(db, actor, {
      action: 'RESEARCH_IMPORT_COMMITTED',
      entityType: 'research_run',
      entityId: run.id,
      details: { fileName: a.fileName, configVersion: snapshot.version, summary: s, imported: imported.length, forcedPossibleDuplicates: [...include] },
    }, now);
    return { ok: true, result: { runId: run.id, imported, summary: s } };
  });

  if (outcome.ok) return outcome.result;

  // Record the failed attempt for run history, then report the errors.
  const runId = recordFailedRun(db, actor, input, outcome.internal, now);
  throw new AppError(400, 'IMPORT_INVALID', 'The research file could not be imported', { runId, errors: outcome.fileErrors });
}

function recordFailedRun(db: DB, actor: Actor, input: ImportInput, internal: Internal, now: Date): number {
  return tx(db, () => {
    const run = startResearchRun(
      db,
      actor,
      {
        runType: 'BRAND_DISCOVERY',
        source: 'MANUAL_IMPORT',
        inputFileName: internal.analysis.fileName,
        inputHash: internal.analysis.inputHash,
        inputFormat: input.format,
        schemaVersion: internal.analysis.schemaVersion ?? undefined,
      },
      now,
    );
    db.prepare(`UPDATE research_runs SET status = 'FAILED', completed_at = ?, error_details_json = ?, records_received = ? WHERE id = ?`).run(
      now.toISOString(),
      JSON.stringify(internal.analysis.fileErrors),
      internal.analysis.records.length,
      run.id,
    );
    audit(db, actor, { action: 'RESEARCH_IMPORT_FAILED', entityType: 'research_run', entityId: run.id, details: { errors: internal.analysis.fileErrors } }, now);
    return run.id;
  });
}
