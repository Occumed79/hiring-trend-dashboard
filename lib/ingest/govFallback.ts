import { fetchUSAJobsForAgency } from './usajobs';

/**
 * Federal-only government fallback.
 * State agencies and counties/cities must use their own authoritative career
 * systems (GovernmentJobs/NEOGOV, Workday, agency career pages, etc.) rather
 * than borrowing federal USAJOBS results.
 */
export async function fetchGovernmentFallbackJobs(entity: any) {
  if (entity.portal !== 'federal_agencies') return { jobs: [], used: [], skipped: [] };

  const hasUserAgent = process.env.USAJOBS_USER_AGENT || process.env.USAJOBS_EMAIL;
  if (!process.env.USAJOBS_API_KEY || !hasUserAgent) {
    return { jobs: [], used: [], skipped: ['usajobs (key/user-agent missing)'] };
  }

  const result = await fetchUSAJobsForAgency(
    entity.name,
    entity.ats_provider === 'usajobs' ? entity.ats_board_id : null,
    Array.isArray(entity.aliases) ? entity.aliases : [],
  );

  if (!result.jobs.length) {
    return {
      jobs: [],
      used: [],
      skipped: [result.organizationCode
        ? `usajobs (${result.organizationCode}; 0 verified jobs returned)`
        : 'usajobs (agency code not resolved and 0 verified keyword matches)'],
    };
  }

  return {
    jobs: result.jobs,
    used: [`usajobs:${result.organizationCode || 'verified-keyword'}`],
    skipped: [],
  };
}
