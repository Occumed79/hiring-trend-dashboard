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
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_government_registry_name ON government_registry(lower(canonical_name));
CREATE INDEX IF NOT EXISTS idx_government_registry_name_trgm ON government_registry USING gin (canonical_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_government_registry_state ON government_registry(state_code, government_type);
CREATE INDEX IF NOT EXISTS idx_government_registry_active ON government_registry(is_active);

ALTER TABLE entities ADD COLUMN IF NOT EXISTS government_registry_id TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS government_type TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS government_state TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS government_fips TEXT;
CREATE INDEX IF NOT EXISTS idx_entities_government_registry_id ON entities(government_registry_id);

-- Per-source observability. One ingest can check many independent sources and a legitimate zero is meaningful.
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
ALTER TABLE entity_source_coverage ADD COLUMN IF NOT EXISTS lineage_root TEXT;
ALTER TABLE entity_source_coverage ADD COLUMN IF NOT EXISTS source_key TEXT;
CREATE INDEX IF NOT EXISTS idx_source_coverage_entity ON entity_source_coverage(entity_id, last_checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_coverage_status ON entity_source_coverage(status, source_class);
CREATE INDEX IF NOT EXISTS idx_source_coverage_lineage ON entity_source_coverage(entity_id, lineage_root);

-- An entity can own multiple independent official hiring surfaces. This is the
-- canonical source graph rather than forcing every employer into one ATS field.
CREATE TABLE IF NOT EXISTS entity_job_sources (
  id BIGSERIAL PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_class TEXT NOT NULL DEFAULT 'authoritative',
  lineage_root TEXT NOT NULL,
  source_url TEXT,
  ats_provider TEXT,
  board_id TEXT,
  state_code TEXT,
  discovery_method TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_id, source_key)
);
CREATE INDEX IF NOT EXISTS idx_entity_job_sources_entity ON entity_job_sources(entity_id, is_active, source_class);
CREATE INDEX IF NOT EXISTS idx_entity_job_sources_lineage ON entity_job_sources(entity_id, lineage_root);
CREATE INDEX IF NOT EXISTS idx_entity_job_sources_provider ON entity_job_sources(ats_provider, is_active);

-- Global directories discovered from authoritative associations/directories.
-- These are refreshed periodically so state/local source coverage can evolve
-- without shipping a new application build for every URL change.
CREATE TABLE IF NOT EXISTS source_directory_entries (
  directory_key TEXT NOT NULL,
  entry_key TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  state_code TEXT,
  organization_name TEXT NOT NULL,
  source_url TEXT,
  jobs_url TEXT,
  source_class TEXT NOT NULL DEFAULT 'verified',
  lineage_root TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (directory_key, entry_key)
);
CREATE INDEX IF NOT EXISTS idx_source_directory_state ON source_directory_entries(state_code, entry_type, is_active);
CREATE INDEX IF NOT EXISTS idx_source_directory_type ON source_directory_entries(entry_type, is_active);

-- Legal/contractor identity graph used to keep aliases, parents, subsidiaries,
-- UEIs and CAGE codes from turning into false negatives during employer matching.
CREATE TABLE IF NOT EXISTS entity_identifiers (
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  identifier_type TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  canonical_name TEXT,
  source TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entity_id, identifier_type, identifier_value, source)
);
CREATE INDEX IF NOT EXISTS idx_entity_identifiers_entity ON entity_identifiers(entity_id, is_active);
CREATE INDEX IF NOT EXISTS idx_entity_identifiers_value ON entity_identifiers(identifier_type, identifier_value);

-- One compact score per entity. It is recalculated from expected source graph
-- entries plus the latest health checks; it is not a subjective manual rating.
CREATE TABLE IF NOT EXISTS entity_coverage_assessment (
  entity_id UUID PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  grade TEXT NOT NULL DEFAULT 'unknown',
  expected_sources INTEGER NOT NULL DEFAULT 0,
  checked_sources INTEGER NOT NULL DEFAULT 0,
  authoritative_sources INTEGER NOT NULL DEFAULT 0,
  healthy_authoritative_sources INTEGER NOT NULL DEFAULT 0,
  independent_lineages INTEGER NOT NULL DEFAULT 0,
  gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coverage_assessment_score ON entity_coverage_assessment(score, grade);