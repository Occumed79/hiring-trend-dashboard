import { NextRequest, NextResponse } from 'next/server';
import { searchAlgoliaJobs } from '@/lib/search/algolia';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get('q') || '').trim();
    const limit = Number(searchParams.get('limit') || 40);

    if (!q) {
      return NextResponse.json({ configured: Boolean(process.env.ALGOLIA_APP_ID && (process.env.ALGOLIA_SEARCH_API_KEY || process.env.ALGOLIA_WRITE_API_KEY)), hits: [], nbHits: 0, query: '' });
    }

    const result = await searchAlgoliaJobs(q, Number.isFinite(limit) ? limit : 40);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
