import { query } from '@/db/client';

export async function GET() {
  const startedAt = Date.now();
  const checks: Record<string, any> = {
    app: { ok: true },
    database: { ok: false },
  };

  try {
    await query('SELECT 1 AS ok');
    checks.database = { ok: true };
  } catch (error) {
    checks.database = {
      ok: false,
      error: error instanceof Error ? error.message : 'Database check failed',
    };
  }

  const ok = Object.values(checks).every((check: any) => check.ok);
  return Response.json({
    ok,
    service: 'hiring-trend-dashboard',
    checks,
    duration_ms: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  }, { status: ok ? 200 : 503 });
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}
