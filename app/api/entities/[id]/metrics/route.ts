import { NextRequest, NextResponse } from 'next/server';
import { getEntityMetrics, getEntityRoleBreakdown, getEntityLocationBreakdown, getEntityMapData } from '@/lib/metrics';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [metrics, roles, locations, mapData] = await Promise.all([
      getEntityMetrics(params.id),
      getEntityRoleBreakdown(params.id),
      getEntityLocationBreakdown(params.id),
      getEntityMapData(params.id),
    ]);
    return NextResponse.json({ metrics, roles, locations, mapData });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
