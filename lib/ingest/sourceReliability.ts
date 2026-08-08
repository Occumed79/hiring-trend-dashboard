import { query } from '@/db/client';
import { evaluateSourceReliability, type ReliabilityIssue } from './sourceReliabilityRules';

const STALE_HOURS = positiveInt(process.env.SOURCE_CHECK_STALE_HOURS, 48);
const HISTORY_RETENTION_DAYS = positiveInt(process.env.SOURCE_HISTORY_RETENTION_DAYS, 180);

export async function evaluateAndPersistSourceReliability(entityId: string): Promise<ReliabilityIssue[]> {
  if (!entityId) return [];

  // These reads are intentionally fail-closed. A failed diagnostic read is not
  // evidence of recovery and must never resolve an existing incident.
  const [checks, previousRows, assessments, pairBaselines] = await Promise.all([
    query(
      `SELECT source, source_key, source_class, status, jobs_found, authoritative_zero,
              lineage_root, details, last_checked_at, last_success_at
       FROM entity_source_coverage WHERE entity_id=$1`,
      [entityId],
    ),
    query(
      `WITH ranked AS (
         SELECT source, source_key, source_class, status, jobs_found, authoritative_zero,
                lineage_root, details, checked_at,
                ROW_NUMBER() OVER (PARTITION BY source ORDER BY checked_at DESC, id DESC) AS rn
         FROM entity_source_coverage_history
         WHERE entity_id=$1
       )
       SELECT * FROM ranked WHERE rn=2`,
      [entityId],
    ),
    query(
      `SELECT score, grade, expected_sources, checked_sources, authoritative_sources,
              healthy_authoritative_sources, independent_lineages, gaps, details, assessed_at
       FROM entity_coverage_assessment WHERE entity_id=$1 LIMIT 1`,
      [entityId],
    ),
    query(
      `SELECT source_a,source_b,sample_count,median_ratio,p10_ratio,p90_ratio,median_abs_delta,window_days,metadata,updated_at
       FROM source_pair_baselines
       WHERE sample_count >= 5 AND updated_at >= NOW() - INTERVAL '3 days'`,
    ),
  ]);

  const previous: Record<string, any> = {};
  for (const row of previousRows) previous[String(row.source)] = row;
  const issues = evaluateSourceReliability({
    checks,
    previous,
    assessment: assessments[0] || null,
    pairBaselines,
    staleHours: STALE_HOURS,
  });

  const openKeys = new Set(issues.map(issue => issue.key));
  for (const issue of issues) {
    await query(
      `INSERT INTO entity_source_incidents (
         entity_id, incident_key, kind, severity, source, status, message, details,
         first_seen_at, last_seen_at, resolved_at
       ) VALUES ($1,$2,$3,$4,$5,'open',$6,$7::jsonb,NOW(),NOW(),NULL)
       ON CONFLICT (entity_id, incident_key) DO UPDATE SET
         kind=EXCLUDED.kind, severity=EXCLUDED.severity, source=EXCLUDED.source,
         status='open', message=EXCLUDED.message, details=EXCLUDED.details,
         last_seen_at=NOW(), resolved_at=NULL`,
      [entityId, issue.key, issue.kind, issue.severity, issue.source, issue.message, JSON.stringify(issue.details || {})],
    );
  }

  const currentOpen = await query(
    `SELECT incident_key FROM entity_source_incidents WHERE entity_id=$1 AND status='open'`,
    [entityId],
  );
  const resolvedKeys = currentOpen.map(row => String(row.incident_key)).filter(key => !openKeys.has(key));
  if (resolvedKeys.length) {
    await query(
      `UPDATE entity_source_incidents
       SET status='resolved', resolved_at=NOW(), last_seen_at=NOW()
       WHERE entity_id=$1 AND status='open' AND incident_key = ANY($2::text[])`,
      [entityId, resolvedKeys],
    );
  }

  await query(
    `DELETE FROM entity_source_coverage_history
     WHERE entity_id=$1 AND checked_at < NOW() - ($2::int * INTERVAL '1 day')`,
    [entityId, HISTORY_RETENTION_DAYS],
  ).catch(() => {});

  return issues;
}

export async function refreshStaleSourceReliabilityOnRead(entityId: string) {
  if (!entityId) return;
  const rows = await query(
    `SELECT source, source_class, last_checked_at
     FROM entity_source_coverage
     WHERE entity_id=$1 AND source_class='authoritative'
       AND source NOT LIKE 'identity:%'
       AND source NOT LIKE 'registry:%'
       AND source NOT LIKE 'coverage:%'
       AND source <> 'web:langsearch'
       AND source <> 'adzuna'
       AND source NOT LIKE 'jobapi:%'
       AND last_checked_at < NOW() - ($2::int * INTERVAL '1 hour')
     LIMIT 1`,
    [entityId, STALE_HOURS],
  );
  if (rows.length) await evaluateAndPersistSourceReliability(entityId);
}

export async function readOpenSourceIncidents(entityId: string) {
  try {
    return await query(
      `SELECT incident_key, kind, severity, source, status, message, details,
              first_seen_at, last_seen_at
       FROM entity_source_incidents
       WHERE entity_id=$1 AND status='open'
       ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                last_seen_at DESC, incident_key`,
      [entityId],
    );
  } catch {
    return [];
  }
}

function positiveInt(value: unknown, fallback: number) { const n=Number(value); return Number.isFinite(n)&&n>0?Math.floor(n):fallback; }
