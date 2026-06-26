-- Enable extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Portal types
DO $$
BEGIN
  CREATE TYPE portal_type AS ENUM (
    'current_clients',
    'prospects',
    'private_companies',
    'federal_agencies',
    'state_agencies',
    'counties_and_cities'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

-- ATS providers
DO $$
BEGIN
  CREATE TYPE ats_provider AS ENUM (
    'greenhouse',
    'lever',
    'workday',
    'icims',
    'taleo',
    'smartrecruiters',
    'bamboohr',
    'jobvite',
    'usajobs',
    'other',
    'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

-- Role categories
DO $$
BEGIN
  CREATE TYPE role_category AS ENUM (
    'security',
    'logistics',
    'medical',
    'admin',
    'aviation',
    'engineering',
    'remote',
    'overseas',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

-- Entities table (clients, prospects, companies, agencies)
CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  portal portal_type NOT NULL,
  career_page_url TEXT,
  ats_provider ats_provider DEFAULT 'unknown',
  ats_board_id TEXT,
  industry TEXT,
  category TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Jobs table (raw job postings)
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  external_id TEXT,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  department TEXT,
  role_category role_category DEFAULT 'other',
  location TEXT,
  city TEXT,
  state TEXT,
  country TEXT DEFAULT 'US',
  lat DECIMAL(10, 7),
  lng DECIMAL(10, 7),
  geo GEOMETRY(Point, 4326),
  is_remote BOOLEAN DEFAULT false,
  is_overseas BOOLEAN DEFAULT false,
  posted_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entity_id, external_id, source)
);

-- Hiring snapshots (daily aggregates per entity)
CREATE TABLE IF NOT EXISTS hiring_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_active INTEGER DEFAULT 0,
  new_this_week INTEGER DEFAULT 0,
  closed_count INTEGER DEFAULT 0,
  security_count INTEGER DEFAULT 0,
  logistics_count INTEGER DEFAULT 0,
  medical_count INTEGER DEFAULT 0,
  admin_count INTEGER DEFAULT 0,
  aviation_count INTEGER DEFAULT 0,
  engineering_count INTEGER DEFAULT 0,
  remote_count INTEGER DEFAULT 0,
  overseas_count INTEGER DEFAULT 0,
  other_count INTEGER DEFAULT 0,
  location_data JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entity_id, snapshot_date)
);

-- Ingest log
CREATE TABLE IF NOT EXISTS ingest_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  jobs_found INTEGER DEFAULT 0,
  jobs_new INTEGER DEFAULT 0,
  jobs_closed INTEGER DEFAULT 0,
  error_message TEXT,
  ran_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_jobs_entity_id ON jobs(entity_id);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs(posted_at);
CREATE INDEX IF NOT EXISTS idx_jobs_is_active ON jobs(is_active);
CREATE INDEX IF NOT EXISTS idx_jobs_country ON jobs(country);
CREATE INDEX IF NOT EXISTS idx_jobs_role_category ON jobs(role_category);
CREATE INDEX IF NOT EXISTS idx_jobs_geo ON jobs USING GIST(geo);
CREATE INDEX IF NOT EXISTS idx_snapshots_entity_date ON hiring_snapshots(entity_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_entities_portal ON entities(portal);
CREATE INDEX IF NOT EXISTS idx_entities_active_name_portal ON entities(is_active, portal, lower(trim(name)));
CREATE INDEX IF NOT EXISTS idx_ingest_log_entity_ran_at ON ingest_log(entity_id, ran_at DESC);

-- Update geo point when lat/lng inserted
CREATE OR REPLACE FUNCTION update_job_geo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.geo = ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_job_geo ON jobs;
CREATE TRIGGER trigger_update_job_geo
  BEFORE INSERT OR UPDATE OF lat, lng ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_job_geo();
