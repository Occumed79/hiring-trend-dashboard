export async function fetchLeverJobs(companyId: string) {
  try {
    const res = await fetch(
      `https://api.lever.co/v0/postings/${companyId}?mode=json&limit=500`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data || []).map((job: any) => ({
      external_id: job.id,
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
    }));
  } catch (e) {
    console.error('Lever fetch error:', e);
    return [];
  }
}
