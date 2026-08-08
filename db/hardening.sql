-- Forward-compatible hardening migrations applied after schema.sql.
-- Existing enum-backed databases need these values before the expanded resolver can persist detections.
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'ashby';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'recruitee';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'oracle';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'successfactors';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'workable';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'teamtailor';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'personio';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'comeet';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'breezyhr';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'jazzhr';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'rippling';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'dayforce';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'ukg';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'adp';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'paylocity';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'paycom';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'neogov';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'governmentjobs';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'applicantpro';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'pinpoint';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'zoho_recruit';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'bullhorn';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'ceipal';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'clearcompany';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'cornerstone';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'eightfold';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'avature';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'phenom';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'hirebridge';
ALTER TYPE ats_provider ADD VALUE IF NOT EXISTS 'silkroad';

CREATE TABLE IF NOT EXISTS location_geocode_cache (
  query_key TEXT PRIMARY KEY,
  query_text TEXT NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  city TEXT,
  state TEXT,
  country TEXT,
  quality TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Census Government Units Listing / Governments Master Address File mirror.
-- The raw Census row is retained so newer annual layouts can be ingested without
-- destructive schema churn while the normalized fields support fast resolution.
CREATE TABLE IF NOT EXISTS government_registry (
  census_government_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  government_type TEXT,
  state_fips TEXT,
  state_code TEXT,
  state_name TEXT,
  county_fips TEXT,
  county_name TEXT,
  place_fips TEXT,
  website TEXT,
  source_year INTEGER NOT NULL DEFAULT 2025,
  source_url TEXT,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_government_registry_name ON government_registry(lower(canonical_name));
CREATE INDEX IF NOT EXISTS idx_government_registry_state ON government_registry(state_code, government_type);
CREATE INDEX IF NOT EXISTS idx_government_registry_active ON government_registry(is_active);

ALTER TABLE entities ADD COLUMN IF NOT EXISTS government_registry_id TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS government_type TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS government_state TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS government_fips TEXT;
CREATE INDEX IF NOT EXISTS idx_entities_government_registry_id ON entities(government_registry_id);

-- Per-source observability. This is deliberately separate from ingest_log: one
-- ingest can check many independent sources and a legitimate zero is meaningful.
CREATE TABLE IF NOT EXISTS entity_source_coverage (
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_class TEXT NOT NULL DEFAULT 'supplemental',
  status TEXT NOT NULL,
  jobs_found INTEGER NOT NULL DEFAULT 0,
  authoritative_zero BOOLEAN NOT NULL DEFAULT false,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_success_at TIMESTAMPTZ,
  PRIMARY KEY (entity_id, source)
);
CREATE INDEX IF NOT EXISTS idx_source_coverage_entity ON entity_source_coverage(entity_id, last_checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_coverage_status ON entity_source_coverage(status, source_class);
