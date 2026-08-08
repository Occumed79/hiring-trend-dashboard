'use strict';

function evaluateSourceReliability(input) {
  const checks = Array.isArray(input?.checks) ? input.checks : [];
  const previous = input?.previous && typeof input.previous === 'object' ? input.previous : {};
  const assessment = input?.assessment || null;
  const staleHours = positiveNumber(input?.staleHours, 48);
  const nowMs = positiveNumber(input?.nowMs, Date.now());
  const issues = [];

  for (const check of checks) {
    const source = text(check?.source) || 'unknown';
    const sourceClass = text(check?.source_class) || 'supplemental';
    const status = text(check?.status) || 'unknown';
    const jobs = nonNegative(check?.jobs_found);
    const details = check?.details && typeof check.details === 'object' ? check.details : {};
    const previousCheck = previous[source] || null;
    const checkedAt = time(check?.last_checked_at || check?.checked_at);
    const stale = checkedAt > 0 && nowMs - checkedAt > staleHours * 3600000;

    if (status === 'error') {
      issues.push(issue(`source-error:${source}`, 'source_error', sourceClass === 'authoritative' ? 'high' : 'medium', source,
        `${source} failed during its latest source check.`, { error: details.error || null }));
    }

    if (sourceClass === 'authoritative' && status === 'skipped') {
      issues.push(issue(`authoritative-skipped:${source}`, 'authoritative_skipped', 'medium', source,
        `${source} is authoritative but was skipped.`, { reason: details.reason || null }));
    }

    if (details.truncated === true || details.pagination_truncated === true) {
      issues.push(issue(`truncated:${source}`, 'truncated_inventory', sourceClass === 'authoritative' ? 'high' : 'medium', source,
        `${source} reported a truncated inventory; the visible job count may be incomplete.`, {
          pages: details.pages ?? null,
          reported_total: details.reported_total ?? details.total ?? null,
        }));
    }

    if (sourceClass === 'authoritative' && status === 'zero' && check?.authoritative_zero !== true) {
      issues.push(issue(`unverified-zero:${source}`, 'unverified_authoritative_zero', 'high', source,
        `${source} returned zero jobs without proving that the authoritative inventory was completely enumerated.`, {}));
    }

    if (stale && sourceClass === 'authoritative') {
      issues.push(issue(`stale:${source}`, 'stale_authoritative_source', 'medium', source,
        `${source} has not had a fresh authoritative check within ${staleHours} hours.`, { last_checked_at: check?.last_checked_at || null }));
    }

    if (previousCheck && isHealthy(status) && isHealthy(text(previousCheck.status))) {
      const before = nonNegative(previousCheck.jobs_found);
      if (before >= 5 && jobs === 0) {
        issues.push(issue(`zero-after-nonzero:${source}`, 'zero_after_nonzero', sourceClass === 'authoritative' ? 'high' : 'medium', source,
          `${source} dropped from ${before} jobs to zero.`, { previous_jobs: before, current_jobs: jobs }));
      } else if (before >= 10 && jobs > 0 && jobs <= Math.max(1, Math.floor(before * 0.25))) {
        issues.push(issue(`sudden-drop:${source}`, 'sudden_inventory_drop', sourceClass === 'authoritative' ? 'high' : 'medium', source,
          `${source} dropped from ${before} jobs to ${jobs}.`, { previous_jobs: before, current_jobs: jobs, ratio: round(jobs / before) }));
      }
      if (before >= 5 && jobs >= before * 4 && jobs - before >= 20) {
        issues.push(issue(`sudden-spike:${source}`, 'sudden_inventory_spike', 'medium', source,
          `${source} jumped from ${before} jobs to ${jobs}; verify pagination and duplicate handling.`, { previous_jobs: before, current_jobs: jobs, ratio: round(jobs / before) }));
      }
    }
  }

  const comparable = collapseIndependentLineages(checks.filter(check =>
    ['authoritative', 'verified'].includes(text(check?.source_class))
    && isHealthy(text(check?.status))
    && !(check?.details?.shared_inventory === true)
    && !isIdentityOrDiscovery(check?.source)
  ));
  if (comparable.length >= 2) {
    const counts = comparable.map(row => nonNegative(row.jobs_found));
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    if (max >= 50 && min <= Math.floor(max * 0.1)) {
      issues.push(issue('cross-source-disagreement', 'cross_source_disagreement', 'medium', null,
        `Independent verified sources disagree sharply on inventory (${min} vs ${max}).`, {
          lineages: comparable.map(row => ({ lineage: lineage(row), source: row.source, jobs_found: nonNegative(row.jobs_found) })),
        }));
    }
  }

  if (assessment && Number(assessment.authoritative_sources || 0) > 0 && Number(assessment.healthy_authoritative_sources || 0) === 0) {
    issues.push(issue('no-healthy-authoritative-source', 'no_healthy_authoritative_source', 'high', null,
      'No registered authoritative hiring source currently has a healthy recent check.', {
        score: Number(assessment.score || 0), grade: assessment.grade || null,
      }));
  }

  return dedupeIssues(issues).sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.key.localeCompare(b.key));
}

function collapseIndependentLineages(checks) {
  const byLineage = new Map();
  for (const check of checks) {
    const key = lineage(check);
    if (!key) continue;
    const current = byLineage.get(key);
    if (!current || nonNegative(check.jobs_found) > nonNegative(current.jobs_found)) byLineage.set(key, check);
  }
  return Array.from(byLineage.values());
}

function lineage(check) {
  const raw = text(check?.lineage_root || check?.details?.lineage_root || check?.source).toLowerCase();
  if (raw === 'careeronestop' || raw.startsWith('nlx-mirror:') || raw === 'careeronestop:nlx_mirror') return 'nlx';
  return raw;
}

function isIdentityOrDiscovery(source) {
  const value = text(source).toLowerCase();
  return value.startsWith('identity:') || value.startsWith('registry:') || value.startsWith('coverage:') || value === 'web:langsearch' || value === 'adzuna' || value.startsWith('jobapi:');
}
function isHealthy(status) { return status === 'success' || status === 'zero'; }
function issue(key, kind, severity, source, message, details) { return { key, kind, severity, source, message, details: details || {} }; }
function dedupeIssues(rows) { const map = new Map(); for (const row of rows) map.set(row.key, row); return Array.from(map.values()); }
function severityRank(value) { return value === 'critical' ? 4 : value === 'high' ? 3 : value === 'medium' ? 2 : 1; }
function nonNegative(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
function positiveNumber(value, fallback) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; }
function time(value) { if (!value) return 0; const n = new Date(value).getTime(); return Number.isFinite(n) ? n : 0; }
function text(value) { return String(value || '').trim(); }
function round(value) { return Math.round(value * 1000) / 1000; }

module.exports = { evaluateSourceReliability, collapseIndependentLineages };
