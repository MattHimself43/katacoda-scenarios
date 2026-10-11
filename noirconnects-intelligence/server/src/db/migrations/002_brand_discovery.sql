-- Phase 2: brand discovery, research imports and brand approval queue.

ALTER TABLE brands ADD COLUMN quality_breakdown_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE brands ADD COLUMN warnings_json TEXT NOT NULL DEFAULT '[]';
-- The approval request currently governing this brand's qualification decision.
ALTER TABLE brands ADD COLUMN approval_id TEXT REFERENCES approvals(id);

ALTER TABLE research_runs ADD COLUMN schema_version TEXT;
ALTER TABLE research_runs ADD COLUMN input_format TEXT;            -- JSON | CSV
ALTER TABLE research_runs ADD COLUMN input_payload_json TEXT;      -- normalized payload as received (traceability)
ALTER TABLE research_runs ADD COLUMN results_json TEXT;            -- per-record outcomes
ALTER TABLE research_runs ADD COLUMN warnings_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX idx_research_runs_input_hash ON research_runs(input_hash);
CREATE INDEX idx_brands_quality ON brands(status, quality_score DESC);
CREATE INDEX idx_brand_evidence_type ON brand_evidence(brand_id, evidence_type);
