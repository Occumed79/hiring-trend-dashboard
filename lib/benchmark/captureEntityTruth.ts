import { query } from '@/db/client';
import { auditOfficialSource, type OfficialSourceAudit } from './officialSourceAuditor';

const COHORT_KEY = String(process.env.BENCHMARK_COHORT_KEY || 'default').trim() || 'default';
const REFRESH_HOURS = positiveInt(process.env.BENCHMARK_AUTO_TRUTH_REFRESH_HOURS, 12);

export async function captureEntityBenchmarkTruth(entityId: string) {
  if (!entityId || process.env.BENCHMARK_AUTO_TRUTH_ENABLED === 'false') return { status: 'skipped', reason: 'disabled or missing entity' };

  const cohort = await query(
    `SELECT e.id,e.name,e.portal::text AS portal,e.ats_provider,e.ats_board_id,e.career_page_url,e.aliases
     FROM benchmark_cohort_members m JOIN entities e ON e.id=m.entity_id
     WHERE m.entity_id=$1 AND m.cohort_key=$2 AND m.is_active=true AND e.is_active=true LIMIT 1`,
    [entityId, COHORT_KEY],
  ).catch(() => []);
  if (!cohort.length) return { status: 'skipped', reason: 'entity is not in active benchmark cohort' };
  const entity = cohort[0];

  const fresh = await query(
    `SELECT id,captured_at,captured_by FROM benchmark_truth_snapshots
     WHERE entity_id=$1 AND captured_at >= NOW() - ($2::int * INTERVAL '1 hour')
     ORDER BY captured_at DESC,id DESC LIMIT 1`,
    [entityId, REFRESH_HOURS],
  ).catch(() => []);
  if (fresh.length) return { status: 'skipped', reason: 'fresh truth snapshot already exists', truth_id: fresh[0].id };

  const sourceRows = await query(
    `SELECT source_key,source_type,source_class,lineage_root,source_url,ats_provider,board_id,is_verified,metadata,last_verified_at
     FROM entity_job_sources
     WHERE entity_id=$1 AND is_active=true AND source_class='authoritative' AND source_type<>'identity'
     ORDER BY (metadata->>'primary'='true') DESC,last_verified_at DESC NULLS LAST,source_key`,
    [entityId],
  ).catch(() => []);

  const sources = collapseSources(sourceRows.length ? sourceRows : syntheticSources(entity));
  if (!sources.length) return { status: 'skipped', reason: 'no dedicated authoritative source can be independently audited' };

  const results: Array<{ source: any; result: OfficialSourceAudit }> = [];
  for (const source of sources) {
    const result = await auditOfficialSource(entity, source);
    results.push({ source, result });
    await persistAudit(entityId, source, result);
  }

  const eligible = results.filter(({ result }) => result.complete && result.officialCount !== null);
  if (!eligible.length) return { status: 'audited_no_truth', audited: results.length };

  const allSourcesAudited = eligible.length === sources.length;
  const allUrlComplete = allSourcesAudited && eligible.every(({ result }) => result.officialCount === 0 || result.jobUrls.length === result.officialCount);
  if (allUrlComplete) {
    const urls = Array.from(new Set(eligible.flatMap(({ result }) => result.jobUrls)));
    const row = await saveTruth(entity, eligible, urls.length, urls, 'auto-official-auditor', 'Independent complete URL inventories from all dedicated authoritative source nodes.');
    return { status: 'truth_captured', evidence: 'ground_truth', truth_id: row?.id || null, official_job_count: urls.length };
  }

  if (sources.length === 1 && eligible.length === 1) {
    const result = eligible[0].result;
    const row = await saveTruth(entity, eligible, Number(result.officialCount || 0), [], 'auto-official-auditor-count', 'Independent complete official inventory count; posting-level precision/recall not claimed.');
    return { status: 'truth_captured', evidence: 'official_count', truth_id: row?.id || null, official_job_count: result.officialCount };
  }

  return { status: 'audited_no_truth', audited: results.length, reason: 'multiple authoritative inventories could not all produce complete URL truth' };
}

async function persistAudit(entityId: string, source: any, result: OfficialSourceAudit) {
  await query(
    `INSERT INTO benchmark_source_audits(entity_id,source_key,source_label,source_url,ats_provider,status,complete,official_job_count,job_urls,truth_eligible,details,audited_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,NOW())`,
    [entityId, source.source_key, result.sourceLabel || null, result.sourceUrl || source.source_url || null, source.ats_provider || null,
      result.status, Boolean(result.complete), result.officialCount, JSON.stringify(result.jobUrls || []), Boolean(result.complete && result.officialCount !== null),
      JSON.stringify({ ...(result.metadata || {}), lineage_root: source.lineage_root })],
  ).catch(() => {});
}

async function saveTruth(entity: any, eligible: Array<{ source: any; result: OfficialSourceAudit }>, count: number, urls: string[], capturedBy: string, notes: string) {
  const sources = eligible.map(({ source, result }) => ({
    source_key: source.source_key,
    lineage_root: source.lineage_root,
    ats_provider: source.ats_provider || null,
    source_url: result.sourceUrl || source.source_url || null,
    official_count: result.officialCount,
  }));
  const primary = eligible[0]?.result;
  const rows = await query(
    `INSERT INTO benchmark_truth_snapshots(entity_id,source_url,source_label,official_job_count,job_urls,sampled_job_urls,captured_by,notes,metadata)
     VALUES($1,$2,$3,$4,$5::jsonb,'[]'::jsonb,$6,$7,$8::jsonb) RETURNING id,captured_at`,
    [entity.id, primary?.sourceUrl || entity.career_page_url || null,
      eligible.length === 1 ? primary?.sourceLabel || 'Independent official auditor' : `${eligible.length} independent official inventories`,
      count, JSON.stringify(urls), capturedBy, notes,
      JSON.stringify({ automatic: true, portal: entity.portal, sources, complete_url_truth: urls.length === count })],
  );
  return rows[0] || null;
}

function syntheticSources(entity: any) {
  if (!entity.career_page_url && !entity.ats_provider && !entity.ats_board_id) return [];
  return [{
    source_key: 'synthetic-primary', source_type: 'ats', source_class: 'authoritative',
    lineage_root: `ats:${entity.ats_provider || 'career'}:${entity.ats_board_id || entity.id}`,
    source_url: entity.career_page_url, ats_provider: entity.ats_provider, board_id: entity.ats_board_id,
    is_verified: true, metadata: { primary: true, shared_inventory: false },
  }];
}
function collapseSources(rows: any[]) {
  const map = new Map<string, any>();
  for (const row of rows) {
    if (row?.metadata?.shared_inventory === true) continue;
    const key = String(row.lineage_root || `${row.ats_provider || ''}|${row.board_id || ''}|${row.source_url || ''}`);
    const current = map.get(key);
    if (!current || score(row) > score(current)) map.set(key, row);
  }
  return Array.from(map.values());
}
function score(row: any) { return (row?.metadata?.primary === true ? 10 : 0) + (row?.is_verified ? 4 : 0) + (row?.board_id ? 2 : 0) + (row?.source_url ? 1 : 0); }
function positiveInt(value: unknown, fallback: number) { const n=Number(value); return Number.isFinite(n)&&n>0?Math.floor(n):fallback; }
