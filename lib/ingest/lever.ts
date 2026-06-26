import { fetchJson, getIngestTimeout } from './http';

export async function fetchLeverJobs(companyId: string) {
  try {
    const data = await fetchJson(
      `https://api.lever.co/v0/postings/${encodeURIComponent(companyId)}?mode=json&limit=500`,
      {},
      getIngestTimeout(10000)
    );

    return (Array.isArray(data) ? data : []).map((job: any) => ({
      external_id: String(job.id || job.text),
      source: 'lever',
      title: job.text,
      department: job.categories?.department || null,
      location: job.categories?.location || null,
      city: job.categories?.location?.split(',')?.[0]?.trim() || null,
      country: 'US',
      is_remote: job.categories?.commitment?.toLowerCase().includes('remote') || false,
      is_overseas: false,
      posted_at: job.createdAt ? new Date(job.createdAt).toISOString() : null,
      raw_data: job,
    })).filter((job: any) => job.external_id && job.title);
  } catch (e) {
    console.error('Lever fetch error:', e);
    return [];
  }
}
