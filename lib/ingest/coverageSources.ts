import { fetchNeoGovFeedJobs, type CoverageCheck } from './neogovFeed';
import { fetchNLxJobs } from './nlx';
import { fetchPublicSectorBoardJobs } from './publicSectorBoards';

export type CoverageSourceResult = {
  jobs: any[];
  checks: CoverageCheck[];
  authoritativeClaim: boolean;
};

export async function fetchExpandedCoverageSources(entity: any): Promise<CoverageSourceResult> {
  const jobs: any[] = [];
  const checks: CoverageCheck[] = [];

  const tasks: Promise<{ jobs: any[]; checks: CoverageCheck[] }>[] = [];

  // NLx is useful across employer types. If credentials/location are unavailable,
  // it records a skipped check instead of silently disappearing.
  tasks.push(fetchNLxJobs(entity).then(result => ({ jobs: result.jobs, checks: [result.check] })));

  if (['state_agencies','counties_and_cities'].includes(String(entity?.portal || ''))) {
    tasks.push(fetchNeoGovFeedJobs(entity).then(result => ({ jobs: result.jobs, checks: [result.check] })));
    tasks.push(fetchPublicSectorBoardJobs(entity).then(result => ({ jobs: result.jobs, checks: result.checks })));
  }

  const settled = await Promise.all(tasks.map(task => task.catch(error => ({
    jobs: [],
    checks: [{
      source: 'coverage:internal',
      source_class: 'supplemental' as const,
      status: 'error' as const,
      jobs_found: 0,
      details: { error: error instanceof Error ? error.message : String(error) },
    }],
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
