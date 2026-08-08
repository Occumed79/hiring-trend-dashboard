-- Benchmark / validation evidence is intentionally separate from operational job rows.
-- These tables preserve immutable truth snapshots, benchmark runs, learned source-pair
-- behavior, and portal release assessments.

CREATE TABLE IF NOT EXISTS benchmark_truth_snapshots (
  id BIGSERIAL PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_url TEXT,
  source_label TEXT,
  official_job_count INTEGER CHECK (official_job_count IS NULL OR official_job_count >= 0),
  job_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  sampled_job_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  captured_by TEXT,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_benchmark_truth_entity_captured
  ON benchmark_truth_snapshots(entity_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS benchmark_source_audits (
  id BIGSERIAL PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  source_label TEXT,
  source_url TEXT,
  ats_provider TEXT,
  status TEXT NOT NULL,
  complete BOOLEAN NOT NULL DEFAULT false,
  official_job_count INTEGER CHECK (official_job_count IS NULL OR official_job_count >= 0),
  job_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  truth_eligible BOOLEAN NOT NULL DEFAULT false,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  audited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_benchmark_source_audits_entity
  ON benchmark_source_audits(entity_id, audited_at DESC);
CREATE INDEX IF NOT EXISTS idx_benchmark_source_audits_status
  ON benchmark_source_audits(status, truth_eligible, audited_at DESC);

CREATE TABLE IF NOT EXISTS benchmark_cohort_members (
  entity_id UUID PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  portal TEXT NOT NULL,
  cohort_key TEXT NOT NULL DEFAULT 'default',
  selection_reason TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_included_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_benchmark_cohort_portal
  ON benchmark_cohort_members(cohort_key, portal, is_active, added_at);

CREATE TABLE IF NOT EXISTS benchmark_runs (
  id BIGSERIAL PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'scheduled',
  scope TEXT NOT NULL DEFAULT 'tracked_entities',
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_started ON benchmark_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS benchmark_results (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  portal TEXT NOT NULL,
  benchmark_mode TEXT NOT NULL,
  app_job_count INTEGER NOT NULL DEFAULT 0,
  reference_job_count INTEGER,
  matched_job_count INTEGER,
  missing_job_count INTEGER,
  unexpected_job_count INTEGER,
  precision_score NUMERIC(7,6),
  recall_score NUMERIC(7,6),
  parity_score NUMERIC(7,6),
  duplicate_rate NUMERIC(7,6),
  stale_rate NUMERIC(7,6),
  mapped_rate NUMERIC(7,6),
  authoritative_health_rate NUMERIC(7,6),
  high_incident_count INTEGER NOT NULL DEFAULT 0,
  passed BOOLEAN,
  evidence_level TEXT NOT NULL DEFAULT 'parity_only',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(run_id, entity_id, benchmark_mode)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_run_portal
  ON benchmark_results(run_id, portal, benchmark_mode);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_entity
  ON benchmark_results(entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS source_pair_baselines (
  source_a TEXT NOT NULL,
  source_b TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  median_ratio NUMERIC(9,6),
  p10_ratio NUMERIC(9,6),
  p90_ratio NUMERIC(9,6),
  median_abs_delta NUMERIC(12,3),
  window_days INTEGER NOT NULL DEFAULT 30,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_a, source_b)
);
CREATE INDEX IF NOT EXISTS idx_source_pair_baselines_samples
  ON source_pair_baselines(sample_count DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS portal_release_assessments (
  portal_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'insufficient_evidence',
  benchmark_entity_count INTEGER NOT NULL DEFAULT 0,
  truth_entity_count INTEGER NOT NULL DEFAULT 0,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
