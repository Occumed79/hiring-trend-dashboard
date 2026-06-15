export async function fetchBambooHRJobs(companySubdomain: string) {
  if (!companySubdomain) return [];

  try {
    const res = await fetch(`https://${companySubdomain}.bamboohr.com/careers/list`, {
      headers: {
        'user-agent': 'OccuMedHiringTrendDashboard/1.0 (+https://github.com/Occumed79/hiring-trend-dashboard)',
        accept: 'application/json,text/html;q=0.8,*/*;q=0.7',
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const jobs = Array.isArray(data?.result) ? data.result : Array.isArray(data) ? data : [];

    return jobs.map((job: any) => ({
      external_id: String(job.id || job.jobOpeningId || job.title),
      source: 'bamboohr',
      title: job.title || 'Untitled role',
      department: job.departmentLabel || job.department || null,
      location: job.location?.label || job.location || null,
      city: splitCity(job.location?.label || job.location),
      state: splitState(job.location?.label || job.location),
      country: 'US',
      lat: null,
      lng: null,
      is_remote: /remote/i.test(`${job.title || ''} ${job.location?.label || job.location || ''}`),
      is_overseas: false,
      posted_at: job.datePosted || job.createdDate || null,
      raw_data: job,
    }));
  } catch (e) {
    console.error('BambooHR fetch error:', e);
    return [];
  }
}

function splitCity(location?: string | null): string | null {
  if (!location) return null;
  return String(location).split(',')[0]?.trim() || null;
}

function splitState(location?: string | null): string | null {
  if (!location) return null;
  return String(location).split(',')[1]?.trim() || null;
}
