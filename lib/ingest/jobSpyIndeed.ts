// Hiring Insights intentionally uses JobSpy only for Indeed. LinkedIn is excluded
// as a source by product decision, even if JOBSPY_SITES contains it in an older
// runtime environment.
export async function fetchJobSpyJobs(entity: any) {
  const previous = process.env.JOBSPY_SITES;
  process.env.JOBSPY_SITES = 'indeed';
  try {
    const module = await import('./jobSpy');
    const result = await module.fetchJobSpyJobs(entity);
    return {
      ...result,
      jobs: Array.isArray(result.jobs) ? result.jobs.filter((job: any) => String(job?.source || '') === 'jobspy:indeed') : [],
      used: Array.isArray(result.used) ? result.used.filter((source: string) => source === 'jobspy:indeed') : [],
      skipped: Array.isArray(result.skipped) ? result.skipped.filter((message: string) => !String(message).toLowerCase().includes('linkedin')) : [],
      site_results: Array.isArray(result.site_results) ? result.site_results.filter((site: any) => site?.site === 'indeed') : [],
    };
  } finally {
    if (previous === undefined) delete process.env.JOBSPY_SITES;
    else process.env.JOBSPY_SITES = previous;
  }
}
