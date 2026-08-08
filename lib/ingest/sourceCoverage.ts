import { query } from '@/db/client';
import type { CoverageCheck } from './neogovFeed';

export async function persistSourceCoverage(entityId: string, checks: CoverageCheck[]) {
  if (!entityId || !checks.length) return;
  const unique = new Map<string, CoverageCheck>();
  for (const check of checks) {
    const existing = unique.get(check.source);
    if (!existing || rank(check.status) > rank(existing.status) || check.jobs_found > existing.jobs_found) unique.set(check.source, check);
  }

  for (const check of Array.from(unique.values())) {
    const success = check.status === 'success' || check.status === 'zero';
    await query(
      `INSERT INTO entity_source_coverage (
         entity_id, source, source_class, status, jobs_found, authoritative_zero, details, last_checked_at, last_success_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW(),CASE WHEN $8 THEN NOW() ELSE NULL END)
       ON CONFLICT (entity_id, source) DO UPDATE SET
         source_class = EXCLUDED.source_class,
         status = EXCLUDED.status,
         jobs_found = EXCLUDED.jobs_found,
         authoritative_zero = EXCLUDED.authoritative_zero,
         details = EXCLUDED.details,
         last_checked_at = NOW(),
         last_success_at = CASE WHEN $8 THEN NOW() ELSE entity_source_coverage.last_success_at END`,
      [entityId, check.source, check.source_class, check.status, Math.max(0, Number(check.jobs_found || 0)), Boolean(check.authoritative_zero), JSON.stringify(check.details || {}), success],
    ).catch(error => console.warn(`Could not persist source coverage ${check.source}:`, error instanceof Error ? error.message : error));
  }
}

export async function readSourceCoverage(entityId: string) {
  try {
    return await query(
      `SELECT source, source_class, status, jobs_found, authoritative_zero, details, last_checked_at, last_success_at
       FROM entity_source_coverage WHERE entity_id = $1
       ORDER BY CASE source_class WHEN 'authoritative' THEN 1 WHEN 'verified' THEN 2 ELSE 3 END,
                jobs_found DESC, source ASC`,
      [entityId],
    );
  } catch {
    return [];
  }
}

function rank(status: CoverageCheck['status']) {
  if (status === 'success') return 4;
  if (status === 'zero') return 3;
  if (status === 'error') return 2;
  return 1;
}
