import { NextResponse } from 'next/server';
import { firstRuntimeEnv } from '@/lib/runtimeEnv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const apiKey = firstRuntimeEnv([
    'NEXT_PUBLIC_MAPTILER_API_KEY',
    'MAPTILER_API_KEY',
    'MAPTILER_KEY',
    'MAPTILER_API_TOKEN',
    'MAPTILER-API-KEY',
  ]);

  return NextResponse.json({
    provider: apiKey ? 'maptiler' : 'fallback',
    maptiler_key: apiKey || null,
    default_style: 'dataviz-dark',
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
