import { NextRequest, NextResponse } from 'next/server';
import { fetchJobApiJobs } from '@/lib/ingest/jobApiAdapters';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const entityName = body.entity_name || body.name || body.company;

  if (!entityName || typeof entityName !== 'string') {
    return NextResponse.json({ error: 'entity_name is required' }, { status: 400 });
  }

  const result = await fetchJobApiJobs({
    name: entityName,
    aliases: Array.isArray(body.aliases) ? body.aliases : [],
    portal: body.portal || 'private_companies',
    category: body.category || null,
    industry: body.industry || null,
  });

  return NextResponse.json({
    entity: entityName,
    total: result.jobs.length,
    sources_used: result.used,
    sources_skipped: result.skipped,
    jobs: result.jobs,
  });
}
