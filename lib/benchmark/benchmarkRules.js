'use strict';

const DEFAULT_RELEASE_THRESHOLDS = Object.freeze({
  minBenchmarkEntities: 5,
  minTruthEntities: 3,
  minPrecision: 0.98,
  minRecall: 0.90,
  minParity: 0.90,
  maxDuplicateRate: 0.01,
  maxStaleRate: 0.03,
  minMappedRate: 0.85,
  minAuthoritativeHealth: 0.95,
  maxHighIncidentRate: 0.05,
});

function normalizeJobUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const drop = new Set(['source','src','ref','referrer','referral','trackingid','trk','gh_src','lever-source','lever-origin']);
    for (const key of Array.from(url.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || drop.has(lower)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function compareTruth(appUrls, truthUrls) {
  const app = uniqueUrls(appUrls);
  const truth = uniqueUrls(truthUrls);
  if (!truth.length) return { matched: null, missing: null, unexpected: null, precision: null, recall: null, appUrls: app, truthUrls: truth };
  const appSet = new Set(app);
  const truthSet = new Set(truth);
  const matched = truth.filter(url => appSet.has(url));
  const missing = truth.filter(url => !appSet.has(url));
  const unexpected = app.filter(url => !truthSet.has(url));
  return {
    matched: matched.length,
    missing: missing.length,
    unexpected: unexpected.length,
    precision: app.length ? matched.length / app.length : truth.length ? 0 : 1,
    recall: truth.length ? matched.length / truth.length : null,
    matchedUrls: matched,
    missingUrls: missing,
    unexpectedUrls: unexpected,
    appUrls: app,
    truthUrls: truth,
  };
}

function parityScore(appCount, referenceCount) {
  const app = nonNegative(appCount);
  const ref = nullableNonNegative(referenceCount);
  if (ref === null) return null;
  if (app === 0 && ref === 0) return 1;
  const max = Math.max(app, ref);
  if (!max) return 1;
  return Math.min(app, ref) / max;
}

function assessEntityBenchmark(input) {
  const truth = compareTruth(input?.appUrls || [], input?.truthUrls || []);
  const appCount = nonNegative(input?.appCount);
  const referenceCount = nullableNonNegative(input?.referenceCount);
  const parity = parityScore(appCount, referenceCount);
  const totalJobs = Math.max(0, appCount);
  const duplicateRate = rate(input?.duplicateCount, totalJobs);
  const staleRate = rate(input?.staleCount, totalJobs);
  const mappedRate = totalJobs ? clamp(nonNegative(input?.mappedCount) / totalJobs, 0, 1) : 1;
  const authoritativeTotal = nonNegative(input?.authoritativeTotal);
  const authoritativeHealth = authoritativeTotal ? clamp(nonNegative(input?.authoritativeHealthy) / authoritativeTotal, 0, 1) : null;
  const truthBacked = truth.truthUrls.length > 0;
  const evidenceLevel = truthBacked ? 'ground_truth' : referenceCount !== null ? 'live_parity' : 'insufficient';
  const thresholds = { ...DEFAULT_RELEASE_THRESHOLDS, ...(input?.thresholds || {}) };
  const blockers = [];

  if (truthBacked && truth.precision !== null && truth.precision < thresholds.minPrecision) blockers.push(`precision ${(truth.precision * 100).toFixed(1)}% < ${(thresholds.minPrecision * 100).toFixed(0)}%`);
  if (truthBacked && truth.recall !== null && truth.recall < thresholds.minRecall) blockers.push(`recall ${(truth.recall * 100).toFixed(1)}% < ${(thresholds.minRecall * 100).toFixed(0)}%`);
  if (parity !== null && parity < thresholds.minParity) blockers.push(`source parity ${(parity * 100).toFixed(1)}% < ${(thresholds.minParity * 100).toFixed(0)}%`);
  if (duplicateRate > thresholds.maxDuplicateRate) blockers.push(`duplicate rate ${(duplicateRate * 100).toFixed(1)}% > ${(thresholds.maxDuplicateRate * 100).toFixed(0)}%`);
  if (staleRate > thresholds.maxStaleRate) blockers.push(`stale rate ${(staleRate * 100).toFixed(1)}% > ${(thresholds.maxStaleRate * 100).toFixed(0)}%`);
  if (mappedRate < thresholds.minMappedRate) blockers.push(`mapped rate ${(mappedRate * 100).toFixed(1)}% < ${(thresholds.minMappedRate * 100).toFixed(0)}%`);
  if (authoritativeHealth !== null && authoritativeHealth < thresholds.minAuthoritativeHealth) blockers.push(`authoritative health ${(authoritativeHealth * 100).toFixed(1)}% < ${(thresholds.minAuthoritativeHealth * 100).toFixed(0)}%`);
  if (nonNegative(input?.highIncidentCount) > 0) blockers.push(`${nonNegative(input?.highIncidentCount)} high-severity source incident(s)`);

  return {
    evidenceLevel,
    appCount,
    referenceCount,
    matched: truth.matched,
    missing: truth.missing,
    unexpected: truth.unexpected,
    precision: truth.precision,
    recall: truth.recall,
    parity,
    duplicateRate,
    staleRate,
    mappedRate,
    authoritativeHealth,
    highIncidentCount: nonNegative(input?.highIncidentCount),
    passed: evidenceLevel === 'insufficient' ? null : blockers.length === 0,
    blockers,
    truthDiff: truthBacked ? { missingUrls: truth.missingUrls, unexpectedUrls: truth.unexpectedUrls } : null,
  };
}

function assessPortalRelease(rows, overrides) {
  const thresholds = { ...DEFAULT_RELEASE_THRESHOLDS, ...(overrides || {}) };
  const list = Array.isArray(rows) ? rows : [];
  const truthRows = list.filter(row => row && row.evidenceLevel === 'ground_truth');
  const benchmarkRows = list.filter(row => row && row.evidenceLevel !== 'insufficient');
  const blockers = [];

  if (benchmarkRows.length < thresholds.minBenchmarkEntities) blockers.push(`Only ${benchmarkRows.length}/${thresholds.minBenchmarkEntities} benchmark entities have usable evidence.`);
  if (truthRows.length < thresholds.minTruthEntities) blockers.push(`Only ${truthRows.length}/${thresholds.minTruthEntities} entities have independent ground-truth snapshots.`);

  const metrics = {
    precision: mean(truthRows.map(row => row.precision)),
    recall: mean(truthRows.map(row => row.recall)),
    parity: mean(benchmarkRows.map(row => row.parity)),
    duplicateRate: mean(benchmarkRows.map(row => row.duplicateRate)),
    staleRate: mean(benchmarkRows.map(row => row.staleRate)),
    mappedRate: mean(benchmarkRows.map(row => row.mappedRate)),
    authoritativeHealth: mean(benchmarkRows.map(row => row.authoritativeHealth)),
    highIncidentRate: benchmarkRows.length ? benchmarkRows.filter(row => nonNegative(row.highIncidentCount) > 0).length / benchmarkRows.length : null,
  };

  checkMetric(blockers, metrics.precision, thresholds.minPrecision, 'precision', 'min');
  checkMetric(blockers, metrics.recall, thresholds.minRecall, 'recall', 'min');
  checkMetric(blockers, metrics.parity, thresholds.minParity, 'source parity', 'min');
  checkMetric(blockers, metrics.duplicateRate, thresholds.maxDuplicateRate, 'duplicate rate', 'max');
  checkMetric(blockers, metrics.staleRate, thresholds.maxStaleRate, 'stale rate', 'max');
  checkMetric(blockers, metrics.mappedRate, thresholds.minMappedRate, 'mapped rate', 'min');
  checkMetric(blockers, metrics.authoritativeHealth, thresholds.minAuthoritativeHealth, 'authoritative health', 'min');
  checkMetric(blockers, metrics.highIncidentRate, thresholds.maxHighIncidentRate, 'high-incident rate', 'max');

  const evidenceSufficient = benchmarkRows.length >= thresholds.minBenchmarkEntities && truthRows.length >= thresholds.minTruthEntities;
  return {
    status: !evidenceSufficient ? 'insufficient_evidence' : blockers.length ? 'fail' : 'pass',
    benchmarkEntityCount: benchmarkRows.length,
    truthEntityCount: truthRows.length,
    metrics,
    blockers,
    thresholds,
  };
}

function uniqueUrls(values) { return Array.from(new Set((Array.isArray(values) ? values : []).map(normalizeJobUrl).filter(Boolean))); }
function rate(numerator, denominator) { return denominator > 0 ? clamp(nonNegative(numerator) / denominator, 0, 1) : 0; }
function nonNegative(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
function nullableNonNegative(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function mean(values) { const nums = values.filter(value => Number.isFinite(Number(value))).map(Number); return nums.length ? nums.reduce((a,b)=>a+b,0) / nums.length : null; }
function checkMetric(blockers, value, threshold, label, direction) {
  if (value === null || value === undefined) return;
  const bad = direction === 'min' ? value < threshold : value > threshold;
  if (bad) blockers.push(`${label} ${(value * 100).toFixed(1)}% ${direction === 'min' ? '<' : '>'} ${(threshold * 100).toFixed(1)}%`);
}

module.exports = { DEFAULT_RELEASE_THRESHOLDS, normalizeJobUrl, compareTruth, parityScore, assessEntityBenchmark, assessPortalRelease };
