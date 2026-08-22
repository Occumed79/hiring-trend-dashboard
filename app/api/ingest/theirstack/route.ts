import { NextRequest, NextResponse } from 'next/server';
import { runSupplementalIngest } from '@/lib/ingest/runSupplementalIngest';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const entityId = String(body?.entity_id || '').trim();
    if (!entityId) return NextResponse.json({ error: 'entity_id required' }, { status: 400 });

    const result = await runSupplementalIngest(entityId);
    const row = result.results[0];
    if (!row) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    if (row.status === 'error') return NextResponse.json(row, { status: 500 });
    return NextResponse.json(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected supplemental ingest error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
