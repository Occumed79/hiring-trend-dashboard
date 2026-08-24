import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';
import { monitorsForEntityLive } from '@/lib/ingest/theirStackMonitors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const APP_URL_ENDPOINT = 'https://api.theirstack.com/v0/app-urls';
const TIMEOUT_MS = clamp(integerEnv('THEIRSTACK_TIMEOUT_MS', 15000), 1000, 60000);
const LOOKBACK_DAYS = clamp(integerEnv('THEIRSTACK_COMPANY_SWEEP_LOOKBACK_DAYS', 30), 1, 90);

export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const rows = await query(`SELECT id, name, aliases FROM entities WHERE id=$1 AND is_active=true LIMIT 1`, [params.id]);
    const entity = rows[0];
    if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

    const monitors = await monitorsForEntityLive(entity);
    const configured = monitors.filter(monitor => Boolean(String(process.env[monitor.envKey] || '').trim()));
    if (!configured.length) {
      return NextResponse.json({ error: 'This entity has no configured TheirStack monitor workspace.' }, { status: 409 });
    }

    const receiverSecret = String(process.env.THEIRSTACK_EXPORT_WEBHOOK_SECRET || '').trim();
    const appBase = String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim().replace(/\/$/, '');
    if (!receiverSecret || !appBase) {
      return NextResponse.json({
        error: !receiverSecret
          ? 'THEIRSTACK_EXPORT_WEBHOOK_SECRET is not configured on the web service.'
          : 'NEXT_PUBLIC_APP_URL or APP_URL is required to build the export receiver URL.',
      }, { status: 503 });
    }

    const monitor = configured[0];
    const apiKey = String(process.env[monitor.envKey] || '').trim();
    const filters = {
      company_name_case_insensitive_or: [monitor.name],
      posted_at_max_age_days: LOOKBACK_DAYS,
      is_closed: false,
      include_total_results: true,
      limit: 25,
      page: 0,
    };
    const payload = await postJson(APP_URL_ENDPOINT, apiKey, { type: 'job_search', filters });
    const theirStackUrl = clean(payload?.url);
    if (!theirStackUrl) throw new Error('TheirStack did not return an app URL.');

    const receiver = new URL(`${appBase}/api/ingest/theirstack/export`);
    receiver.searchParams.set('token', receiverSecret);

    return NextResponse.json({
      status: 'ready',
      entity_id: entity.id,
      entity_name: entity.name,
      monitored_name: monitor.name,
      workspace: monitor.envKey,
      monitor_source: monitor.source || 'config_fallback',
      monitor_list_id: monitor.listId || null,
      monitor_list_name: monitor.listName || null,
      lookback_days: LOOKBACK_DAYS,
      app_url: theirStackUrl,
      receiver_url: receiver.toString(),
      export_cap_per_company: 200,
      handoff: 'Open the generated TheirStack Job Search, choose Export → Webhook, and paste the receiver URL that Hiring Insights copied for you.',
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not prepare TheirStack export.' }, { status: 500 });
  }
}

async function postJson(url: string, apiKey: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.description || payload?.error?.title || `TheirStack App URL HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if ((error as any)?.name === 'AbortError') throw new Error(`TheirStack App URL timeout after ${TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function clean(value: unknown) { const text = String(value || '').trim(); return text || null; }
function integerEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isInteger(value) && value > 0 ? value : fallback; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
