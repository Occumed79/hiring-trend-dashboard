const BASE = 'https://data.usajobs.gov/api/search';

export async function fetchUSAJobsPostings(keywords: string, page: number = 1) {
  const apiKey = process.env.USAJOBS_API_KEY;
  const email = process.env.USAJOBS_EMAIL;
  if (!apiKey || !email) return { jobs: [], total: 0 };

  try {
    const params = new URLSearchParams({
      Keyword: keywords,
      ResultsPerPage: '50',
      Page: String(page),
    });
    const res = await fetch(`${BASE}?${params}`, {
      headers: {
        'Authorization-Key': apiKey,
        'User-Agent': email,
        'Host': 'data.usajobs.gov',
      },
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
          country: loc?.CountryCode || 'US',
          lat: loc?.Latitude ? parseFloat(loc.Latitude) : null,
          lng: loc?.Longitude ? parseFloat(loc.Longitude) : null,
          is_remote: pos?.PositionRemuneration?.[0]?.Description?.includes('Remote') || false,
          is_overseas: loc?.CountryCode && loc.CountryCode !== 'United States' ? true : false,
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
