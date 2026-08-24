-- TheirStack live saved-list assignments and runtime receiver token state.
-- Idempotent so Render cron migrations and runtime safety checks can coexist.

CREATE TABLE IF NOT EXISTS theirstack_monitor_assignments (
  env_key TEXT NOT NULL,
  company_name TEXT NOT NULL,
  portal TEXT NOT NULL,
  list_id BIGINT,
  list_name TEXT,
  source TEXT NOT NULL DEFAULT 'config_fallback',
  is_active BOOLEAN NOT NULL DEFAULT true,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (env_key, company_name)
);

CREATE INDEX IF NOT EXISTS idx_theirstack_monitor_assignments_active
  ON theirstack_monitor_assignments (is_active, env_key);

CREATE TABLE IF NOT EXISTS theirstack_monitor_sync_state (
  env_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  list_id BIGINT,
  list_name TEXT,
  bootstrap_overlap INTEGER NOT NULL DEFAULT 0,
  live_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS runtime_secrets (
  name TEXT PRIMARY KEY,
  secret_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
