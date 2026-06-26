import { NextRequest, NextResponse } from 'next/server';
import { getEntityMetrics, getEntityRoleBreakdown, getEntityMapData } from '@/lib/metrics';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [metrics, roles, mapData] = await Promise.all([
      getEntityMetrics(params.id),
      getEntityRoleBreakdown(params.id),
      getEntityMapData(params.id),
    ]);
    return NextResponse.json({ metrics, roles, mapData });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
