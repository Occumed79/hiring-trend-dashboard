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
