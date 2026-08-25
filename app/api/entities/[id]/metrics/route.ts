import { NextRequest, NextResponse } from 'next/server';
import { getEntityMetrics, getEntityRoleBreakdown, getEntityCountryBreakdown, getEntityMapData } from '@/lib/metrics';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [metrics, roles, countries, mapData] = await Promise.all([
      getEntityMetrics(params.id),
      getEntityRoleBreakdown(params.id),
      getEntityCountryBreakdown(params.id),
      getEntityMapData(params.id),
    ]);
    return NextResponse.json({ metrics, roles: { ...roles, __countries: countries }, countries, mapData });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
