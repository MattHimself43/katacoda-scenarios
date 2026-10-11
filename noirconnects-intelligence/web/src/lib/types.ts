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
