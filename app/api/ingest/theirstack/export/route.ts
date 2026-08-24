import { NextRequest, NextResponse } from 'next/server';
import { importTheirStackJobExport, listTheirStackExportReceipts, saveTheirStackExportReceipt } from '@/lib/ingest/theirStackExportWebhook';
import { verifyTheirStackExportSecret } from '@/lib/ingest/theirStackExportSecret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authorized(req: NextRequest) {
  const queryToken = String(req.nextUrl.searchParams.get('token') || '').trim();
  const headerToken = String(req.headers.get('x-theirstack-export-secret') || '').trim();
  if (queryToken && await verifyTheirStackExportSecret(queryToken).catch(() => false)) return true;
  if (headerToken && await verifyTheirStackExportSecret(headerToken).catch(() => false)) return true;
  return false;
}

export async function POST(req: NextRequest) {
  if (!await authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const contentType = req.headers.get('content-type');
    const text = await req.text();
    if (!text.trim()) return NextResponse.json({ error: 'Empty export payload' }, { status: 400 });

    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Expected JSON export payload', content_type: contentType }, { status: 400 });
    }

    const result = await importTheirStackJobExport(payload);
    const receipt = await saveTheirStackExportReceipt({ contentType, payload, result });

    return NextResponse.json({
      ok: true,
      receipt_id: receipt?.id || null,
      received_at: receipt?.received_at || null,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('TheirStack job export webhook failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!await authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const limit = Number(req.nextUrl.searchParams.get('limit') || 20);
    const receipts = await listTheirStackExportReceipts(limit);
    return NextResponse.json({ ok: true, receipts });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
