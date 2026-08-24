const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const route = fs.readFileSync('app/api/entities/[id]/theirstack/export-prep/route.ts', 'utf8');
const detail = fs.readFileSync('components/portal/UniversalCompanyDetail.tsx', 'utf8');

test('bulk export prep uses the supported TheirStack App URL endpoint and a prefiltered open-job search', () => {
  assert.match(route, /\/v0\/app-urls/);
  assert.match(route, /type:\s*'job_search'/);
  assert.match(route, /company_name_case_insensitive_or/);
  assert.match(route, /posted_at_max_age_days:\s*LOOKBACK_DAYS/);
  assert.match(route, /is_closed:\s*false/);
  assert.doesNotMatch(route, /\/v1\/jobs\/search/);
});

test('bulk export prep uses live monitor assignments and returns the existing export receiver', () => {
  assert.match(route, /monitorsForEntityLive/);
  assert.match(route, /THEIRSTACK_EXPORT_WEBHOOK_SECRET/);
  assert.match(route, /\/api\/ingest\/theirstack\/export/);
  assert.match(route, /receiver_url/);
});

test('entity detail exposes one-click TheirStack handoff, copies receiver, and opens the prepared search', () => {
  assert.match(detail, /TheirStack Bulk Export/);
  assert.match(detail, /theirstack\/export-prep/);
  assert.match(detail, /navigator\.clipboard/);
  assert.match(detail, /popup\.location\.href = body\.app_url/);
  assert.match(detail, /Export → Webhook/);
});
