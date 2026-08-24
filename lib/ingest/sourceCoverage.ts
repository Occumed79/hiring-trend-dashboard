import { query } from '@/db/client';
import type { CoverageCheck } from './neogovFeed';
import { assessAndPersistEntityCoverage } from './coverageAssessment';
import { evaluateAndPersistSourceReliability } from './sourceReliability';

export async function persistSourceCoverage(entityId: string, checks: CoverageCheck[]) {
  if (!entityId || !checks.length) return;
  const unique = new Map<string, CoverageCheck>();
  for (const check of checks) {
    const existing = unique.get(check.source);
    if (!existing || rank(check.status) > rank(existing.status) || check.jobs_found > existing.jobs_found) unique.set(check.source, check);
  }

  // Older builds stored all Company Search workspaces under one generic source,
  // which hid intentional cross-key assignments such as Peraton. Once a
  // workspace-specific row is written, retire that legacy latest-state row. The
  // immutable history is intentionally preserved for auditability.
  if (Array.from(unique.keys()).some(source => String(source).startsWith('theirstack_company:'))) {
    await query(`DELETE FROM entity_source_coverage WHERE entity_id = $1 AND source = 'theirstack_company'`, [entityId]).catch(() => {});
  }

  for (const check of Array.from(unique.values())) {
    const success = check.status === 'success' || check.status === 'zero';
    const sourceKey = clean(check.details?.source_key) || clean(check.source);
    const lineageRoot = clean(check.details?.lineage_root) || lineageForSource(check.source);
    const values = [entityId, check.source, check.source_class, check.status, Math.max(0, Number(check.jobs_found || 0)), Boolean(check.authoritative_zero), JSON.stringify(check.details || {}), lineageRoot, sourceKey, success];

    // Preserve the evidence before replacing the latest-state row. Runtime reliability
    // checks compare this immutable history rather than guessing from today's snapshot.
    await query(
      `INSERT INTO entity_source_coverage_history (
         entity_id, source, source_class, status, jobs_found, authoritative_zero,
         details, lineage_root, source_key, checked_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,NOW())`,
      values.slice(0, 9),
    ).catch(error => console.warn(`Could not persist source history ${check.source}:`, error instanceof Error ? error.message : error));

    await query(
      `INSERT INTO entity_source_coverage (
         entity_id, source, source_class, status, jobs_found, authoritative_zero, details,
         lineage_root, source_key, last_checked_at, last_success_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,NOW(),CASE WHEN $10 THEN NOW() ELSE NULL END)
       ON CONFLICT (entity_id, source) DO UPDATE SET
         source_class = EXCLUDED.source_class,
         status = EXCLUDED.status,
         jobs_found = EXCLUDED.jobs_found,
         authoritative_zero = EXCLUDED.authoritative_zero,
         details = EXCLUDED.details,
         lineage_root = COALESCE(EXCLUDED.lineage_root, entity_source_coverage.lineage_root),
         source_key = COALESCE(EXCLUDED.source_key, entity_source_coverage.source_key),
         last_checked_at = NOW(),
         last_success_at = CASE WHEN $10 THEN NOW() ELSE entity_source_coverage.last_success_at END`,
      values,
    ).catch(error => console.warn(`Could not persist source coverage ${check.source}:`, error instanceof Error ? error.message : error));
  }

  // Coverage scoring and reliability diagnostics are observability, not prerequisites
  // for ingest. Their failures must never discard otherwise valid jobs.
  await assessAndPersistEntityCoverage(entityId).catch(error =>
    console.warn('Could not assess source completeness:', error instanceof Error ? error.message : error)
  );
  await evaluateAndPersistSourceReliability(entityId).catch(error =>
    console.warn('Could not assess source reliability:', error instanceof Error ? error.message : error)
  );
}

export async function readSourceCoverage(entityId: string) {
  try {
    const rows = await query(
      `SELECT source, source_key, source_class, status, jobs_found, authoritative_zero,
              lineage_root, details, last_checked_at, last_success_at
       FROM entity_source_coverage WHERE entity_id = $1
       ORDER BY CASE source_class WHEN 'authoritative' THEN 1 WHEN 'verified' THEN 2 ELSE 3 END,
                jobs_found DESC, source ASC`,
      [entityId],
    );
    const hasWorkspaceSpecificTheirStack = rows.some((row: any) => String(row.source || '').startsWith('theirstack_company:'));
    return hasWorkspaceSpecificTheirStack
      ? rows.filter((row: any) => String(row.source || '') !== 'theirstack_company')
      : rows;
  } catch {
    return [];
  }
}

function lineageForSource(source: unknown) {
  const normalized = String(source || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'nlx') return 'nlx';
  if (normalized === 'usajobs') return 'usajobs';
  if (normalized === 'gov:neogov_rss') return 'neogov';
  if (normalized.startsWith('theirstack_company')) return 'theirstack';
  if (normalized === 'theirstack_export') return 'theirstack';
  if (normalized.startsWith('board:')) return normalized;
  if (normalized.startsWith('identity:')) return normalized;
  if (normalized.startsWith('ats:')) return normalized;
  if (['greenhouse','lever','workday','smartrecruiters','bamboohr','ashby','recruitee','workable','personio'].includes(normalized)) return `ats:${normalized}`;
  return normalized;
}
function clean(value: unknown) { const text = String(value || '').trim(); return text || null; }
function rank(status: CoverageCheck['status']) {
  if (status === 'success') return 4;
  if (status === 'zero') return 3;
  if (status === 'error') return 2;
  return 1;
}
