import { query } from '@/db/client';

type Provider = {
  id: string;
  label: string;
  keyName: string;
  key: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

const ROLE_CATEGORIES = new Set(['engineering', 'security', 'aviation', 'admin', 'logistics', 'medical', 'other']);
const LOCATION_CATEGORIES = new Set(['remote', 'domestic', 'overseas', 'unknown']);
const DEFAULT_TIMEOUT_MS = clampInt(process.env.JOB_INTELLIGENCE_AI_TIMEOUT_MS, 12000, 3000, 60000);
const MAX_JOBS_PER_RUN = clampInt(process.env.JOB_TAXONOMY_AI_MAX_JOBS_PER_RUN, 60, 1, 240);
const BATCH_SIZE = clampInt(process.env.JOB_TAXONOMY_AI_BATCH_SIZE, 12, 4, 20);
const VERSION = 'job-taxonomy-v1';

export async function buildDiscoveryAssist(entity: any) {
  const providers = configuredProviders();
  if (!providers.length) return { queries: [] as string[], provider: null as string | null, status: 'skipped' };

  const canonical = String(entity?.name || '').trim();
  if (!canonical) return { queries: [] as string[], provider: null as string | null, status: 'skipped' };
  const aliases = Array.isArray(entity?.aliases) ? entity.aliases.map((value: unknown) => String(value || '').trim()).filter(Boolean).slice(0, 6) : [];
  const careerHost = safeHost(entity?.career_page_url);
  const input = [
    `Employer: ${canonical}`,
    aliases.length ? `Known aliases: ${aliases.join(' | ')}` : '',
    careerHost ? `Official career host: ${careerHost}` : '',
    'Return JSON only: {"queries":["...","..."]}.',
    'Give at most 3 concise employer-specific web-search phrases that can find current job-detail pages.',
    'Do not invent subsidiaries, acquisitions, or unrelated companies. These phrases are search expansion only and will never be accepted as employer proof.',
  ].filter(Boolean).join('\n');

  try {
    const { value, provider } = await requestJsonWithPool(providers, {
      system: 'You create conservative search-query expansions for a hiring-intelligence crawler. Return valid JSON only.',
      user: input,
      maxTokens: 220,
    });
    const raw = Array.isArray(value?.queries) ? value.queries : [];
    const queries = Array.from(new Set(raw.map((item: unknown) => sanitizeQuery(item, canonical)).filter(Boolean) as string[])).slice(0, 3);
    return { queries, provider: provider.label, status: 'success' };
  } catch (error) {
    return { queries: [] as string[], provider: null as string | null, status: 'error', reason: errorMessage(error) };
  }
}

export async function enrichEntityJobTaxonomy(entityId: string, entityName: string) {
  const providers = configuredProviders();
  if (!providers.length) return { status: 'skipped', analyzed: 0, changed_roles: 0, location_categorized: 0, reason: 'No AI provider configured' };

  const rows = await query(
    `SELECT id, title, department, role_category, location, city, state, country, is_remote, is_overseas, raw_data
       FROM jobs
      WHERE entity_id = $1 AND is_active = true
        AND (
          COALESCE(role_category, 'other') = 'other'
          OR NULLIF(raw_data->>'job_location_category', '') IS NULL
        )
      ORDER BY COALESCE(posted_at, created_at) DESC NULLS LAST, created_at DESC
      LIMIT $2`,
    [entityId, MAX_JOBS_PER_RUN],
  );

  let analyzed = 0;
  let changedRoles = 0;
  let locationCategorized = 0;
  let failedBatches = 0;
  const providerCounts: Record<string, number> = {};

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const promptRows = batch.map((row: any, index: number) => ({
      index,
      title: String(row.title || ''),
      department: String(row.department || ''),
      current_role_category: String(row.role_category || 'other'),
      location: String(row.location || ''),
      city: String(row.city || ''),
      state: String(row.state || ''),
      country: String(row.country || ''),
      is_remote: Boolean(row.is_remote),
    }));

    try {
      const { value, provider } = await requestJsonWithPool(rotateProviders(providers, Math.floor(offset / BATCH_SIZE)), {
        system: 'You classify job postings for a hiring dashboard. Return valid JSON only. Never infer occupational-health, medical-clearance, or employee-health signals.',
        user: [
          `Employer: ${entityName}`,
          `Allowed role_category values: engineering, security, aviation, admin, logistics, medical, other.`,
          `Allowed location_category values: remote, domestic, overseas, unknown. Domestic means United States. Overseas means a known non-US work location.`,
          'Classify only from the supplied title/department/location evidence. Do not invent a city, state, country, employer, or job fact.',
          'Return exactly: {"jobs":[{"index":0,"role_category":"other","location_category":"unknown"}]}',
          JSON.stringify(promptRows),
        ].join('\n'),
        maxTokens: 1100,
      });
      providerCounts[provider.label] = (providerCounts[provider.label] || 0) + 1;
      const results = Array.isArray(value?.jobs) ? value.jobs : [];
      const byIndex = new Map<number, any>();
      for (const result of results) {
        const index = Number(result?.index);
        if (Number.isInteger(index) && index >= 0 && index < batch.length) byIndex.set(index, result);
      }

      for (let index = 0; index < batch.length; index++) {
        const row = batch[index];
        const result = byIndex.get(index) || {};
        const role = normalizeRole(result?.role_category);
        const deterministicLocation = deterministicLocationCategory(row);
        const locationCategory = deterministicLocation !== 'unknown'
          ? deterministicLocation
          : normalizeLocationCategory(result?.location_category);
        const shouldChangeRole = String(row.role_category || 'other') === 'other' && role !== 'other';
        const existingLocationCategory = String(row.raw_data?.job_location_category || '').trim();
        const shouldWriteLocation = !existingLocationCategory && locationCategory !== 'unknown';
        if (!shouldChangeRole && !shouldWriteLocation && row.raw_data?.job_taxonomy_ai_version === VERSION) continue;

        await query(
          `UPDATE jobs
              SET role_category = CASE WHEN COALESCE(role_category, 'other') = 'other' AND $2 <> 'other' THEN $2 ELSE role_category END,
                  raw_data = COALESCE(raw_data, '{}'::jsonb) || $3::jsonb,
                  updated_at = NOW()
            WHERE id = $1`,
          [row.id, role, JSON.stringify({
            job_location_category: locationCategory,
            job_taxonomy_ai_version: VERSION,
            job_taxonomy_ai_provider: provider.label,
            job_taxonomy_ai_key_slot: provider.keyName,
            job_taxonomy_ai_model: provider.model,
            job_taxonomy_ai_at: new Date().toISOString(),
          })],
        );
        analyzed++;
        if (shouldChangeRole) changedRoles++;
        if (shouldWriteLocation) locationCategorized++;
      }
    } catch (error) {
      failedBatches++;
      console.warn(`Job taxonomy AI batch failed for ${entityName}: ${errorMessage(error)}`);
    }
  }

  return {
    status: failedBatches && !analyzed ? 'error' : 'success',
    analyzed,
    changed_roles: changedRoles,
    location_categorized: locationCategorized,
    failed_batches: failedBatches,
    providers: providerCounts,
    version: VERSION,
  };
}

function configuredProviders(): Provider[] {
  const rows: Provider[] = [];
  const push = (id: string, label: string, keyName: string, key: unknown, baseUrl: string, model: string) => {
    const secret = String(key || '').trim();
    if (!secret) return;
    rows.push({ id, label, keyName, key: secret, baseUrl: baseUrl.replace(/\/$/, ''), model, timeoutMs: DEFAULT_TIMEOUT_MS });
  };

  push('groq-1', 'Groq #1', 'GROQ_API_KEY', process.env.GROQ_API_KEY,
    process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1', process.env.GROQ_MODEL || 'openai/gpt-oss-20b');
  push('groq-2', 'Groq #2', 'GROQ_API_KEY_2', process.env.GROQ_API_KEY_2,
    process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1', process.env.GROQ_MODEL || 'openai/gpt-oss-20b');
  push('cerebras', 'Cerebras', 'CEREBRAS_API_KEY', process.env.CEREBRAS_API_KEY,
    process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1', process.env.CEREBRAS_MODEL || 'gpt-oss-120b');
  push('fireworks', 'Fireworks', process.env.FIREWORKS_AI_API_KEY ? 'FIREWORKS_AI_API_KEY' : 'FIREWORKS_API_KEY', process.env.FIREWORKS_AI_API_KEY || process.env.FIREWORKS_API_KEY,
    process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1', process.env.FIREWORKS_MODEL || 'accounts/fireworks/models/deepseek-v3p1');
  push('openrouter', 'OpenRouter', process.env.OPEN_ROUTER_API_KEY ? 'OPEN_ROUTER_API_KEY' : 'OPENROUTER_API_KEY', process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', process.env.OPENROUTER_MODEL || 'openrouter/auto');
  return rows;
}

async function requestJsonWithPool(providers: Provider[], request: { system: string; user: string; maxTokens: number }) {
  const failures: string[] = [];
  for (const provider of providers) {
    try {
      return { value: await requestJson(provider, request), provider };
    } catch (error) {
      failures.push(`${provider.label}: ${errorMessage(error)}`);
    }
  }
  throw new Error(failures.join(' | ') || 'No AI provider completed the request');
}

async function requestJson(provider: Provider, request: { system: string; user: string; maxTokens: number }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${provider.key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (provider.id === 'openrouter') {
      headers['HTTP-Referer'] = process.env.NEXT_PUBLIC_APP_URL || 'https://hiring-trend-dashboard-mt68.onrender.com';
      headers['X-Title'] = 'Occu-Med Hiring Insights';
    }
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider.model,
        temperature: 0,
        max_tokens: request.maxTokens,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${String(payload?.error?.message || payload?.error?.description || 'request failed')}`);
    const text = payload?.choices?.[0]?.message?.content;
    if (!text) throw new Error('response contained no message content');
    return parseJsonObject(String(text));
  } catch (error) {
    if ((error as any)?.name === 'AbortError') throw new Error(`timeout after ${provider.timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonObject(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI response did not contain JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeRole(value: unknown) {
  const role = String(value || 'other').trim().toLowerCase();
  return ROLE_CATEGORIES.has(role) ? role : 'other';
}
function normalizeLocationCategory(value: unknown) {
  const category = String(value || 'unknown').trim().toLowerCase();
  return LOCATION_CATEGORIES.has(category) ? category : 'unknown';
}
function deterministicLocationCategory(row: any) {
  if (Boolean(row?.is_remote) || /\b(remote|virtual|work from home|wfh)\b/i.test(String(row?.location || ''))) return 'remote';
  const country = String(row?.country || '').trim().toUpperCase();
  if (country === 'US') return 'domestic';
  if (country) return 'overseas';
  return 'unknown';
}
function sanitizeQuery(value: unknown, employer: string) {
  const text = String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (text.length < 6) return null;
  const employerToken = employer.toLowerCase().split(/\s+/).filter(Boolean)[0];
  if (employerToken && !text.toLowerCase().includes(employerToken)) return `"${employer}" ${text}`;
  return text;
}
function safeHost(value: unknown) {
  try { return value ? new URL(String(value)).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
}
function rotateProviders(providers: Provider[], offset: number) {
  if (!providers.length) return providers;
  const start = offset % providers.length;
  return [...providers.slice(start), ...providers.slice(0, start)];
}
function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
