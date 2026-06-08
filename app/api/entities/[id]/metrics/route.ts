import { NextRequest, NextResponse } from 'next/server';
import { getEntityMetrics, getEntityRoleBreakdown, getEntityMapData } from '@/lib/metrics';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const [metrics, roles, mapData] = await Promise.all([
    getEntityMetrics(params.id),
    getEntityRoleBreakdown(params.id),
    getEntityMapData(params.id),
  ]);
  return NextResponse.json({ metrics, roles, mapData });
}
