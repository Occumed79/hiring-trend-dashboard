export async function fetchGreenhouseJobs(boardToken: string) {
  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.jobs || []).map((job: any) => ({
      external_id: String(job.id),
      source: 'greenhouse',
      title: job.title,
      department: job.departments?.[0]?.name || null,
      location: job.location?.name || null,
      city: job.location?.name?.split(',')?.[0]?.trim() || null,
      country: detectCountry(job.location?.name),
      is_remote: job.location?.name?.toLowerCase().includes('remote') || false,
      is_overseas: isOverseas(job.location?.name),
      posted_at: job.updated_at || null,
      raw_data: job,
    }));
  } catch (e) {
    console.error('Greenhouse fetch error:', e);
    return [];
  }
}

function detectCountry(loc: string | null): string {
  if (!loc) return 'US';
  const l = loc.toLowerCase();
  if (l.includes('uk') || l.includes('united kingdom')) return 'GB';
  if (l.includes('germany')) return 'DE';
  if (l.includes('canada')) return 'CA';
  if (l.includes('australia')) return 'AU';
  if (l.includes('iraq')) return 'IQ';
  if (l.includes('kuwait')) return 'KW';
  if (l.includes('qatar')) return 'QA';
  if (l.includes('bahrain')) return 'BH';
  return 'US';
}

function isOverseas(loc: string | null): boolean {
  if (!loc) return false;
  const keys = ['iraq','afghanistan','kuwait','bahrain','qatar','djibouti','germany','japan','korea','okinawa','overseas'];
  return keys.some(k => loc.toLowerCase().includes(k));
}
