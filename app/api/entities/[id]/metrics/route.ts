import { NextRequest, NextResponse } from 'next/server';
import { getEntityMetrics, getEntityRoleBreakdown, getEntityMapData, getEntityOccupationalHealthSignals } from '@/lib/metrics';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const [metrics, roles, mapData, occupationalHealth] = await Promise.all([
      getEntityMetrics(params.id),
      getEntityRoleBreakdown(params.id),
      getEntityMapData(params.id),
      getEntityOccupationalHealthSignals(params.id),
    ]);
    return NextResponse.json({ metrics, roles: { ...roles, __occupationalHealth: occupationalHealth }, mapData });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
