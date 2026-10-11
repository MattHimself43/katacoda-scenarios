export type Role = 'ADMIN' | 'MANAGER' | 'RESEARCHER' | 'VIEWER';

export interface Me {
  user: { id: number; email: string; displayName: string; role: Role; isOwner: boolean };
  permissions: string[];
}

export interface RankingWeights {
  relevance: number;
  engagement: number;
  contentQuality: number;
  sponsorshipSuitability: number;
  budgetPracticality: number;
}

export interface FollowUpPolicy {
  firstFollowUpBusinessDays: number;
  secondFollowUpBusinessDays: number;
  maxFollowUps: number;
  dormantAfterBusinessDays: number;
  excludeWeekends: true;
  requireApproval: true;
}

export interface IntelligenceConfig {
  activeNiche: string;
  customNiche: string | null;
  dailyBrandTarget: number;
  targetGeography: string;
  targetLanguage: string;
  researchFrequency: 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MANUAL';
  discoveryMode: 'VERIFIED_INFLUENCER_ACTIVITY';
  minBrandQualityScore: number;
  sponsorshipRecencyMonths: number;
  businessTimeZone: string;
  creatorsPerResearchAssignment: number;
  creatorRankingWeights: RankingWeights;
  followUpPolicy: FollowUpPolicy;
  requireCreatorAvailabilityConfirmation: boolean;
  automaticExternalCommunication: false;
  humanApprovalRequired: true;
}

export interface SettingsResponse {
  active: {
    versionId: number;
    version: number;
    config: IntelligenceConfig;
    configHash: string;
    createdAt: string;
    approvedBy: string | null;
    notes: string | null;
    effectiveNiche: string;
  };
  options: { niches: string[]; researchFrequencies: string[]; discoveryModes: string[] };
  adminOnlyKeys: string[];
  lockedKeys: string[];
  pendingCount: number;
  lastSuccessfulResearchRun: { id: number; completed_at: string; records_imported: number; settings_version: number } | null;
  researchScheduling: { status: string; detail: string };
}

export interface ConfigChange {
  key: keyof IntelligenceConfig;
  from: unknown;
  to: unknown;
}

export interface ChangeRequest {
  id: number;
  base_version: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'SUPERSEDED';
  reason: string | null;
  changes: ConfigChange[];
  approval_id: string | null;
  approval_status: string | null;
  content_hash: string | null;
  requested_by: number;
  requested_by_name: string;
  requested_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  resulting_version: number | null;
  is_stale: boolean;
}

export interface SettingsVersion {
  id: number;
  version: number;
  config: IntelligenceConfig;
  config_hash: string;
  change_request_id: number | null;
  created_at: string;
  notes: string | null;
  requested_by: string | null;
  approved_by: string | null;
}

export interface Overview {
  generatedAt: string;
  timeZone: string;
  metrics: Record<
    | 'brandsDiscoveredToday'
    | 'brandsAwaitingApproval'
    | 'emailDraftsAwaitingApproval'
    | 'emailsSent'
    | 'responsesReceived'
    | 'followUpsDue'
    | 'brandsRequestingCreators'
    | 'shortlistsAwaitingApproval'
    | 'proposalsAwaitingApproval'
    | 'dormantOutreach',
    number
  >;
  pendingSettingsChanges: number;
  configuration: { version: number; niche: string; dailyBrandTarget: number };
  lastSuccessfulResearchRun: { completed_at: string; records_imported: number } | null;
  integrations: Record<'mail' | 'research' | 'scheduler', { status: string; detail: string }>;
}

export interface AuditEntry {
  id: number;
  occurred_at: string;
  actor_type: 'USER' | 'SYSTEM' | 'SCHEDULER';
  actor_user_id: number | null;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
}

export interface UserRecord {
  id: number;
  email: string;
  display_name: string;
  role: Role;
  is_active: number;
  is_owner: number;
  created_at: string;
  last_login_at: string | null;
}

// ─── Phase 2: brands & research imports
export interface QualityBreakdown {
  evidence: number;
  recency: number;
  contactability: number;
  completeness: number;
  nicheFit: number;
  total: number;
  notes: string[];
}

export interface BrandSummary {
  id: number;
  name: string;
  website_url: string;
  website_domain: string;
  industry: string | null;
  subcategory: string | null;
  quality_score: number | null;
  status: string;
  discovery_niche: string;
  contact_email: string | null;
  contact_email_verified: number;
  contact_channel_url: string | null;
  created_at: string;
  researched_at: string;
  settings_version: number;
  partnership_evidence: number;
  affiliate_evidence: number;
  verified_evidence: number;
  total_evidence: number;
  warnings: string[];
}

export interface BrandEvidence {
  id: number;
  evidence_type: string;
  description: string;
  source_url: string | null;
  evidence_date: string | null;
  creator_name: string | null;
  platform: string | null;
  verification_status: 'VERIFIED' | 'UNVERIFIED';
  captured_at: string;
  research_run_id: number | null;
}

export interface BrandDetail {
  brand: BrandSummary & {
    products_services: string | null;
    influencer_activity_summary: string | null;
    recommendation_reason: string | null;
    contact_name: string | null;
    contact_name_verified: number;
    contact_role: string | null;
    contact_role_verified: number;
    research_run_id: number | null;
    target_markets: string[];
    quality_breakdown: Partial<QualityBreakdown>;
    updated_at: string;
  };
  evidence: BrandEvidence[];
  decisions: { id: number; decision: string; decided_at: string; notes: string | null; decided_by: string }[];
  approval: { id: string; status: string; content_hash: string; requested_at: string; requested_by_name: string | null } | null;
}

export type RecordOutcome = 'NEW' | 'DUPLICATE' | 'DUPLICATE_IN_FILE' | 'POSSIBLE_DUPLICATE' | 'BELOW_THRESHOLD' | 'INVALID';

export interface ImportRecord {
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
  imported?: boolean;
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
  records: ImportRecord[];
  alreadyImported: { runId: number; completedAt: string } | null;
}

export interface ResearchRunSummary {
  id: number;
  run_type: string;
  source: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  input_file_name: string | null;
  input_format: string | null;
  schema_version: string | null;
  records_received: number;
  records_imported: number;
  records_duplicate: number;
  records_rejected: number;
  settings_version: number;
  started_by_name: string | null;
  niche: string | null;
  error_details: string[] | null;
  warnings: string[];
}
