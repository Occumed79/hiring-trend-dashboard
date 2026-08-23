const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sweep = fs.readFileSync('lib/ingest/theirStackCompanySweep.ts', 'utf8');
const legacy = fs.readFileSync('lib/ingest/theirStack.ts', 'utf8');
const cron = fs.readFileSync('scripts/ingest.js', 'utf8');
const route = fs.readFileSync('app/api/ingest/theirstack/company-sweep/route.ts', 'utf8');

test('scheduled TheirStack discovery uses Company Search with a bounded date signal', () => {
  assert.match(sweep, /\/v1\/companies\/search/);
  assert.match(sweep, /posted_at_max_age_days:\s*LOOKBACK_DAYS/);
  assert.match(sweep, /min_num_jobs_found:\s*1/);
  assert.match(sweep, /COMPANY_CREDIT_COST\s*=\s*3/);
  assert.match(sweep, /List of the last 5|last 5|Company Search returns only the last 5/i);
});

test('company sweep protects a monthly reserve and persists per-workspace cadence', () => {
  assert.match(sweep, /THEIRSTACK_COMPANY_SWEEP_INTERVAL_DAYS/);
  assert.match(sweep, /THEIRSTACK_API_CREDIT_RESERVE/);
  assert.match(sweep, /\/v0\/billing\/credit-balance/);
  assert.match(sweep, /theirstack_company_sweep_state/);
  assert.match(sweep, /estimatedCost \+ CREDIT_RESERVE/);
});

test('legacy per-job full inventory polling is opt-in instead of the scheduled default', () => {
  assert.match(legacy, /THEIRSTACK_LEGACY_JOB_SEARCH_ENABLED/);
  assert.match(legacy, /booleanEnv\('THEIRSTACK_LEGACY_JOB_SEARCH_ENABLED', false\)/);
  assert.match(legacy, /if \(!LEGACY_JOB_SEARCH_ENABLED\) return \{ jobs: \[\], used: \[\], skipped: \[\] \}/);
  assert.match(legacy, /PAGE_SIZE = clamp\(integerEnv\('THEIRSTACK_PAGE_SIZE', 25\), 1, 25\)/);
  assert.match(legacy, /MAX_PAGES = clamp\(integerEnv\('THEIRSTACK_MAX_PAGES', 5\), 1, 5\)/);
});

test('cron runs one workspace sweep before per-entity refreshes and never blocks authoritative ingest on sweep failure', () => {
  assert.match(cron, /await sweepTheirStackCompanies\(\)/);
  assert.match(cron, /\/api\/ingest\/theirstack\/company-sweep/);
  assert.match(cron, /continuing ingest/);
});

test('company sweep is supplemental, non-destructive, and keeps high-volume signals for export fallback', () => {
  assert.match(sweep, /const SOURCE = 'theirstack_company'/);
  assert.doesNotMatch(sweep, /UPDATE jobs SET is_active = false/);
  assert.match(sweep, /num_jobs_found/);
  assert.match(sweep, /high_volume_companies/);
  assert.match(sweep, /company-credit Job Export remains the bulk fallback/);
});

test('company sweep endpoint is protected by the cron secret', () => {
  assert.match(route, /x-cron-secret/);
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /runTheirStackCompanySweep/);
});
