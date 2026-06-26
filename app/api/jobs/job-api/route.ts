import { NextRequest, NextResponse } from 'next/server';
import { fetchJobApiJobs } from '@/lib/ingest/jobApiAdapters';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const entityName = String((body as any).entity_name || (body as any).name || (body as any).company || '').trim();
    if (!entityName) {
      return NextResponse.json({ error: 'entity_name is required' }, { status: 400 });
    }

    const result = await fetchJobApiJobs({
      name: entityName,
      aliases: Array.isArray((body as any).aliases) ? (body as any).aliases : [],
      portal: (body as any).portal || 'private_companies',
      category: (body as any).category || null,
      industry: (body as any).industry || null,
    });

    return NextResponse.json({
      entity: entityName,
      total: result.jobs.length,
      sources_used: result.used,
      sources_skipped: result.skipped,
      jobs: result.jobs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected jobs API error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
