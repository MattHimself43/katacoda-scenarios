-- NoirConnects Intelligence — initial schema
-- Conventions:
--   * Timestamps are ISO-8601 UTC strings (TEXT).
--   * JSON payloads are stored as TEXT and validated in application code.
--   * Workflow status values are enforced by application state machines (not CHECK
--     constraints) so new states can be added without table rebuilds. Fixed vocabularies
--     defined by the specification (roles, approval states) use CHECK constraints.
--   * Operational records are never hard-deleted; foreign keys use RESTRICT by default.

-- ─────────────────────────────────────────── Identity & access
CREATE TABLE roles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE CHECK (name IN ('ADMIN','MANAGER','RESEARCHER','VIEWER')),
  description TEXT NOT NULL
);

INSERT INTO roles (id, name, description) VALUES
  (1, 'ADMIN',      'Full access. Sole authority for settings approvals, external emails, final proposals, follow-up policy and integrations.'),
  (2, 'MANAGER',    'Manages pipeline work and requests approvals. Cannot authorize external communication or settings changes.'),
  (3, 'RESEARCHER', 'Imports and prepares research, recommends leads and proposes changes.'),
  (4, 'VIEWER',     'Read-only access to the dashboard.');

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name   TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role_id        INTEGER NOT NULL REFERENCES roles(id),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  is_owner       INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0,1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  last_login_at  TEXT
);
CREATE INDEX idx_users_role ON users(role_id);

CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at   TEXT,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ─────────────────────────────────────────── Universal approval engine
CREATE TABLE approvals (
  id                    TEXT PRIMARY KEY,               -- UUID
  action_type           TEXT NOT NULL,                  -- e.g. SETTINGS_CHANGE, SEND_OUTREACH_EMAIL
  target_entity_type    TEXT NOT NULL,
  target_entity_id      TEXT NOT NULL,
  proposed_action_json  TEXT NOT NULL,                  -- exact action that will be executed
  content_hash          TEXT NOT NULL,                  -- sha256 of canonical proposed_action_json
  content_version       INTEGER,                        -- optional entity version (e.g. draft version)
  required_role         TEXT NOT NULL DEFAULT 'ADMIN' CHECK (required_role IN ('ADMIN','MANAGER')),
  status                TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED','EXECUTED')),
  requested_by          INTEGER REFERENCES users(id),   -- NULL = system actor
  requested_at          TEXT NOT NULL,
  expires_at            TEXT,
  decided_by            INTEGER REFERENCES users(id),
  decided_at            TEXT,
  decision_notes        TEXT,
  executed_at           TEXT,
  execution_result_json TEXT,
  lock_version          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_approvals_status ON approvals(status, action_type);
CREATE INDEX idx_approvals_target ON approvals(target_entity_type, target_entity_id);
-- At most one live (PENDING or APPROVED-not-yet-executed) approval per target + action.
CREATE UNIQUE INDEX uq_approvals_live_target ON approvals(action_type, target_entity_type, target_entity_id)
  WHERE status IN ('PENDING','APPROVED');

-- ─────────────────────────────────────────── Configuration (versioned, approval-controlled)
CREATE TABLE settings_versions (
  id                 INTEGER PRIMARY KEY,
  version            INTEGER NOT NULL UNIQUE,
  config_json        TEXT NOT NULL,
  config_hash        TEXT NOT NULL,
  change_request_id  INTEGER REFERENCES settings_change_requests(id),
  created_by         INTEGER REFERENCES users(id),
  approved_by        INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL,
  notes              TEXT
);

-- Current active values, one row per configuration key. Always consistent with the
-- settings_versions row referenced by settings_version_id (written in one transaction).
CREATE TABLE settings (
  key                  TEXT PRIMARY KEY,
  value_json           TEXT NOT NULL,
  settings_version_id  INTEGER NOT NULL REFERENCES settings_versions(id),
  updated_at           TEXT NOT NULL
);

CREATE TABLE settings_change_requests (
  id                    INTEGER PRIMARY KEY,
  base_version          INTEGER NOT NULL,          -- active version when the change was proposed
  proposed_config_json  TEXT NOT NULL,             -- full proposed configuration
  changes_json          TEXT NOT NULL,             -- [{key, from, to}]
  reason                TEXT,
  status                TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED','SUPERSEDED')),
  approval_id           TEXT REFERENCES approvals(id),
  requested_by          INTEGER NOT NULL REFERENCES users(id),
  requested_at          TEXT NOT NULL,
  decided_by            INTEGER REFERENCES users(id),
  decided_at            TEXT,
  decision_notes        TEXT,
  resulting_version_id  INTEGER REFERENCES settings_versions(id)
);
CREATE INDEX idx_scr_status ON settings_change_requests(status);

-- ─────────────────────────────────────────── Research runs
CREATE TABLE research_runs (
  id                    INTEGER PRIMARY KEY,
  run_type              TEXT NOT NULL,             -- BRAND_DISCOVERY | CREATOR_DISCOVERY
  source                TEXT NOT NULL,             -- MANUAL_IMPORT | SCHEDULED_IMPORT
  status                TEXT NOT NULL,             -- STARTED | PREVIEWED | IMPORTED | FAILED | CANCELLED
  settings_version_id   INTEGER NOT NULL REFERENCES settings_versions(id),
  config_snapshot_json  TEXT NOT NULL,             -- immutable copy of the configuration used
  brand_id              INTEGER REFERENCES brands(id),   -- for creator research
  started_by            INTEGER REFERENCES users(id),
  started_at            TEXT NOT NULL,
  completed_at          TEXT,
  input_file_name       TEXT,
  input_hash            TEXT,
  records_received      INTEGER NOT NULL DEFAULT 0,
  records_imported      INTEGER NOT NULL DEFAULT 0,
  records_duplicate     INTEGER NOT NULL DEFAULT 0,
  records_rejected      INTEGER NOT NULL DEFAULT 0,
  error_details_json    TEXT
);
CREATE INDEX idx_research_runs_type ON research_runs(run_type, started_at);

-- ─────────────────────────────────────────── Brands
CREATE TABLE brands (
  id                            INTEGER PRIMARY KEY,
  name                          TEXT NOT NULL,
  normalized_name               TEXT NOT NULL,
  website_url                   TEXT NOT NULL,
  website_domain                TEXT NOT NULL UNIQUE,   -- normalized registrable domain (dedupe key)
  industry                      TEXT,
  subcategory                   TEXT,
  target_markets_json           TEXT NOT NULL DEFAULT '[]',
  products_services             TEXT,
  influencer_activity_summary   TEXT,
  contact_name                  TEXT,
  contact_name_verified         INTEGER NOT NULL DEFAULT 0,
  contact_role                  TEXT,
  contact_role_verified         INTEGER NOT NULL DEFAULT 0,
  contact_email                 TEXT COLLATE NOCASE,
  contact_email_verified        INTEGER NOT NULL DEFAULT 0,
  contact_channel_url           TEXT,
  quality_score                 INTEGER CHECK (quality_score BETWEEN 0 AND 100),
  recommendation_reason         TEXT,
  discovery_niche               TEXT NOT NULL,
  settings_version_id           INTEGER NOT NULL REFERENCES settings_versions(id),
  research_run_id               INTEGER REFERENCES research_runs(id),
  researched_at                 TEXT NOT NULL,
  status                        TEXT NOT NULL DEFAULT 'PENDING_BRAND_APPROVAL',
  outreach_cycle                INTEGER NOT NULL DEFAULT 1,
  created_at                    TEXT NOT NULL,
  updated_at                    TEXT NOT NULL
);
CREATE INDEX idx_brands_status ON brands(status);
CREATE INDEX idx_brands_name ON brands(normalized_name);
CREATE INDEX idx_brands_created ON brands(created_at);

CREATE TABLE brand_evidence (
  id                   INTEGER PRIMARY KEY,
  brand_id             INTEGER NOT NULL REFERENCES brands(id),
  research_run_id      INTEGER REFERENCES research_runs(id),
  evidence_type        TEXT NOT NULL,   -- PAID_SPONSORSHIP | AMBASSADOR_PROGRAM | AFFILIATE_PROGRAM | CREATOR_ANNOUNCEMENT | OTHER
  description          TEXT NOT NULL,
  source_url           TEXT,
  evidence_date        TEXT,
  creator_name         TEXT,
  platform             TEXT,
  verification_status  TEXT NOT NULL DEFAULT 'UNVERIFIED',  -- VERIFIED | UNVERIFIED
  captured_at          TEXT NOT NULL
);
CREATE INDEX idx_brand_evidence_brand ON brand_evidence(brand_id);

CREATE TABLE brand_approvals (
  id           INTEGER PRIMARY KEY,
  brand_id     INTEGER NOT NULL REFERENCES brands(id),
  decision     TEXT NOT NULL CHECK (decision IN ('APPROVED','DECLINED','REOPENED')),
  decided_by   INTEGER NOT NULL REFERENCES users(id),
  decided_at   TEXT NOT NULL,
  notes        TEXT,
  approval_id  TEXT REFERENCES approvals(id)
);
CREATE INDEX idx_brand_approvals_brand ON brand_approvals(brand_id);

-- ─────────────────────────────────────────── Outreach & mail
CREATE TABLE outreach_drafts (
  id                     INTEGER PRIMARY KEY,
  brand_id               INTEGER NOT NULL REFERENCES brands(id),
  draft_kind             TEXT NOT NULL,     -- INITIAL | FOLLOWUP | CLARIFICATION | PROPOSAL
  outreach_cycle         INTEGER NOT NULL DEFAULT 1,
  version                INTEGER NOT NULL DEFAULT 1,
  recipient_email        TEXT COLLATE NOCASE,
  subject                TEXT NOT NULL,
  body_text              TEXT NOT NULL,
  attachments_json       TEXT NOT NULL DEFAULT '[]',
  source_evidence_json   TEXT NOT NULL DEFAULT '[]',
  content_hash           TEXT NOT NULL,
  status                 TEXT NOT NULL,     -- DRAFT | PENDING_EMAIL_APPROVAL | PENDING_FOLLOWUP_APPROVAL | APPROVED | SENT | REJECTED | SUPERSEDED | RECONCILIATION_REQUIRED
  approval_id            TEXT REFERENCES approvals(id),
  in_reply_to_message_id INTEGER REFERENCES email_messages(id),
  created_by             INTEGER REFERENCES users(id),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX idx_outreach_drafts_brand ON outreach_drafts(brand_id);
CREATE INDEX idx_outreach_drafts_status ON outreach_drafts(status);

CREATE TABLE email_messages (
  id                         INTEGER PRIMARY KEY,
  brand_id                   INTEGER REFERENCES brands(id),
  direction                  TEXT NOT NULL CHECK (direction IN ('OUTBOUND','INBOUND')),
  provider                   TEXT NOT NULL,
  provider_message_id        TEXT,
  message_id_header          TEXT UNIQUE,
  in_reply_to_header         TEXT,
  references_json            TEXT NOT NULL DEFAULT '[]',
  thread_key                 TEXT,
  from_address               TEXT NOT NULL COLLATE NOCASE,
  to_addresses_json          TEXT NOT NULL,
  cc_addresses_json          TEXT NOT NULL DEFAULT '[]',
  subject                    TEXT,
  body_text                  TEXT,
  occurred_at                TEXT NOT NULL,      -- sent_at for outbound, received_at for inbound
  draft_id                   INTEGER REFERENCES outreach_drafts(id),
  classification             TEXT,
  classification_method      TEXT,               -- DETERMINISTIC | MANUAL
  needs_review               INTEGER NOT NULL DEFAULT 0,
  reviewed_by                INTEGER REFERENCES users(id),
  reviewed_at                TEXT,
  created_at                 TEXT NOT NULL,
  UNIQUE (provider, provider_message_id)
);
CREATE INDEX idx_email_messages_brand ON email_messages(brand_id, occurred_at);
CREATE INDEX idx_email_messages_direction ON email_messages(direction, occurred_at);

CREATE TABLE email_send_attempts (
  id                      INTEGER PRIMARY KEY,
  draft_id                INTEGER NOT NULL REFERENCES outreach_drafts(id),
  approval_id             TEXT NOT NULL REFERENCES approvals(id),
  idempotency_key         TEXT NOT NULL UNIQUE,
  provider                TEXT NOT NULL,
  status                  TEXT NOT NULL,   -- IN_FLIGHT | SUCCEEDED | FAILED | RECONCILIATION_REQUIRED
  provider_message_id     TEXT,
  provider_response_json  TEXT,
  error                   TEXT,
  attempted_by            INTEGER REFERENCES users(id),
  attempted_at            TEXT NOT NULL,
  completed_at            TEXT
);
-- An approval can be executed by at most one send attempt.
CREATE UNIQUE INDEX uq_send_attempt_approval ON email_send_attempts(approval_id);

CREATE TABLE followup_jobs (
  id               INTEGER PRIMARY KEY,
  brand_id         INTEGER NOT NULL REFERENCES brands(id),
  outreach_cycle   INTEGER NOT NULL DEFAULT 1,
  sequence_number  INTEGER NOT NULL,             -- 1, 2 (…max_followups)
  base_message_id  INTEGER REFERENCES email_messages(id),
  due_at           TEXT NOT NULL,
  status           TEXT NOT NULL,                -- SCHEDULED | DRAFT_PENDING_APPROVAL | SENT | CANCELLED
  draft_id         INTEGER REFERENCES outreach_drafts(id),
  cancelled_reason TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (brand_id, outreach_cycle, sequence_number)
);
CREATE INDEX idx_followup_jobs_due ON followup_jobs(status, due_at);

CREATE TABLE suppression_list (
  id                 INTEGER PRIMARY KEY,
  email              TEXT COLLATE NOCASE,
  domain             TEXT COLLATE NOCASE,
  reason             TEXT NOT NULL,          -- OPT_OUT | BOUNCE | MANUAL
  source_message_id  INTEGER REFERENCES email_messages(id),
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL,
  CHECK (email IS NOT NULL OR domain IS NOT NULL)
);
CREATE UNIQUE INDEX uq_suppression_email ON suppression_list(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX uq_suppression_domain ON suppression_list(domain) WHERE domain IS NOT NULL AND email IS NULL;

-- ─────────────────────────────────────────── Creators
CREATE TABLE creator_profiles (
  id                       INTEGER PRIMARY KEY,
  display_name             TEXT NOT NULL,
  handle                   TEXT NOT NULL,
  normalized_handle        TEXT NOT NULL,
  platform                 TEXT NOT NULL,
  profile_url              TEXT NOT NULL,
  niche                    TEXT,
  audience_metrics_json    TEXT NOT NULL DEFAULT '{}',
  engagement_json          TEXT NOT NULL DEFAULT '{}',
  recent_content_json      TEXT NOT NULL DEFAULT '[]',
  sponsorship_history_json TEXT NOT NULL DEFAULT '[]',
  audience_markets_json    TEXT NOT NULL DEFAULT '[]',
  contact_email            TEXT COLLATE NOCASE,
  contact_source_url       TEXT,
  representation_status    TEXT NOT NULL DEFAULT 'AVAILABILITY_UNCONFIRMED',
  availability_status      TEXT NOT NULL DEFAULT 'UNCONFIRMED',
  verified_at              TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE (platform, normalized_handle)
);

CREATE TABLE creator_evidence (
  id                   INTEGER PRIMARY KEY,
  creator_id           INTEGER NOT NULL REFERENCES creator_profiles(id),
  research_run_id      INTEGER REFERENCES research_runs(id),
  evidence_type        TEXT NOT NULL,
  description          TEXT NOT NULL,
  source_url           TEXT,
  evidence_date        TEXT,
  verification_status  TEXT NOT NULL DEFAULT 'UNVERIFIED',
  captured_at          TEXT NOT NULL
);
CREATE INDEX idx_creator_evidence_creator ON creator_evidence(creator_id);

CREATE TABLE brand_requirements (
  id                        INTEGER PRIMARY KEY,
  brand_id                  INTEGER NOT NULL REFERENCES brands(id),
  source_message_id         INTEGER REFERENCES email_messages(id),
  version                   INTEGER NOT NULL DEFAULT 1,
  desired_niche             TEXT,
  platforms_json            TEXT NOT NULL DEFAULT '[]',
  audience_geography_json   TEXT NOT NULL DEFAULT '[]',
  audience_demographics     TEXT,
  campaign_goals            TEXT,
  content_formats_json      TEXT NOT NULL DEFAULT '[]',
  budget                    TEXT,
  deliverables              TEXT,
  timeline                  TEXT,
  restrictions              TEXT,
  missing_requirements_json TEXT NOT NULL DEFAULT '[]',
  status                    TEXT NOT NULL,       -- DRAFT | CONFIRMED | SUPERSEDED
  created_by                INTEGER REFERENCES users(id),
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  UNIQUE (brand_id, version)
);

CREATE TABLE creator_matches (
  id                  INTEGER PRIMARY KEY,
  brand_id            INTEGER NOT NULL REFERENCES brands(id),
  requirements_id     INTEGER NOT NULL REFERENCES brand_requirements(id),
  creator_id          INTEGER NOT NULL REFERENCES creator_profiles(id),
  research_run_id     INTEGER REFERENCES research_runs(id),
  score_relevance     REAL,
  score_engagement    REAL,
  score_content       REAL,
  score_sponsorship   REAL,
  score_budget        REAL,
  weights_json        TEXT NOT NULL,
  total_score         REAL,
  rank                INTEGER,
  explanation         TEXT,
  status              TEXT NOT NULL DEFAULT 'CANDIDATE',  -- CANDIDATE | APPROVED | REJECTED | REPLACEMENT_REQUESTED
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (requirements_id, creator_id)
);
CREATE INDEX idx_creator_matches_brand ON creator_matches(brand_id, status);

CREATE TABLE shortlist_decisions (
  id                INTEGER PRIMARY KEY,
  brand_id          INTEGER NOT NULL REFERENCES brands(id),
  requirements_id   INTEGER REFERENCES brand_requirements(id),
  creator_match_id  INTEGER REFERENCES creator_matches(id),
  decision_type     TEXT NOT NULL,   -- APPROVE_CREATOR | REJECT_CREATOR | NOTE | REORDER | REQUEST_REPLACEMENT | FINALIZE
  payload_json      TEXT NOT NULL DEFAULT '{}',
  decided_by        INTEGER NOT NULL REFERENCES users(id),
  decided_at        TEXT NOT NULL
);
CREATE INDEX idx_shortlist_decisions_brand ON shortlist_decisions(brand_id);

-- ─────────────────────────────────────────── Proposals
CREATE TABLE proposals (
  id                INTEGER PRIMARY KEY,
  brand_id          INTEGER NOT NULL REFERENCES brands(id),
  requirements_id   INTEGER REFERENCES brand_requirements(id),
  version           INTEGER NOT NULL DEFAULT 1,
  recipient_email   TEXT COLLATE NOCASE,
  subject           TEXT NOT NULL,
  body_text         TEXT NOT NULL,
  creators_json     TEXT NOT NULL DEFAULT '[]',
  attachments_json  TEXT NOT NULL DEFAULT '[]',
  content_hash      TEXT NOT NULL,
  status            TEXT NOT NULL,     -- DRAFT | PENDING_PROPOSAL_APPROVAL | APPROVED | PROPOSAL_SENT | REJECTED | SUPERSEDED
  approval_id       TEXT REFERENCES approvals(id),
  sent_message_id   INTEGER REFERENCES email_messages(id),
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_proposals_brand ON proposals(brand_id);
CREATE INDEX idx_proposals_status ON proposals(status);

-- ─────────────────────────────────────────── Audit log (append-only)
CREATE TABLE audit_logs (
  id            INTEGER PRIMARY KEY,
  occurred_at   TEXT NOT NULL,
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('USER','SYSTEM','SCHEDULER')),
  actor_user_id INTEGER REFERENCES users(id),
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  details_json  TEXT NOT NULL DEFAULT '{}',
  ip            TEXT
);
CREATE INDEX idx_audit_logs_time ON audit_logs(occurred_at);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);

CREATE TRIGGER trg_audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER trg_audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

CREATE TRIGGER trg_settings_versions_no_update BEFORE UPDATE ON settings_versions
BEGIN SELECT RAISE(ABORT, 'settings_versions are immutable'); END;
CREATE TRIGGER trg_settings_versions_no_delete BEFORE DELETE ON settings_versions
BEGIN SELECT RAISE(ABORT, 'settings_versions are immutable'); END;

CREATE TRIGGER trg_research_runs_snapshot_immutable BEFORE UPDATE OF settings_version_id, config_snapshot_json ON research_runs
BEGIN SELECT RAISE(ABORT, 'research run configuration snapshot is immutable'); END;
