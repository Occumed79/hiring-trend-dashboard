const BASE = 'https://data.usajobs.gov/api/search';

export async function fetchUSAJobsPostings(keywords: string, page: number = 1) {
  const apiKey = process.env.USAJOBS_API_KEY;
  // Support both USAJOBS_USER_AGENT (new) and USAJOBS_EMAIL (legacy)
  const userAgent = process.env.USAJOBS_USER_AGENT || process.env.USAJOBS_EMAIL;

  if (!apiKey || !userAgent) return { jobs: [], total: 0 };

  try {
    const params = new URLSearchParams({
      Keyword: keywords,
      ResultsPerPage: '50',
      Page: String(page),
    });
    const res = await fetch(`${BASE}?${params}`, {
      headers: {
        'Authorization-Key': apiKey,
        'User-Agent': userAgent,
        'Host': 'data.usajobs.gov',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { jobs: [], total: 0 };
    const data = await res.json();
    const items = data.SearchResult?.SearchResultItems || [];
    const total = data.SearchResult?.SearchResultCount || 0;

    return {
      total,
      jobs: items.map((item: any) => {
        const pos = item.MatchedObjectDescriptor;
        const loc = pos?.PositionLocation?.[0];
        return {
          external_id: pos?.PositionID,
          source: 'usajobs',
          title: pos?.PositionTitle,
          department: pos?.DepartmentName,
          location: loc?.LocationName || null,
          city: loc?.CityName || null,
          state: loc?.CountrySubDivisionCode || null,
          country: 'US',
          lat: loc?.Latitude ? parseFloat(loc.Latitude) : null,
          lng: loc?.Longitude ? parseFloat(loc.Longitude) : null,
          is_remote: false,
          is_overseas: false,
          posted_at: pos?.PublicationStartDate || null,
          raw_data: pos,
        };
      }),
    };
  } catch (e) {
    console.error('USAJobs fetch error:', e);
    return { jobs: [], total: 0 };
  }
}
