'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const benchmark = require('../lib/benchmark/benchmarkRules');
const reliability = require('../lib/ingest/sourceReliabilityRules');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');

function loadTsModule(relativePath, options = {}) {
  const filename = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filename, 'utf8') + (options.append || '');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const mod = { exports: {} };
  const requireMap = options.requireMap || {};
  const localRequire = id => Object.prototype.hasOwnProperty.call(requireMap, id) ? requireMap[id] : require(id);
  new Function('require','module','exports','__filename','__dirname',output)(localRequire,mod,mod.exports,filename,path.dirname(filename));
  return mod.exports;
}

function mockFetch(handler) {
  const original = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = original; };
}

function response({ ok=true, status=200, json=null, text='' }) {
  return { ok, status, url:'https://fixture.test/', json:async()=>json, text:async()=>text };
}

test('Workday golden fixture normalizes every posting without inventing coordinates', async () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES,'workday-page.json'),'utf8'));
  const expanded = loadTsModule('lib/ingest/expandedAts.ts', {
    requireMap: {
      './careerPage': { fetchCareerPageJobs: async()=>[] },
      './http': { fetchJson: async()=>({}), getIngestTimeout:()=>1000 },
      './workable': { fetchWorkableJobs: async()=>[] },
      './personio': { fetchPersonioJobs: async()=>[] },
    },
  });
  const restore = mockFetch(async()=>response({ json: fixture }));
  try {
    const jobs = await expanded.fetchWorkdayJobs('https://acme.wd5.myworkdayjobs.com/en-US/External');
    assert.equal(jobs.length,2);
    assert.equal(jobs[0].external_id,'R1001');
    assert.equal(jobs[0].location,'Fresno, CA');
    assert.equal(jobs[0].lat,null);
    assert.equal(jobs[0].lng,null);
    assert.equal(jobs[1].country,'DE');
    assert.match(jobs[1].raw_data.normalized_apply_url,/R1002/);
  } finally { restore(); }
});

test('NEOGOV golden RSS is complete and safe to treat as authoritative inventory', async () => {
  const xml = fs.readFileSync(path.join(FIXTURES,'neogov-valid.xml'),'utf8');
  const neo = loadTsModule('lib/ingest/neogovFeed.ts', { requireMap:{ './http':{getIngestTimeout:()=>1000} } });
  const restore = mockFetch(async()=>response({ text:xml }));
  try {
    const result = await neo.fetchNeoGovFeedJobs({ name:'City of Fresno', ats_provider:'governmentjobs', ats_board_id:'fresnoca' });
    assert.equal(result.jobs.length,2);
    assert.equal(result.check.status,'success');
    assert.equal(result.check.jobs_found,2);
    assert.equal(result.check.authoritative_zero,false);
    assert.equal(result.jobs[0].city,'Fresno');
    assert.equal(result.jobs[0].state,'CA');
  } finally { restore(); }
});

test('NEOGOV HTTP 200 HTML/login response is an error, never a verified zero', async () => {
  const neo = loadTsModule('lib/ingest/neogovFeed.ts', { requireMap:{ './http':{getIngestTimeout:()=>1000} } });
  const restore = mockFetch(async()=>response({ text:'<html><title>Sign in</title><body>Login required</body></html>' }));
  try {
    const result = await neo.fetchNeoGovFeedJobs({ ats_provider:'governmentjobs', ats_board_id:'fresnoca' });
    assert.equal(result.jobs.length,0);
    assert.equal(result.check.status,'error');
    assert.equal(result.check.authoritative_zero,false);
    assert.match(result.check.details.error,/not a recognized GovernmentJobs RSS feed/i);
  } finally { restore(); }
});

test('NEOGOV partial normalization keeps valid rows but blocks authoritative completeness', async () => {
  const xml = fs.readFileSync(path.join(FIXTURES,'neogov-partial.xml'),'utf8');
  const neo = loadTsModule('lib/ingest/neogovFeed.ts', { requireMap:{ './http':{getIngestTimeout:()=>1000} } });
  const restore = mockFetch(async()=>response({ text:xml }));
  try {
    const result = await neo.fetchNeoGovFeedJobs({ name:'City of Fresno', ats_provider:'governmentjobs', ats_board_id:'fresnoca' });
    assert.equal(result.jobs.length,1);
    assert.equal(result.check.status,'error');
    assert.equal(result.check.authoritative_zero,false);
    assert.equal(result.check.details.invalid_items,1);
  } finally { restore(); }
});

test('truth benchmark calculates exact precision/recall after tracking-parameter normalization', () => {
  const result = benchmark.assessEntityBenchmark({
    appUrls:['https://jobs.example.com/1?utm_source=mirror','https://jobs.example.com/2','https://jobs.example.com/extra'],
    truthUrls:['https://jobs.example.com/1','https://jobs.example.com/2','https://jobs.example.com/3'],
    appCount:3, referenceCount:3, mappedCount:3, duplicateCount:0, staleCount:0,
    authoritativeTotal:1, authoritativeHealthy:1, highIncidentCount:0,
  });
  assert.equal(result.evidenceLevel,'ground_truth');
  assert.equal(result.matched,2);
  assert.equal(result.missing,1);
  assert.equal(result.unexpected,1);
  assert.equal(result.precision,2/3);
  assert.equal(result.recall,2/3);
  assert.equal(result.passed,false);
});

test('portal release gate refuses to claim production readiness without truth evidence', () => {
  const rows = Array.from({length:12},()=>({
    evidenceLevel:'live_parity', precision:null, recall:null, parity:0.99, duplicateRate:0,
    staleRate:0, mappedRate:0.95, authoritativeHealth:1, highIncidentCount:0,
  }));
  const result = benchmark.assessPortalRelease(rows);
  assert.equal(result.status,'insufficient_evidence');
  assert.match(result.blockers.join(' '),/ground-truth/i);
});

test('portal release gate passes only when evidence and quality thresholds both pass', () => {
  const truthRows = Array.from({length:5},()=>({
    evidenceLevel:'ground_truth', precision:0.995, recall:0.96, parity:0.98, duplicateRate:0,
    staleRate:0.005, mappedRate:0.92, authoritativeHealth:1, highIncidentCount:0,
  }));
  const result = benchmark.assessPortalRelease(truthRows);
  assert.equal(result.status,'pass');
  assert.equal(result.blockers.length,0);
});

test('chaos matrix flags source failures, stale checks and truncation without treating identity lookups as inventory', () => {
  const now = Date.now();
  const issues = reliability.evaluateSourceReliability({
    nowMs:now,
    staleHours:48,
    checks:[
      { source:'workday',source_class:'authoritative',status:'error',jobs_found:0,last_checked_at:new Date(now).toISOString(),details:{error:'HTTP 429'} },
      { source:'nlx',source_class:'verified',status:'success',jobs_found:50,last_checked_at:new Date(now).toISOString(),details:{truncated:true},lineage_root:'nlx' },
      { source:'ats:greenhouse',source_class:'authoritative',status:'success',jobs_found:20,last_checked_at:new Date(now-72*3600000).toISOString(),lineage_root:'ats:greenhouse:acme' },
      { source:'identity:sam',source_class:'authoritative',status:'zero',jobs_found:0,authoritative_zero:false,last_checked_at:new Date(now).toISOString(),details:{} },
    ],
    previous:{}, assessment:{authoritative_sources:2,healthy_authoritative_sources:1,score:70,grade:'limited'},
  });
  const kinds=new Set(issues.map(row=>row.kind));
  assert.ok(kinds.has('source_error'));
  assert.ok(kinds.has('truncated_inventory'));
  assert.ok(kinds.has('stale_authoritative_source'));
  assert.ok(!issues.some(row=>row.source==='identity:sam' && row.kind==='unverified_authoritative_zero'));
});
