const BASE = 'https://api.adzuna.com/v1/api/jobs';

export async function fetchAdzunaJobs(entityName: string, country: string = 'us', page: number = 1) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return { jobs: [], total: 0 };

  try {
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: '50',
      what_or: entityName,
      content_type: 'application/json',
    });
    const res = await fetch(`${BASE}/${country}/search/${page}?${params}`);
    if (!res.ok) return { jobs: [], total: 0 };
    const data = await res.json();
    return {
      total: data.count || 0,
      jobs: (data.results || []).map((job: any) => ({
        external_id: job.id,
        source: 'adzuna',
        title: job.title,
        department: null,
        location: job.location?.display_name || null,
        city: job.location?.area?.[3] || job.location?.area?.[2] || null,
        state: job.location?.area?.[1] || null,
        country: country.toUpperCase(),
        lat: job.latitude || null,
        lng: job.longitude || null,
        is_remote: job.title?.toLowerCase().includes('remote') || false,
        is_overseas: country !== 'us',
        posted_at: job.created || null,
        raw_data: job,
      })),
    };
  } catch (e) {
    console.error('Adzuna fetch error:', e);
    return { jobs: [], total: 0 };
  }
}

export async function getAdzunaCountryCounts(entityName: string) {
  const countries = ['us', 'gb', 'au', 'ca', 'de', 'fr', 'in', 'sg'];
  const results: Record<string, number> = {};
  for (const country of countries) {
    const { total } = await fetchAdzunaJobs(entityName, country, 1);
    results[country] = total;
  }
  return results;
}
