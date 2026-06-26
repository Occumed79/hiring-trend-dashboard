import { fetchUSAJobsPostings } from './usajobs';

export async function fetchGovernmentFallbackJobs(entity: any) {
  const portals = ['federal_agencies', 'state_agencies', 'counties_and_cities'];
  if (!portals.includes(entity.portal)) return { jobs: [], used: [], skipped: [] };

  const hasUserAgent = process.env.USAJOBS_USER_AGENT || process.env.USAJOBS_EMAIL;
  if (!process.env.USAJOBS_API_KEY || !hasUserAgent) {
    return { jobs: [], used: [], skipped: ['usajobs (key/user-agent missing)'] };
  }

  const { jobs } = await fetchUSAJobsPostings(entity.name);
  return jobs.length
    ? { jobs, used: ['usajobs'], skipped: [] }
    : { jobs: [], used: [], skipped: ['usajobs (0 jobs returned)'] };
}
