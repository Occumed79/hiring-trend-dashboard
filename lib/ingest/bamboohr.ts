import { fetchJson, getIngestTimeout } from './http';

export async function fetchBambooHRJobs(companySubdomain: string) {
  if (!companySubdomain) return [];

  try {
    const data = await fetchJson(
      `https://${sanitizeSubdomain(companySubdomain)}.bamboohr.com/careers/list`,
      {},
      getIngestTimeout(10000)
    ).catch(() => null);
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
    })).filter((job: any) => job.external_id && job.title);
  } catch (e) {
    console.error('BambooHR fetch error:', e);
    return [];
  }
}

function sanitizeSubdomain(value: string) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\.bamboohr\.com.*$/i, '').replace(/[^a-z0-9-]/gi, '');
}

function splitCity(location?: string | null): string | null {
  if (!location) return null;
  return String(location).split(',')[0]?.trim() || null;
}

function splitState(location?: string | null): string | null {
  if (!location) return null;
  return String(location).split(',')[1]?.trim() || null;
}
