'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateSourceReliability}=require('../lib/ingest/sourceReliabilityRules');

const baseChecks=[
  {source:'nlx',source_class:'verified',status:'success',jobs_found:90,lineage_root:'nlx',last_checked_at:new Date().toISOString(),details:{}},
  {source:'workday',source_class:'authoritative',status:'success',jobs_found:100,lineage_root:'ats:workday:acme',last_checked_at:new Date().toISOString(),details:{}},
];
const baseline={source_a:'nlx',source_b:'workday',sample_count:30,p10_ratio:0.78,p90_ratio:1.02,median_ratio:0.90};

test('normal source-pair lag inside learned range does not raise disagreement incident',()=>{
  const issues=evaluateSourceReliability({checks:baseChecks,pairBaselines:[baseline],assessment:{authoritative_sources:1,healthy_authoritative_sources:1}});
  assert.ok(!issues.some(row=>row.kind==='cross_source_disagreement'));
});

test('large source-pair deviation outside learned range raises learned-baseline incident',()=>{
  const checks=[baseChecks[0],{...baseChecks[1],jobs_found:400}];
  const issues=evaluateSourceReliability({checks,pairBaselines:[baseline],assessment:{authoritative_sources:1,healthy_authoritative_sources:1}});
  const issue=issues.find(row=>row.kind==='cross_source_disagreement');
  assert.ok(issue);
  assert.equal(issue.details.learned_baseline,true);
  assert.equal(issue.details.sample_count,30);
});

test('without enough baseline evidence the conservative fallback still catches extreme disagreement',()=>{
  const checks=[baseChecks[0],{...baseChecks[1],jobs_found:1000}];
  const issues=evaluateSourceReliability({checks,pairBaselines:[{...baseline,sample_count:2}],assessment:{authoritative_sources:1,healthy_authoritative_sources:1}});
  assert.ok(issues.some(row=>row.kind==='cross_source_disagreement'&&row.details.learned_baseline===false));
});
