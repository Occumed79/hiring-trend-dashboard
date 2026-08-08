import { query } from '@/db/client';

export async function GET() {
  try {
    const latestRunRows = await query(
      `SELECT id,mode,scope,status,started_at,completed_at,summary,error_message
       FROM benchmark_runs ORDER BY started_at DESC,id DESC LIMIT 1`,
    );
    const latestRun = latestRunRows[0] || null;
    const runId = latestRun?.id || null;

    const [summaryRows, sourceFleet, incidents, releases, benchmarkPortals, pairBaselines, truthCoverage, truthCandidates, auditCoverage] = await Promise.all([
      query(
        `SELECT
           (SELECT COUNT(*)::int FROM entities WHERE is_active=true) AS active_entities,
           (SELECT COUNT(*)::int FROM entity_source_coverage) AS latest_source_checks,
           (SELECT COUNT(*)::int FROM entity_source_incidents WHERE status='open') AS open_incidents,
           (SELECT COUNT(*)::int FROM entity_source_incidents WHERE status='open' AND severity IN ('critical','high')) AS high_incidents,
           (SELECT COUNT(*)::int FROM benchmark_truth_snapshots) AS truth_snapshots,
           (SELECT COUNT(DISTINCT entity_id)::int FROM benchmark_truth_snapshots) AS truth_entities,
           (SELECT COUNT(*)::int FROM benchmark_source_audits) AS official_audits,
           (SELECT COUNT(DISTINCT entity_id)::int FROM benchmark_source_audits WHERE complete=true) AS independently_audited_entities`,
      ),
      query(
        `SELECT source,
                COUNT(*)::int AS entities,
                COUNT(*) FILTER (WHERE status IN ('success','zero'))::int AS healthy,
                COUNT(*) FILTER (WHERE status='error')::int AS errors,
                COUNT(*) FILTER (WHERE status='skipped')::int AS skipped,
                COUNT(*) FILTER (WHERE status='zero')::int AS zeroes,
                COALESCE(SUM(jobs_found),0)::int AS jobs_reported,
                MAX(last_checked_at) AS last_checked_at,
                MIN(last_checked_at) AS oldest_checked_at,
                COUNT(*) FILTER (WHERE source_class='authoritative')::int AS authoritative_entities
         FROM entity_source_coverage
         WHERE source NOT LIKE 'identity:%' AND source NOT LIKE 'registry:%' AND source NOT LIKE 'coverage:%'
         GROUP BY source
         ORDER BY errors DESC, entities DESC, source`,
      ),
      query(
        `SELECT i.incident_key,i.kind,i.severity,i.source,i.message,i.details,i.first_seen_at,i.last_seen_at,
                e.id AS entity_id,e.name AS entity_name,e.portal::text AS portal
         FROM entity_source_incidents i
         JOIN entities e ON e.id=i.entity_id
         WHERE i.status='open'
         ORDER BY CASE i.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                  i.last_seen_at DESC
         LIMIT 150`,
      ),
      query(
        `SELECT portal_id,status,benchmark_entity_count,truth_entity_count,metrics,blockers,thresholds,assessed_at
         FROM portal_release_assessments
         ORDER BY CASE status WHEN 'fail' THEN 1 WHEN 'insufficient_evidence' THEN 2 WHEN 'pass' THEN 3 ELSE 4 END, portal_id`,
      ),
      runId ? query(
        `SELECT portal,
                COUNT(*)::int AS entities,
                COUNT(*) FILTER (WHERE evidence_level='ground_truth')::int AS truth_entities,
                COUNT(*) FILTER (WHERE passed=true)::int AS passed,
                COUNT(*) FILTER (WHERE passed=false)::int AS failed,
                AVG(precision_score)::float AS precision,
                AVG(recall_score)::float AS recall,
                AVG(parity_score)::float AS parity,
                AVG(mapped_rate)::float AS mapped_rate,
                AVG(authoritative_health_rate)::float AS authoritative_health,
                SUM(high_incident_count)::int AS high_incidents
         FROM benchmark_results WHERE run_id=$1
         GROUP BY portal ORDER BY portal`, [runId]) : Promise.resolve([]),
      query(
        `SELECT source_a,source_b,sample_count,median_ratio,p10_ratio,p90_ratio,median_abs_delta,window_days,metadata,updated_at
         FROM source_pair_baselines
         ORDER BY sample_count DESC,source_a,source_b LIMIT 100`,
      ),
      query(
        `SELECT e.portal::text AS portal,COUNT(DISTINCT t.entity_id)::int AS entities,COUNT(*)::int AS snapshots,MAX(t.captured_at) AS latest_snapshot
         FROM benchmark_truth_snapshots t JOIN entities e ON e.id=t.entity_id
         GROUP BY e.portal ORDER BY e.portal`,
      ),
      query(
        `SELECT e.id,e.name,e.portal::text AS portal,e.career_page_url,COALESCE(a.score,0) AS coverage_score,
                t.captured_at AS latest_truth_at,t.official_job_count AS latest_official_count
         FROM entities e
         LEFT JOIN entity_coverage_assessment a ON a.entity_id=e.id
         LEFT JOIN LATERAL (
           SELECT captured_at,official_job_count FROM benchmark_truth_snapshots bt
           WHERE bt.entity_id=e.id ORDER BY captured_at DESC,id DESC LIMIT 1
         ) t ON true
         WHERE e.is_active=true
         ORDER BY (t.captured_at IS NULL) DESC,e.portal,COALESCE(a.score,0) DESC,e.name
         LIMIT 180`,
      ),
      query(
        `WITH latest AS (
           SELECT DISTINCT ON (a.entity_id,a.source_key)
                  a.entity_id,a.source_key,a.source_label,a.source_url,a.ats_provider,a.status,a.complete,
                  a.official_job_count,a.truth_eligible,a.details,a.audited_at
           FROM benchmark_source_audits a
           ORDER BY a.entity_id,a.source_key,a.audited_at DESC,a.id DESC
         )
         SELECT l.*,e.name AS entity_name,e.portal::text AS portal
         FROM latest l JOIN entities e ON e.id=l.entity_id
         ORDER BY CASE l.status WHEN 'error' THEN 1 WHEN 'incomplete' THEN 2 WHEN 'unsupported' THEN 3 ELSE 4 END,
                  l.audited_at DESC
         LIMIT 150`,
      ),
    ]);

    return Response.json({
      summary: summaryRows[0] || {},
      latest_benchmark_run: latestRun,
      source_fleet: sourceFleet,
      incidents,
      portal_releases: releases,
      benchmark_portals: benchmarkPortals,
      source_pair_baselines: pairBaselines,
      truth_coverage: truthCoverage,
      truth_candidates: truthCandidates,
      official_audits: auditCoverage,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not load source health.' }, { status: 500 });
  }
}
