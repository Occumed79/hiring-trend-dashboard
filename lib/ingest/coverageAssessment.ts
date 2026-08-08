import { query } from '@/db/client';

export type CoverageAssessment = {
  score: number;
  grade: 'excellent' | 'strong' | 'moderate' | 'limited' | 'unknown';
  expected_sources: number;
  checked_sources: number;
  authoritative_sources: number;
  healthy_authoritative_sources: number;
  independent_lineages: number;
  gaps: string[];
  details: Record<string, any>;
};

const CHECK_STALE_HOURS = positiveInt(process.env.SOURCE_CHECK_STALE_HOURS, 48);

export async function assessAndPersistEntityCoverage(entityId: string): Promise<CoverageAssessment> {
  const assessment = await assessEntityCoverage(entityId);
  await query(
    `INSERT INTO entity_coverage_assessment (
       entity_id, score, grade, expected_sources, checked_sources, authoritative_sources,
       healthy_authoritative_sources, independent_lineages, gaps, details, assessed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,NOW())
     ON CONFLICT (entity_id) DO UPDATE SET
       score=EXCLUDED.score, grade=EXCLUDED.grade, expected_sources=EXCLUDED.expected_sources,
       checked_sources=EXCLUDED.checked_sources, authoritative_sources=EXCLUDED.authoritative_sources,
       healthy_authoritative_sources=EXCLUDED.healthy_authoritative_sources,
       independent_lineages=EXCLUDED.independent_lineages, gaps=EXCLUDED.gaps,
       details=EXCLUDED.details, assessed_at=NOW()`,
    [entityId,assessment.score,assessment.grade,assessment.expected_sources,assessment.checked_sources,
      assessment.authoritative_sources,assessment.healthy_authoritative_sources,assessment.independent_lineages,
      JSON.stringify(assessment.gaps),JSON.stringify(assessment.details)],
  );
  return assessment;
}

export async function readCoverageAssessment(entityId: string): Promise<CoverageAssessment | null> {
  try {
    const rows = await query(
      `SELECT score, grade, expected_sources, checked_sources, authoritative_sources,
              healthy_authoritative_sources, independent_lineages, gaps, details, assessed_at
       FROM entity_coverage_assessment WHERE entity_id=$1 LIMIT 1`,
      [entityId],
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function assessEntityCoverage(entityId: string): Promise<CoverageAssessment> {
  const [sources, checks] = await Promise.all([
    safeQuery(
      `SELECT source_key, source_type, source_class, lineage_root, source_url, ats_provider,
              is_verified, last_verified_at, metadata
       FROM entity_job_sources WHERE entity_id=$1 AND is_active=true`,
      [entityId],
    ),
    safeQuery(
      `SELECT source, source_key, source_class, status, jobs_found, authoritative_zero,
              lineage_root, details, last_checked_at, last_success_at
       FROM entity_source_coverage WHERE entity_id=$1`,
      [entityId],
    ),
  ]);

  if (!sources.length && !checks.length) return emptyAssessment();

  const expected = sources.filter((row:any) => row.source_type !== 'identity');
  const checkByKey = new Map<string, any>();
  for (const check of checks) {
    for (const key of [check.source_key, check.source].filter(Boolean).map(String)) {
      const current = checkByKey.get(key);
      if (!current || checkedAt(check) > checkedAt(current)) checkByKey.set(key, check);
    }
  }

  const evaluated = expected.map((source:any) => {
    const check = checkByKey.get(String(source.source_key));
    const recent = check ? Date.now() - checkedAt(check) <= CHECK_STALE_HOURS * 3600000 : false;
    const healthy = Boolean(check && recent && ['success','zero'].includes(String(check.status)));
    return { source, check: check || null, recent, healthy };
  });

  const authoritative = expected.filter((row:any) => row.source_class === 'authoritative');
  const healthyAuthoritative = evaluated.filter(row => row.source.source_class === 'authoritative' && row.healthy);
  const checkedExpected = evaluated.filter(row => row.check && row.recent);

  const lineages = new Set<string>();
  for (const row of evaluated.filter(row => row.healthy)) lineages.add(normalizeLineage(row.source.lineage_root || row.check?.lineage_root || row.source.source_key));
  for (const check of checks) {
    if (!['success','zero'].includes(String(check.status))) continue;
    const lineage = normalizeLineage(check.lineage_root || check.details?.lineage_root || lineageForObservedSource(check.source));
    if (lineage) lineages.add(lineage);
  }

  const firstPartyHealthy = evaluated.some(row => row.healthy && isFirstParty(row.source));
  const expectedRatio = expected.length ? checkedExpected.length / expected.length : 0;
  const authoritativeRatio = authoritative.length ? healthyAuthoritative.length / authoritative.length : 0;

  let score = 0;
  score += Math.round(expectedRatio * 40);
  score += Math.round(authoritativeRatio * 35);
  score += Math.min(15, lineages.size * 5);
  if (firstPartyHealthy) score += 10;
  if (!authoritative.length) score = Math.min(score, 55);
  if (authoritative.length && healthyAuthoritative.length === 0) score = Math.min(score, 45);
  score = clamp(score, 0, 100);

  const gaps: string[] = [];
  for (const row of evaluated) {
    if (!row.check) gaps.push(`Not checked: ${label(row.source)}`);
    else if (!row.recent) gaps.push(`Stale check: ${label(row.source)}`);
    else if (row.check.status === 'error') gaps.push(`Source error: ${label(row.source)}`);
    else if (row.check.status === 'skipped') gaps.push(`Source skipped: ${label(row.source)}`);
  }
  if (!authoritative.length) gaps.push('No authoritative hiring source is registered.');
  else if (!healthyAuthoritative.length) gaps.push('No authoritative source has a recent healthy check.');
  if (lineages.size < 2 && checks.some((row:any) => row.source_class === 'verified' || row.source_class === 'supplemental')) gaps.push('Coverage has fewer than two independent healthy source lineages.');

  const assessment: CoverageAssessment = {
    score,
    grade: grade(score),
    expected_sources: expected.length,
    checked_sources: checkedExpected.length,
    authoritative_sources: authoritative.length,
    healthy_authoritative_sources: healthyAuthoritative.length,
    independent_lineages: lineages.size,
    gaps: gaps.slice(0, 12),
    details: {
      checked_within_hours: CHECK_STALE_HOURS,
      expected_check_ratio: round(expectedRatio),
      authoritative_health_ratio: round(authoritativeRatio),
      first_party_healthy: firstPartyHealthy,
      lineages: Array.from(lineages).sort(),
      observed_sources: checks.length,
      algorithm: 'expected-health-40 + authoritative-health-35 + independent-lineages-15 + first-party-10',
    },
  };
  return assessment;
}

function emptyAssessment(): CoverageAssessment {
  return { score:0, grade:'unknown', expected_sources:0, checked_sources:0, authoritative_sources:0, healthy_authoritative_sources:0, independent_lineages:0, gaps:['No hiring sources have been registered yet.'], details:{ algorithm:'source graph not initialized' } };
}
function isFirstParty(source:any) { const lineage=String(source?.lineage_root||'').toLowerCase(); return source?.source_class==='authoritative' && (/^ats:/.test(lineage)||/^official-domain:/.test(lineage)||/^state-jobs:/.test(lineage)||/^usps$/.test(lineage)||/^federal-/.test(lineage)); }
function normalizeLineage(value:unknown) { const text=String(value||'').trim().toLowerCase(); if(!text)return ''; if(text==='careeronestop'||text.startsWith('nlx-mirror:'))return 'nlx'; return text; }
function lineageForObservedSource(source:unknown) { const value=String(source||'').toLowerCase(); if(value==='nlx')return 'nlx'; if(value.startsWith('board:'))return value; if(value==='usajobs')return 'usajobs'; if(value==='gov:neogov_rss')return 'neogov'; if(value.startsWith('ats:'))return value; if(['workday','greenhouse','lever','smartrecruiters','bamboohr','ashby','recruitee','workable','personio'].includes(value))return `ats:${value}`; return value; }
function label(source:any) { return String(source?.metadata?.organization_name||source?.source_key||source?.source_url||'source'); }
function checkedAt(row:any) { const value=row?.last_checked_at||row?.last_success_at; const time=value?new Date(value).getTime():0; return Number.isFinite(time)?time:0; }
function grade(score:number):CoverageAssessment['grade'] { if(score>=90)return'excellent'; if(score>=75)return'strong'; if(score>=55)return'moderate'; if(score>0)return'limited'; return'unknown'; }
function round(value:number){return Math.round(value*1000)/1000;}
function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}
function positiveInt(value:unknown,fallback:number){const n=Number(value);return Number.isFinite(n)&&n>0?Math.floor(n):fallback;}
async function safeQuery(sql:string,params:any[]){try{return await query(sql,params);}catch{return[];}}
