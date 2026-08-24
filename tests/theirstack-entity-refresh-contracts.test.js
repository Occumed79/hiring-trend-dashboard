const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const refresh = read('lib/ingest/theirStackEntityRefresh.ts');
const entityRoute = read('app/api/entities/[id]/ingest/route.ts');
const exportImporter = read('lib/ingest/theirStackExportWebhook.ts');
const sourcePanel = read('components/portal/SourceCoveragePanel.tsx');
const integrationPanel = read('components/portal/IntegrationStatusPanel.tsx');
const render = read('render.yaml');

test('manual entity refresh uses credit-guarded TheirStack Company Search instead of per-job Job Search', () => {
  assert.match(refresh, /\/v1\/companies\/search/);
  assert.match(refresh, /\/v0\/billing\/credit-balance/);
  assert.match(refresh, /COMPANY_CREDIT_COST\s*=\s*3/);
  assert.match(refresh, /CREDIT_RESERVE/);
  assert.doesNotMatch(refresh, /\/v1\/jobs\/search/);
});

test('targeted TheirStack refresh requires a normalized employer match and never grabs the first unrelated company', () => {
  assert.match(refresh, /normalizeCompanyIdentity/);
  assert.match(refresh, /companies\.find\(company => normalizeCompanyIdentity\(company\?\.name\) === target\) \|\| null/);
  assert.doesNotMatch(refresh, /companies\[0\]/);
});

test('TheirStack Company Search coverage stores the hiring-volume signal separately per workspace', () => {
  assert.match(refresh, /const coverageSource = `\$\{SOURCE\}:\$\{monitor\.envKey\}`/);
  assert.match(refresh, /const observedJobs = Math\.max\(volume, sample\.length\)/);
  assert.match(refresh, /jobs_found: observedJobs/);
  assert.match(sourcePanel, /recent jobs signaled/);
  assert.match(sourcePanel, /sample_jobs_returned/);
});

test('manual refresh imports TheirStack before supplemental OH enrichment and final Algolia sync', () => {
  const theirStackIndex = entityRoute.indexOf('refreshTheirStackForEntity(params.id)');
  const supplementalIndex = entityRoute.indexOf('runSupplementalIngest(params.id)');
  assert.ok(theirStackIndex >= 0 && supplementalIndex > theirStackIndex);
});

test('TheirStack bulk export runtime state is visible and the receiver secret is declared only on the web service', () => {
  assert.match(entityRoute, /THEIRSTACK_EXPORT_WEBHOOK_SECRET/);
  assert.match(integrationPanel, /theirstack_export/);
  const secretDeclarations = render.match(/key: THEIRSTACK_EXPORT_WEBHOOK_SECRET/g) || [];
  assert.equal(secretDeclarations.length, 1);
});

test('TheirStack bulk export records source coverage, stays supplemental, and matches legal-name variants', () => {
  assert.match(exportImporter, /persistSourceCoverage/);
  assert.match(exportImporter, /source:\s*SOURCE/);
  assert.match(exportImporter, /source_class:\s*'supplemental'/);
  assert.match(exportImporter, /capped_snapshot:\s*true/);
  assert.match(exportImporter, /normalizeCompanyIdentity/);
  assert.doesNotMatch(exportImporter, /UPDATE jobs SET is_active = false/);
});

test('credit-aware TheirStack tuning is declared for both web and cron runtimes', () => {
  for (const key of [
    'THEIRSTACK_COMPANY_SWEEP_LOOKBACK_DAYS',
    'THEIRSTACK_COMPANY_SWEEP_INTERVAL_DAYS',
    'THEIRSTACK_API_CREDIT_RESERVE',
    'THEIRSTACK_TIMEOUT_MS',
    'THEIRSTACK_LEGACY_JOB_SEARCH_ENABLED',
  ]) {
    const matches = render.match(new RegExp(`key: ${key}`, 'g')) || [];
    assert.equal(matches.length, 2, `${key} should exist on web and cron`);
  }
});
