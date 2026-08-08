'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

function loadTsModule(relativePath, options = {}) {
  const filename = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8') + (options.append || '');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const mod = { exports: {} };
  const requireMap = options.requireMap || {};
  const localRequire = (id) => Object.prototype.hasOwnProperty.call(requireMap, id) ? requireMap[id] : require(id);
  const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
  execute(localRequire, mod, mod.exports, filename, path.dirname(filename));
  return mod.exports;
}

test('ATS detector recognizes the source families we depend on', () => {
  const discovery = loadTsModule('lib/ingest/sourceDiscovery.ts', {
    requireMap: { './http': { getIngestTimeout: () => 1000 } },
    append: '\nexport { atsSource as __testAtsSource };\n',
  });
  const detect = discovery.__testAtsSource;
  const cases = [
    ['https://boards.greenhouse.io/acme', 'greenhouse'],
    ['https://jobs.lever.co/acme', 'lever'],
    ['https://acme.wd5.myworkdayjobs.com/en-US/External', 'workday'],
    ['https://www.governmentjobs.com/careers/fresnoca', 'governmentjobs'],
    ['https://apply.workable.com/acme/', 'workable'],
    ['https://acme.jobs.personio.com/', 'personio'],
    ['https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL', 'dayforce'],
    ['https://recruiting.paylocity.com/recruiting/jobs/All/acme', 'paylocity'],
  ];
  for (const [url, provider] of cases) {
    const result = detect(url, 'contract-test', false);
    assert.ok(result, `expected ${url} to be detected`);
    assert.equal(result.ats_provider, provider, url);
  }
});

test('shared or unverified inventories require employer evidence', () => {
  const identity = loadTsModule('lib/ingest/jobIdentity.ts');
  const entity = { name: 'V2X', aliases: ['Vectrus'], career_page_url: 'https://careers.v2x.com/' };
  const unrelated = [{
    source: 'ats:workday', title: 'Engineer', apply_url: 'https://other.wd5.myworkdayjobs.com/job/123',
    raw_data: { employer_name: 'Other Corporation' },
  }];
  const rejected = identity.filterAllJobsForEntityEvidence(unrelated, entity);
  assert.equal(rejected.jobs.length, 0);
  assert.equal(rejected.rejected, 1);

  const matching = [{
    source: 'ats:workday', title: 'Engineer', apply_url: 'https://other.wd5.myworkdayjobs.com/job/124',
    raw_data: { employer_name: 'Vectrus Systems Corporation' },
  }];
  const accepted = identity.filterAllJobsForEntityEvidence(matching, entity);
  assert.equal(accepted.jobs.length, 1);
  assert.match(accepted.jobs[0].raw_data.normalized_employer_match, /^employer-name:/);
});

test('verified non-shared source-graph nodes are trusted without broad name matching', () => {
  const identity = loadTsModule('lib/ingest/jobIdentity.ts');
  const entity = { name: 'Acme Corporation', aliases: [] };
  const rows = [{
    source: 'workday', title: 'Program Manager', apply_url: 'https://acme.wd5.myworkdayjobs.com/job/abc',
    raw_data: { source_graph_verified_for_entity: true, source_graph_shared_inventory: false },
  }];
  const result = identity.filterAllJobsForEntityEvidence(rows, entity);
  assert.equal(result.rejected, 0);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].raw_data.normalized_employer_match, 'verified-source-graph-node');
});

test('cross-source dedupe keeps provenance from every duplicate lineage', () => {
  const identity = loadTsModule('lib/ingest/jobIdentity.ts');
  const rows = [
    { source: 'workday', external_id: '1', title: 'Analyst', apply_url: 'https://example.com/jobs/1?utm_source=a', raw_data: { source_graph_lineage: 'ats:workday:acme' } },
    { source: 'nlx', external_id: 'x', title: 'Analyst', apply_url: 'https://example.com/jobs/1', raw_data: { source_graph_lineage: 'nlx' } },
  ];
  const result = identity.dedupeJobsAcrossSources(rows);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(new Set(result.jobs[0].raw_data.duplicate_sources), new Set(['workday', 'nlx']));
  assert.deepEqual(new Set(result.jobs[0].raw_data.duplicate_lineages), new Set(['ats:workday:acme', 'nlx']));
});

test('reliability rules flag truncation, unverified zeroes and sudden collapses', () => {
  const { evaluateSourceReliability } = require('../lib/ingest/sourceReliabilityRules');
  const checks = [
    { source: 'workday', source_class: 'authoritative', status: 'zero', jobs_found: 0, authoritative_zero: false, lineage_root: 'ats:workday:acme', details: {} },
    { source: 'nlx', source_class: 'verified', status: 'success', jobs_found: 50, authoritative_zero: false, lineage_root: 'nlx', details: { truncated: true } },
  ];
  const issues = evaluateSourceReliability({
    checks,
    previous: { workday: { status: 'success', jobs_found: 40 } },
    assessment: { authoritative_sources: 1, healthy_authoritative_sources: 0, score: 42, grade: 'limited' },
  });
  const kinds = new Set(issues.map(issue => issue.kind));
  assert.ok(kinds.has('unverified_authoritative_zero'));
  assert.ok(kinds.has('zero_after_nonzero'));
  assert.ok(kinds.has('truncated_inventory'));
  assert.ok(kinds.has('no_healthy_authoritative_source'));
});

test('identity and registry checks never create job-inventory incidents', () => {
  const { evaluateSourceReliability } = require('../lib/ingest/sourceReliabilityRules');
  const issues = evaluateSourceReliability({
    checks: [
      { source: 'identity:sam', source_class: 'authoritative', status: 'zero', jobs_found: 0, authoritative_zero: false, details: {} },
      { source: 'registry:census_governments', source_class: 'authoritative', status: 'error', jobs_found: 0, details: { error: 'offline' } },
    ],
    previous: { 'identity:sam': { status: 'success', jobs_found: 10 } },
    assessment: null,
  });
  assert.equal(issues.length, 0);
});

test('stale authoritative inventory sources create a reliability finding', () => {
  const { evaluateSourceReliability } = require('../lib/ingest/sourceReliabilityRules');
  const nowMs = Date.parse('2026-08-08T22:00:00Z');
  const issues = evaluateSourceReliability({
    checks: [{
      source: 'workday', source_class: 'authoritative', status: 'success', jobs_found: 75,
      authoritative_zero: false, last_checked_at: '2026-08-05T21:00:00Z', lineage_root: 'ats:workday:acme', details: {},
    }],
    staleHours: 48,
    nowMs,
  });
  assert.ok(issues.some(issue => issue.kind === 'stale_authoritative_source'));
});

test('NLx and CareerOneStop mirror lineage is not counted twice', () => {
  const { collapseIndependentLineages } = require('../lib/ingest/sourceReliabilityRules');
  const collapsed = collapseIndependentLineages([
    { source: 'nlx', lineage_root: 'nlx', jobs_found: 80 },
    { source: 'careeronestop:nlx_mirror', lineage_root: 'nlx', jobs_found: 75 },
    { source: 'workday', lineage_root: 'ats:workday:acme', jobs_found: 82 },
  ]);
  assert.equal(collapsed.length, 2);
});
