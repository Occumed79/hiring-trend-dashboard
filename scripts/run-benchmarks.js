try {
  const dotenv = require('dotenv');
  dotenv.config({ path: '.env.local' });
  dotenv.config();
} catch (err) {
  if (err?.code !== 'MODULE_NOT_FOUND') throw err;
}

const { Client } = require('pg');
const { assessEntityBenchmark, assessPortalRelease, normalizeJobUrl } = require('../lib/benchmark/benchmarkRules');

const LIMIT_PER_PORTAL = clampInt(process.env.BENCHMARK_ENTITIES_PER_PORTAL, 25, 1, 100);
const JOB_STALE_DAYS = clampInt(process.env.BENCHMARK_JOB_STALE_DAYS || process.env.JOB_STALE_AFTER_DAYS, 30, 1, 365);
const MODE = process.argv.includes('--scheduled') ? 'scheduled' : 'manual';
const PORTAL_ARG = argValue('--portal');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const client = new Client({ connectionString, ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  let runId = null;
  try {
    const run = await client.query(
      `INSERT INTO benchmark_runs(mode, scope, status) VALUES ($1,$2,'running') RETURNING id`,
      [MODE, PORTAL_ARG ? `portal:${PORTAL_ARG}` : `tracked_entities:${LIMIT_PER_PORTAL}_per_portal`],
    );
    runId = run.rows[0].id;

    const entities = await loadCohort(client);
    const results = [];
    for (const entity of entities) {
      const result = await benchmarkEntity(client, entity);
      results.push(result);
      await persistResult(client, runId, entity, result);
    }

    const portalAssessments = [];
    for (const portal of Array.from(new Set(entities.map(row => row.portal)))) {
      const rows = results.filter(row => row.portal === portal).map(row => row.assessment);
      const release = assessPortalRelease(rows, thresholdsFromEnv());
      portalAssessments.push({ portal, ...release });
      await client.query(
        `INSERT INTO portal_release_assessments(portal_id,status,benchmark_entity_count,truth_entity_count,metrics,blockers,thresholds,assessed_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,NOW())
         ON CONFLICT (portal_id) DO UPDATE SET
           status=EXCLUDED.status, benchmark_entity_count=EXCLUDED.benchmark_entity_count,
           truth_entity_count=EXCLUDED.truth_entity_count, metrics=EXCLUDED.metrics,
           blockers=EXCLUDED.blockers, thresholds=EXCLUDED.thresholds, assessed_at=NOW()`,
        [portal, release.status, release.benchmarkEntityCount, release.truthEntityCount, JSON.stringify(release.metrics), JSON.stringify(release.blockers), JSON.stringify(release.thresholds)],
      );
    }

    const summary = summarize(results, portalAssessments);
    await client.query(`UPDATE benchmark_runs SET status='success', completed_at=NOW(), summary=$2::jsonb WHERE id=$1`, [runId, JSON.stringify(summary)]);
    console.log(`Benchmark run ${runId} complete: ${results.length} entities across ${portalAssessments.length} portals.`);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    if (runId) await client.query(`UPDATE benchmark_runs SET status='error', completed_at=NOW(), error_message=$2 WHERE id=$1`, [runId, message(error)]).catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function loadCohort(client) {
  const params = [];
  let portalClause = '';
  if (PORTAL_ARG) { params.push(PORTAL_ARG); portalClause = `AND e.portal::text=$${params.length}`; }
  const result = await client.query(
    `WITH ranked AS (
       SELECT e.id,e.name,e.portal::text AS portal,e.updated_at,
              COALESCE(a.score,0) AS coverage_score,
              ROW_NUMBER() OVER (PARTITION BY e.portal ORDER BY COALESCE(a.score,0) DESC, e.updated_at DESC, e.name) AS rn
       FROM entities e
       LEFT JOIN entity_coverage_assessment a ON a.entity_id=e.id
       WHERE e.is_active=true ${portalClause}
     )
     SELECT * FROM ranked WHERE rn <= $${params.length + 1}
     ORDER BY portal,rn`,
    [...params, LIMIT_PER_PORTAL],
  );
  return result.rows;
}

async function benchmarkEntity(client, entity) {
  const [jobRows, coverageRows, incidentRows, truthRows] = await Promise.all([
    client.query(
      `SELECT source, external_id, updated_at, posted_at, lat, lng, raw_data,
              COALESCE(raw_data->>'normalized_apply_url', raw_data->>'apply_url', raw_data->>'url') AS apply_url
       FROM jobs WHERE entity_id=$1 AND is_active=true`, [entity.id]),
    client.query(
      `SELECT source,source_class,status,jobs_found,authoritative_zero,lineage_root,details,last_checked_at
       FROM entity_source_coverage WHERE entity_id=$1`, [entity.id]),
    client.query(
      `SELECT severity,kind,source FROM entity_source_incidents WHERE entity_id=$1 AND status='open'`, [entity.id]),
    client.query(
      `SELECT * FROM benchmark_truth_snapshots WHERE entity_id=$1 ORDER BY captured_at DESC,id DESC LIMIT 1`, [entity.id]),
  ]);

  const jobs = jobRows.rows;
  const appUrlsRaw = jobs.map(row => row.apply_url).filter(Boolean);
  const appUrls = Array.from(new Set(appUrlsRaw.map(normalizeJobUrl).filter(Boolean)));
  const duplicateCount = Math.max(0, appUrlsRaw.map(normalizeJobUrl).filter(Boolean).length - appUrls.length);
  const cutoff = Date.now() - JOB_STALE_DAYS * 86400000;
  const staleCount = jobs.filter(row => {
    const seen = row.raw_data?.normalized_seen_at || row.updated_at;
    const timestamp = seen ? new Date(seen).getTime() : 0;
    return !timestamp || timestamp < cutoff;
  }).length;
  const mappedCount = jobs.filter(row => validCoordinate(row.lat, row.lng)).length;
  const inventoryCoverage = coverageRows.rows.filter(isInventoryCoverage);
  const authoritative = inventoryCoverage.filter(row => row.source_class === 'authoritative');
  const authoritativeHealthy = authoritative.filter(row => row.status === 'success' || (row.status === 'zero' && row.authoritative_zero === true));
  const envelope = authoritativeEnvelope(authoritativeHealthy);
  const truth = truthRows.rows[0] || null;
  const truthUrls = jsonArray(truth?.job_urls);
  const officialCount = truth?.official_job_count === null || truth?.official_job_count === undefined ? null : Number(truth.official_job_count);
  const referenceCount = officialCount !== null && Number.isFinite(officialCount)
    ? officialCount
    : envelopeReference(jobs.length, envelope);
  const highIncidentCount = incidentRows.rows.filter(row => ['critical','high'].includes(String(row.severity || '').toLowerCase())).length;

  const assessment = assessEntityBenchmark({
    appUrls,
    truthUrls,
    appCount: appUrls.length || jobs.length,
    referenceCount,
    duplicateCount,
    staleCount,
    mappedCount,
    authoritativeTotal: authoritative.length,
    authoritativeHealthy: authoritativeHealthy.length,
    highIncidentCount,
    thresholds: thresholdsFromEnv(),
  });
  if (truth && !truthUrls.length && officialCount !== null) assessment.evidenceLevel = 'official_count';

  return {
    entityId: entity.id,
    entityName: entity.name,
    portal: entity.portal,
    assessment,
    details: {
      raw_active_rows: jobs.length,
      unique_apply_urls: appUrls.length,
      authoritative_envelope: envelope,
      truth_snapshot_id: truth?.id || null,
      truth_captured_at: truth?.captured_at || null,
      truth_source_url: truth?.source_url || null,
      truth_sample_size: jsonArray(truth?.sampled_job_urls).length,
      open_incidents: incidentRows.rows,
    },
  };
}

async function persistResult(client, runId, entity, row) {
  const a = row.assessment;
  await client.query(
    `INSERT INTO benchmark_results(
       run_id,entity_id,portal,benchmark_mode,app_job_count,reference_job_count,
       matched_job_count,missing_job_count,unexpected_job_count,precision_score,recall_score,
       parity_score,duplicate_rate,stale_rate,mapped_rate,authoritative_health_rate,
       high_incident_count,passed,evidence_level,details
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)`,
    [runId,entity.id,entity.portal,a.evidenceLevel,a.appCount,a.referenceCount,a.matched,a.missing,a.unexpected,
      a.precision,a.recall,a.parity,a.duplicateRate,a.staleRate,a.mappedRate,a.authoritativeHealth,
      a.highIncidentCount,a.passed,a.evidenceLevel,JSON.stringify({ ...row.details, blockers:a.blockers, truth_diff:a.truthDiff })],
  );
}

function authoritativeEnvelope(rows) {
  const counts = rows.map(row => Math.max(0, Number(row.jobs_found || 0))).filter(Number.isFinite);
  return { sources: rows.length, lower: counts.length ? Math.max(...counts) : null, upper: counts.length ? counts.reduce((a,b)=>a+b,0) : null };
}
function envelopeReference(appCount, envelope) {
  if (envelope.lower === null || envelope.upper === null) return null;
  if (appCount >= envelope.lower && appCount <= envelope.upper) return appCount;
  return appCount < envelope.lower ? envelope.lower : envelope.upper;
}
function isInventoryCoverage(row) {
  const source = String(row.source || '').toLowerCase();
  return !source.startsWith('identity:') && !source.startsWith('registry:') && !source.startsWith('coverage:') && source !== 'web:langsearch';
}
function validCoordinate(lat, lng) {
  const a=Number(lat), b=Number(lng); return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180&&!(a===0&&b===0);
}
function jsonArray(value) { return Array.isArray(value) ? value : []; }
function thresholdsFromEnv() {
  const read=(name,fallback)=>{const n=Number(process.env[name]);return Number.isFinite(n)?n:fallback;};
  return {
    minBenchmarkEntities: read('BENCHMARK_MIN_ENTITIES',5), minTruthEntities: read('BENCHMARK_MIN_TRUTH_ENTITIES',3),
    minPrecision: read('BENCHMARK_MIN_PRECISION',0.98), minRecall: read('BENCHMARK_MIN_RECALL',0.90),
    minParity: read('BENCHMARK_MIN_PARITY',0.90), maxDuplicateRate: read('BENCHMARK_MAX_DUPLICATE_RATE',0.01),
    maxStaleRate: read('BENCHMARK_MAX_STALE_RATE',0.03), minMappedRate: read('BENCHMARK_MIN_MAPPED_RATE',0.85),
    minAuthoritativeHealth: read('BENCHMARK_MIN_AUTHORITATIVE_HEALTH',0.95), maxHighIncidentRate: read('BENCHMARK_MAX_HIGH_INCIDENT_RATE',0.05),
  };
}
function summarize(results, portals) {
  return {
    entities: results.length,
    ground_truth_entities: results.filter(row=>row.assessment.evidenceLevel==='ground_truth').length,
    official_count_entities: results.filter(row=>row.assessment.evidenceLevel==='official_count').length,
    live_parity_entities: results.filter(row=>row.assessment.evidenceLevel==='live_parity').length,
    insufficient_entities: results.filter(row=>row.assessment.evidenceLevel==='insufficient').length,
    portals: portals.map(row=>({ portal:row.portal,status:row.status,benchmark_entities:row.benchmarkEntityCount,truth_entities:row.truthEntityCount,blockers:row.blockers })),
  };
}
function argValue(name) { const arg=process.argv.find(value=>value.startsWith(`${name}=`)); return arg ? arg.slice(name.length+1).trim() : null; }
function clampInt(value,fallback,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback;}
function message(error){return error instanceof Error?error.message:String(error);}

main().catch(error => { console.error('Benchmark run failed:', error); process.exitCode=1; });
