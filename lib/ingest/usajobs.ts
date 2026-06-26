import { fetchJson, getIngestTimeout } from './http';

const BASE = 'https://data.usajobs.gov/api/search';

export async function fetchUSAJobsPostings(keywords: string, page: number = 1) {
  const apiKey = process.env.USAJOBS_API_KEY;
  const userAgent = process.env.USAJOBS_USER_AGENT || process.env.USAJOBS_EMAIL;

  if (!apiKey || !userAgent) return { jobs: [], total: 0 };

  try {
    const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1;
    const params = new URLSearchParams({
      Keyword: keywords,
      ResultsPerPage: '50',
      Page: String(safePage),
    });
    const data = await fetchJson(`${BASE}?${params}`, {
      headers: {
        'Authorization-Key': apiKey,
        'User-Agent': userAgent,
        'Host': 'data.usajobs.gov',
      },
    }, getIngestTimeout(10000));

    const items = data.SearchResult?.SearchResultItems || [];
    const total = data.SearchResult?.SearchResultCount || 0;

    return {
      total,
      jobs: (Array.isArray(items) ? items : []).map((item: any) => {
        const pos = item.MatchedObjectDescriptor;
        const loc = pos?.PositionLocation?.[0];
        return {
          external_id: String(pos?.PositionID || pos?.PositionURI || pos?.PositionTitle),
          source: 'usajobs',
          title: pos?.PositionTitle,
          department: pos?.DepartmentName,
          location: loc?.LocationName || null,
          city: loc?.CityName || null,
          state: loc?.CountrySubDivisionCode || null,
          country: 'US',
          lat: toNumber(loc?.Latitude),
          lng: toNumber(loc?.Longitude),
          is_remote: /remote/i.test(`${pos?.PositionTitle || ''} ${loc?.LocationName || ''}`),
          is_overseas: false,
          posted_at: pos?.PublicationStartDate || null,
          raw_data: pos,
        };
      }).filter((job: any) => job.external_id && job.title),
    };
  } catch (e) {
    console.error('USAJobs fetch error:', e);
    return { jobs: [], total: 0 };
  }
}

function toNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
