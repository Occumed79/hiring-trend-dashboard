import { createHash } from 'crypto';
import { query } from '@/db/client';

type Provider = {
  id: string;
  label: string;
  key: string;
  keyName: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

export type OccupationalHealthEnrichment = {
  safety_sensitive: boolean;
  physical_demand: 'low' | 'moderate' | 'high' | 'unknown';
  likely_preplacement_exam: boolean;
  likely_drug_testing: boolean;
  likely_hearing_conservation: boolean;
  likely_respirator_use: boolean;
  likely_medical_surveillance: boolean;
  deployment_oconus: boolean;
  dot_cdl: boolean;
  hazardous_exposure: boolean;
  clearance_security: boolean;
  opportunity_score: number;
  reason: string;
};

const VERSION = 'occ-health-v2-multiprovider';
const MAX_JOBS_PER_RUN = clamp(integerEnv('OCC_HEALTH_AI_MAX_JOBS_PER_RUN', 12), 1, 100);
const DEFAULT_TIMEOUT_MS = clamp(integerEnv('OCC_HEALTH_AI_TIMEOUT_MS', 15000), 3000, 60000);

export async function enrichEntityOccupationalHealth(entityId: string, entityName: string) {
  const providers = configuredProviders();
  if (!providers.length) {
    return {
      status: 'skipped', enriched: 0, cached: 0, failed: 0, pending: 0,
      reason: 'No occupational-health AI provider credential is configured',
      providers: {},
    };
  }

  const rows = await query(
    `SELECT id, title, department, role_category, location, city, state, country, source, raw_data
       FROM jobs
      WHERE entity_id = $1 AND is_active = true
      ORDER BY COALESCE(posted_at, created_at) DESC NULLS LAST, created_at DESC
      LIMIT 1000`,
    [entityId],
  );

  let cached = 0;
  let enriched = 0;
  let failed = 0;
  let attempted = 0;
  const providerCounts: Record<string, number> = {};
  const circuitOpen = new Map<string, string>();
  const candidates: Array<{ row: any; hash: string; input: string }> = [];

  for (const row of rows) {
    const input = buildJobInput(entityName, row);
    const hash = hashInput(input);
    if (row.raw_data?.occupational_health_ai_hash === hash && row.raw_data?.occupational_health_ai) {
      cached++;
      continue;
    }
    // Existing Clarifai/Groq-era enrichment remains valid historical analysis.
    // Do not spend credits re-analyzing it until the posting itself is refreshed.
    if (row.raw_data?.clarifai_oh && !row.raw_data?.occupational_health_ai) {
      cached++;
      continue;
    }
    candidates.push({ row, hash, input });
  }

  for (const candidate of candidates.slice(0, MAX_JOBS_PER_RUN)) {
    attempted++;
    try {
      const analysis = await analyzeWithProviderPool(providers, candidate.input, circuitOpen);
      const now = new Date().toISOString();
      await query(
        `UPDATE jobs
            SET raw_data = COALESCE(raw_data, '{}'::jsonb) || $2::jsonb
          WHERE id = $1`,
        [candidate.row.id, JSON.stringify({
          occupational_health_ai: analysis.result,
          occupational_health_ai_hash: candidate.hash,
          occupational_health_ai_version: VERSION,
          occupational_health_ai_provider: analysis.provider.label,
          occupational_health_ai_provider_id: analysis.provider.id,
          occupational_health_ai_key_slot: analysis.provider.keyName,
          occupational_health_ai_model: analysis.provider.model,
          occupational_health_ai_enriched_at: now,
          // Backward-compatible aliases keep existing metrics/search consumers alive
          // while they migrate off the old Clarifai-specific storage key.
          clarifai_oh: analysis.result,
          clarifai_oh_hash: candidate.hash,
          clarifai_oh_version: VERSION,
          clarifai_oh_provider: analysis.provider.label,
          clarifai_oh_model: analysis.provider.model,
          clarifai_oh_enriched_at: now,
        })],
      );
      providerCounts[analysis.provider.label] = (providerCounts[analysis.provider.label] || 0) + 1;
      enriched++;
    } catch (error) {
      failed++;
      console.warn(`OH enrichment failed for ${entityName} / ${candidate.row.title}:`, errorMessage(error));
    }
  }

  return {
    status: failed && !enriched ? 'error' : 'success',
    enriched,
    cached,
    failed,
    pending: Math.max(0, candidates.length - attempted),
    providers: providerCounts,
    configured_providers: providers.map(provider => ({ label: provider.label, key_name: provider.keyName, model: provider.model })),
    unavailable_providers: Object.fromEntries(circuitOpen),
    version: VERSION,
  };
}

function configuredProviders(): Provider[] {
  const rows: Provider[] = [];
  const push = (id: string, label: string, keyName: string, key: unknown, baseUrl: string, model: string, timeoutMs: number) => {
    const secret = String(key || '').trim();
    if (secret) rows.push({ id, label, keyName, key: secret, baseUrl: baseUrl.replace(/\/$/, ''), model, timeoutMs });
  };

  push('groq-1', 'Groq #1', 'GROQ_API_KEY', process.env.GROQ_API_KEY,
    process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1', process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
    clamp(integerEnv('GROQ_TIMEOUT_MS', DEFAULT_TIMEOUT_MS), 3000, 60000));
  push('groq-2', 'Groq #2', 'GROQ_API_KEY_2', process.env.GROQ_API_KEY_2,
    process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1', process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
    clamp(integerEnv('GROQ_TIMEOUT_MS', DEFAULT_TIMEOUT_MS), 3000, 60000));
  push('cerebras', 'Cerebras', 'CEREBRAS_API_KEY', process.env.CEREBRAS_API_KEY,
    process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1', process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
    clamp(integerEnv('CEREBRAS_TIMEOUT_MS', DEFAULT_TIMEOUT_MS), 3000, 60000));
  push('fireworks', 'Fireworks', process.env.FIREWORKS_AI_API_KEY ? 'FIREWORKS_AI_API_KEY' : 'FIREWORKS_API_KEY', process.env.FIREWORKS_AI_API_KEY || process.env.FIREWORKS_API_KEY,
    process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1', process.env.FIREWORKS_MODEL || 'accounts/fireworks/models/deepseek-v3p1',
    clamp(integerEnv('FIREWORKS_TIMEOUT_MS', DEFAULT_TIMEOUT_MS), 3000, 60000));
  push('openrouter', 'OpenRouter', process.env.OPEN_ROUTER_API_KEY ? 'OPEN_ROUTER_API_KEY' : 'OPENROUTER_API_KEY', process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', process.env.OPENROUTER_MODEL || 'openrouter/auto',
    clamp(integerEnv('OPENROUTER_TIMEOUT_MS', DEFAULT_TIMEOUT_MS), 3000, 60000));

  return rows;
}

async function analyzeWithProviderPool(providers: Provider[], input: string, circuitOpen: Map<string, string>) {
  const errors: string[] = [];
  for (const provider of providers) {
    if (circuitOpen.has(provider.id)) continue;
    try {
      const result = await analyzeJob(provider, input);
      return { result, provider };
    } catch (error) {
      const reason = errorMessage(error);
      errors.push(`${provider.label}: ${reason}`);
      if (isProviderAvailabilityError(error)) circuitOpen.set(provider.id, reason);
    }
  }
  throw new Error(errors.length ? errors.join(' | ') : 'All configured OH AI providers are unavailable for this run');
}

async function analyzeJob(provider: Provider, input: string): Promise<OccupationalHealthEnrichment> {
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
        max_tokens: 700,
        messages: [
          { role: 'system', content: 'You are an occupational-health demand analyst. Infer only plausible job-related occupational-health service signals from supplied posting evidence. Do not diagnose people. Return one JSON object only with no markdown.' },
          { role: 'user', content: `${input}\n\nReturn exactly these keys: safety_sensitive (boolean), physical_demand (low|moderate|high|unknown), likely_preplacement_exam (boolean), likely_drug_testing (boolean), likely_hearing_conservation (boolean), likely_respirator_use (boolean), likely_medical_surveillance (boolean), deployment_oconus (boolean), dot_cdl (boolean), hazardous_exposure (boolean), clearance_security (boolean), opportunity_score (integer 0-100), reason (one concise sentence). Base the score on likely demand for occupational-health services, not general hiring importance.` },
        ],
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.error?.message || payload?.error?.description || `HTTP ${response.status}`;
      throw new Error(`HTTP ${response.status}: ${String(detail)}`);
    }
    const text = payload?.choices?.[0]?.message?.content;
    if (!text) throw new Error('response contained no message content');
    return normalizeResult(parseJsonObject(String(text), provider.label));
  } catch (error) {
    if ((error as any)?.name === 'AbortError') throw new Error(`timeout after ${provider.timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildJobInput(entityName: string, row: any) {
  const raw = row.raw_data || {};
  const description = firstText(raw, ['description', 'job_description', 'description_text', 'content', 'snippet', 'summary', 'qualifications', 'responsibilities', 'job_text', 'body', 'details']);
  return [
    `Employer: ${entityName}`,
    `Title: ${row.title || ''}`,
    `Existing role category: ${row.role_category || 'other'}`,
    `Department: ${row.department || ''}`,
    `Location: ${[row.location, row.city, row.state, row.country].filter(Boolean).join(' | ')}`,
    `Source: ${row.source || ''}`,
    description ? `Posting evidence: ${description.slice(0, 7000)}` : 'Posting evidence: title/location metadata only; keep uncertain signals conservative.',
  ].join('\n');
}

function firstText(raw: any, keys: string[]) {
  for (const key of keys) {
    const value = raw?.[key];
    if (typeof value === 'string' && value.trim()) return value.replace(/\s+/g, ' ').trim();
    if (Array.isArray(value) && value.length) {
      const joined = value.filter(item => typeof item === 'string').join(' ');
      if (joined.trim()) return joined.replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

function hashInput(input: string) { return createHash('sha256').update(`${VERSION}\n${input}`).digest('hex'); }
function parseJsonObject(text: string, provider: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`${provider} response did not contain JSON`);
  return JSON.parse(cleaned.slice(start, end + 1));
}
function normalizeResult(value: any): OccupationalHealthEnrichment {
  const physical = String(value?.physical_demand || 'unknown').toLowerCase();
  return {
    safety_sensitive: Boolean(value?.safety_sensitive),
    physical_demand: ['low', 'moderate', 'high'].includes(physical) ? physical as any : 'unknown',
    likely_preplacement_exam: Boolean(value?.likely_preplacement_exam),
    likely_drug_testing: Boolean(value?.likely_drug_testing),
    likely_hearing_conservation: Boolean(value?.likely_hearing_conservation),
    likely_respirator_use: Boolean(value?.likely_respirator_use),
    likely_medical_surveillance: Boolean(value?.likely_medical_surveillance),
    deployment_oconus: Boolean(value?.deployment_oconus),
    dot_cdl: Boolean(value?.dot_cdl),
    hazardous_exposure: Boolean(value?.hazardous_exposure),
    clearance_security: Boolean(value?.clearance_security),
    opportunity_score: clamp(Math.round(Number(value?.opportunity_score) || 0), 0, 100),
    reason: String(value?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 400),
  };
}
function isProviderAvailabilityError(error: unknown) {
  const value = errorMessage(error).toLowerCase();
  return /http (401|403|408|429|5\d\d)/.test(value) || /timeout|fetch failed|network|econn|enotfound|socket|temporarily unavailable|quota/.test(value);
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function integerEnv(name: string, fallback: number) { const parsed = Number(process.env[name]); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
