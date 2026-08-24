import { NextRequest, NextResponse } from 'next/server';
import { searchAlgoliaJobs } from '@/lib/search/algolia';
import { searchDatabaseEntities, searchDatabaseJobs } from '@/lib/search/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get('q') || '').trim();
    const limit = Number(searchParams.get('limit') || 40);
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 100) : 40;

    if (!q) {
      return NextResponse.json({
        configured: Boolean(process.env.ALGOLIA_APP_ID && (process.env.ALGOLIA_SEARCH_API_KEY || process.env.ALGOLIA_WRITE_API_KEY)),
        hits: [],
        entities: [],
        nbHits: 0,
        query: '',
        engine: 'idle',
      });
    }

    const entitiesPromise = searchDatabaseEntities(q, 12).catch(() => []);
    let algolia: any = null;
    let algoliaError: string | null = null;
    try {
      algolia = await searchAlgoliaJobs(q, safeLimit);
    } catch (error) {
      algoliaError = error instanceof Error ? error.message : String(error);
    }

    const entities = await entitiesPromise;
    if (Array.isArray(algolia?.hits) && algolia.hits.length > 0) {
      return NextResponse.json({ ...algolia, entities, engine: 'algolia' });
    }

    const fallback = await searchDatabaseJobs(q, safeLimit);
    return NextResponse.json({
      ...fallback,
      entities,
      configured: Boolean(algolia?.configured ?? (process.env.ALGOLIA_APP_ID && (process.env.ALGOLIA_SEARCH_API_KEY || process.env.ALGOLIA_WRITE_API_KEY))),
      engine: fallback.hits.length ? 'database_fallback' : (algolia?.warming ? 'database_fallback' : 'algolia'),
      algolia_warming: Boolean(algolia?.warming),
      algolia_error: algoliaError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
