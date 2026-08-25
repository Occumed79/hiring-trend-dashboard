const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const route = fs.readFileSync('app/api/entities/[id]/theirstack/export-prep/route.ts', 'utf8');
const receiver = fs.readFileSync('app/api/ingest/theirstack/export/route.ts', 'utf8');
const secret = fs.readFileSync('lib/ingest/theirStackExportSecret.ts', 'utf8');
const detail = fs.readFileSync('components/portal/UniversalCompanyDetail.tsx', 'utf8');

test('bulk export prep uses the supported TheirStack App URL endpoint and a prefiltered open-job search', () => {
  assert.match(route, /\/v0\/app-urls/);
  assert.match(route, /type:\s*'job_search'/);
  assert.match(route, /company_name_case_insensitive_or/);
  assert.match(route, /posted_at_max_age_days:\s*LOOKBACK_DAYS/);
  assert.match(route, /is_closed:\s*false/);
  assert.doesNotMatch(route, /\/v1\/jobs\/search/);
});

test('manual TheirStack export handoff defaults to a separate 10-day window', () => {
  assert.match(route, /THEIRSTACK_EXPORT_LOOKBACK_DAYS',\s*10/);
  assert.doesNotMatch(route, /THEIRSTACK_COMPANY_SWEEP_LOOKBACK_DAYS/);
  assert.match(route, /lookback_days:\s*LOOKBACK_DAYS/);
  assert.match(route, /export_cap_per_company:\s*200/);
});

test('bulk export prep uses live monitor assignments and an auto-provisionable export receiver token', () => {
  assert.match(route, /monitorsForEntityLive/);
  assert.match(route, /getTheirStackExportSecret/);
  assert.match(route, /\/api\/ingest\/theirstack\/export/);
  assert.match(route, /receiver_url/);
  assert.match(secret, /runtime_secrets/);
  assert.match(secret, /randomBytes\(32\)/);
  assert.match(secret, /THEIRSTACK_EXPORT_WEBHOOK_SECRET/);
  assert.match(secret, /timingSafeEqual/);
  assert.match(receiver, /verifyTheirStackExportSecret/);
});

test('entity detail exposes one-click TheirStack handoff, copies receiver, and opens the prepared search', () => {
  assert.match(detail, /TheirStack Bulk Export/);
  assert.match(detail, /theirstack\/export-prep/);
  assert.match(detail, /navigator\.clipboard/);
  assert.match(detail, /popup\.location\.href = body\.app_url/);
  assert.match(detail, /Export → Webhook/);
});
