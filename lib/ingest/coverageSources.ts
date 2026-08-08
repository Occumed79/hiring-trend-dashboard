import { fetchNeoGovFeedJobs, type CoverageCheck } from './neogovFeed';
import { fetchNLxJobs } from './nlx';
import { fetchCareerOneStopJobs } from './careerOneStop';
import { fetchPublicSectorBoardJobs } from './publicSectorBoards';
import { prepareEntityJobSources, fetchEntitySourceGraphJobs } from './entityJobSources';
import { enrichEntityFromContractorIdentity } from './contractorIdentity';

export type CoverageSourceResult = {
  jobs: any[];
  checks: CoverageCheck[];
  authoritativeClaim: boolean;
};

export async function fetchExpandedCoverageSources(entity: any): Promise<CoverageSourceResult> {
  const jobs: any[] = [];
  const checks: CoverageCheck[] = [];

  const identity = await enrichEntityFromContractorIdentity(entity).catch(error => ({
    entity,
    checks: [{
      source: 'identity:contractor',
      source_class: 'verified' as const,
      status: 'error' as const,
      jobs_found: 0,
      details: { purpose: 'contractor identity', error: error instanceof Error ? error.message : String(error) },
    } as CoverageCheck],
  }));
  const effectiveEntity = identity.entity || entity;
  checks.push(...identity.checks);

  const sourceGraph = await prepareEntityJobSources(effectiveEntity).catch(() => []);
  const tasks: Promise<{ jobs: any[]; checks: CoverageCheck[] }>[] = [];

  // Every registered entity source runs independently. A second Workday board or
  // federal/state exception source no longer has to replace the entity's primary ATS.
  tasks.push(fetchEntitySourceGraphJobs(effectiveEntity, sourceGraph).then(result => ({ jobs: result.jobs, checks: result.checks })));

  // NLx direct plus CareerOneStop resilience mirror. Both deliberately share the
  // same lineage so the confidence engine cannot count them as independent proof.
  tasks.push(fetchNLxJobs(effectiveEntity).then(result => ({ jobs: result.jobs, checks: [result.check] })));
  tasks.push(fetchCareerOneStopJobs(effectiveEntity).then(result => ({ jobs: result.jobs, checks: [result.check] })));

  if (['state_agencies','counties_and_cities'].includes(String(effectiveEntity?.portal || ''))) {
    tasks.push(fetchNeoGovFeedJobs(effectiveEntity).then(result => ({ jobs: result.jobs, checks: [result.check] })));
    tasks.push(fetchPublicSectorBoardJobs(effectiveEntity).then(result => ({ jobs: result.jobs, checks: result.checks })));
  }

  const settled: Array<{ jobs: any[]; checks: CoverageCheck[] }> = await Promise.all(tasks.map(task => task.catch(error => ({
    jobs: [],
    checks: [{
      source: 'coverage:internal',
      source_class: 'supplemental' as const,
      status: 'error' as const,
      jobs_found: 0,
      details: { reason: null, error: error instanceof Error ? error.message : String(error) },
    } as CoverageCheck],
  }))));

  for (const result of settled) {
    jobs.push(...result.jobs);
    checks.push(...result.checks);
  }

  const authoritativeClaim = checks.some(check =>
    check.source_class === 'authoritative'
    && (check.status === 'success' || (check.status === 'zero' && check.authoritative_zero === true))
  );

  return { jobs, checks, authoritativeClaim };
}
