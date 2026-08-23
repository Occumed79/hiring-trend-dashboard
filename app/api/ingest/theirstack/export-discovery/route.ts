import { NextRequest, NextResponse } from 'next/server';
import { discoverTheirStackAppExports } from '@/lib/ingest/theirStackExportDiscovery';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const lookbackDays = Number(body?.lookback_days || 0) || undefined;
    const result = await discoverTheirStackAppExports(lookbackDays);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected TheirStack export discovery error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
