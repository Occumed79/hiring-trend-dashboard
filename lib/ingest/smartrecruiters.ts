export async function fetchSmartRecruitersJobs(companyIdentifier: string) {
  if (!companyIdentifier) return [];

  try {
    const res = await fetch(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyIdentifier)}/postings?limit=100`,
      {
        headers: {
          'user-agent': 'OccuMedHiringTrendDashboard/1.0 (+https://github.com/Occumed79/hiring-trend-dashboard)',
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(9000),
      }
    );

    if (!res.ok) return [];
    const data = await res.json();
    const postings = Array.isArray(data?.content) ? data.content : [];

    return postings.map((job: any) => ({
      external_id: String(job.id || job.uuid || job.refNumber || job.name),
      source: 'smartrecruiters',
      title: job.name || job.title || 'Untitled role',
      department: job.department?.label || job.department || null,
      location: formatLocation(job.location),
      city: job.location?.city || null,
      state: job.location?.region || job.location?.state || null,
      country: job.location?.country || 'US',
      lat: null,
      lng: null,
      is_remote: /remote/i.test(`${job.name || ''} ${formatLocation(job.location) || ''}`),
      is_overseas: (job.location?.country || 'US') !== 'US',
      posted_at: job.releasedDate || job.createdOn || null,
      raw_data: job,
    }));
  } catch (e) {
    console.error('SmartRecruiters fetch error:', e);
    return [];
  }
}

function formatLocation(location: any): string | null {
  if (!location) return null;
  const parts = [location.city, location.region || location.state, location.country].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
