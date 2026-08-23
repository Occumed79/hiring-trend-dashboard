import { NextRequest, NextResponse } from 'next/server';
import { runTheirStackCompanySweep } from '@/lib/ingest/theirStackCompanySweep';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const result = await runTheirStackCompanySweep({ force: body?.force === true });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected TheirStack company sweep error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
