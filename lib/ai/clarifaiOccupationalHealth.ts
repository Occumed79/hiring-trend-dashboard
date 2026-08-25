import { createHash } from 'crypto';
import { query } from '@/db/client';

const CLARIFAI_BASE_URL = (process.env.CLARIFAI_BASE_URL || 'https://api.clarifai.com/v2/ext/openai/v1').replace(/\/$/, '');
const CLARIFAI_MODEL = process.env.CLARIFAI_MODEL_URL || 'https://clarifai.com/qwen/qwenLM/models/Qwen3-30B-A3B-Instruct-2507';
const GROQ_BASE_URL = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const MAX_JOBS_PER_RUN = clamp(integerEnv('CLARIFAI_MAX_JOBS_PER_RUN', 12), 1, 100);
const GROQ_MAX_FALLBACKS_PER_RUN = clamp(integerEnv('GROQ_MAX_FALLBACKS_PER_RUN', 6), 1, 100);
const CLARIFAI_TIMEOUT_MS = clamp(integerEnv('CLARIFAI_TIMEOUT_MS', 20000), 3000, 60000);
const GROQ_TIMEOUT_MS = clamp(integerEnv('GROQ_TIMEOUT_MS', 15000), 3000, 60000);
const VERSION = 'occ-health-v1';

type ProviderName = 'clarifai' | 'groq';

type ProviderState = {
  clarifaiCircuitOpen: boolean;
  groqAttempts: number;
  lastClarifaiError?: string;
};

type ProviderAnalysis = {
  result: OccupationalHealthEnrichment;
  provider: ProviderName;
  model: string;
  fallbackReason?: string;
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

export async function enrichEntityOccupationalHealth(entityId: string, entityName: string) {
  const clarifaiPat = String(process.env.CLARIFAI_PAT || process.env.CLARIFAI_API_KEY || '').trim();
  const groqApiKey = String(process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_2 || '').trim();
  if (!clarifaiPat && !groqApiKey) {
    return {
      status: 'skipped',
      enriched: 0,
      cached: 0,
      failed: 0,
      reason: 'Clarifai and Groq credentials missing',
      providers: { clarifai: 0, groq: 0 },
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
  const providers = { clarifai: 0, groq: 0 };
  const state: ProviderState = {
    clarifaiCircuitOpen: !clarifaiPat,
    groqAttempts: 0,
    lastClarifaiError: clarifaiPat ? undefined : 'Clarifai credential missing',
  };
  const candidates: Array<{ row: any; hash: string; input: string }> = [];

  for (const row of rows) {
    const input = buildJobInput(entityName, row);
    const hash = hashInput(input);
    if (row.raw_data?.clarifai_oh_hash === hash && row.raw_data?.clarifai_oh_version === VERSION && row.raw_data?.clarifai_oh) {
      cached++;
      continue;
    }
    candidates.push({ row, hash, input });
  }

  const runLimit = !clarifaiPat && groqApiKey
    ? Math.min(MAX_JOBS_PER_RUN, GROQ_MAX_FALLBACKS_PER_RUN)
    : MAX_JOBS_PER_RUN;

  for (const candidate of candidates.slice(0, runLimit)) {
    if (state.clarifaiCircuitOpen && state.groqAttempts >= GROQ_MAX_FALLBACKS_PER_RUN) break;

    attempted++;
    try {
      const analysis = await analyzeJobWithFallback(clarifaiPat, groqApiKey, candidate.input, state);
      await query(
        `UPDATE jobs
         SET raw_data = COALESCE(raw_data, '{}'::jsonb) || $2::jsonb
         WHERE id = $1`,
        [candidate.row.id, JSON.stringify({
          clarifai_oh: analysis.result,
          clarifai_oh_hash: candidate.hash,
          clarifai_oh_version: VERSION,
          clarifai_oh_provider: analysis.provider,
          clarifai_oh_model: analysis.model,
          clarifai_oh_fallback_reason: analysis.fallbackReason || null,
          clarifai_oh_enriched_at: new Date().toISOString(),
          occupational_health_ai_provider: analysis.provider,
          occupational_health_ai_model: analysis.model,
        })],
      );
      providers[analysis.provider]++;
      enriched++;
    } catch (error) {
      failed++;
      console.warn(`OH enrichment failed for ${entityName} / ${candidate.row.title}:`, error instanceof Error ? error.message : error);
    }
  }

  return {
    status: failed && !enriched ? 'error' : 'success',
    enriched,
    cached,
    failed,
    pending: Math.max(0, candidates.length - attempted),
    providers,
    primary: 'clarifai',
    fallback: 'groq',
    clarifai_circuit_open: state.clarifaiCircuitOpen,
    clarifai_error: state.lastClarifaiError || null,
    groq_fallback_attempts: state.groqAttempts,
    model: CLARIFAI_MODEL,
    fallback_model: GROQ_MODEL,
  };
}

async function analyzeJobWithFallback(
  clarifaiPat: string,
  groqApiKey: string,
  input: string,
  state: ProviderState,
): Promise<ProviderAnalysis> {
  let clarifaiError: string | undefined;

  if (clarifaiPat && !state.clarifaiCircuitOpen) {
    try {
      const result = await analyzeJob('clarifai', clarifaiPat, input);
      return { result, provider: 'clarifai', model: CLARIFAI_MODEL };
    } catch (error) {
      clarifaiError = errorMessage(error);
      state.lastClarifaiError = clarifaiError;
      if (isProviderAvailabilityError(error)) state.clarifaiCircuitOpen = true;
    }
  } else {
    clarifaiError = state.lastClarifaiError || 'Clarifai unavailable';
  }

  if (groqApiKey && state.groqAttempts < GROQ_MAX_FALLBACKS_PER_RUN) {
    state.groqAttempts++;
    try {
      const result = await analyzeJob('groq', groqApiKey, input);
      return { result, provider: 'groq', model: GROQ_MODEL, fallbackReason: clarifaiError || 'Clarifai unavailable' };
    } catch (error) {
      const groqError = errorMessage(error);
      throw new Error(`Clarifai failed (${clarifaiError || 'unavailable'}); Groq fallback failed (${groqError})`);
    }
  }

  throw new Error(`Clarifai failed (${clarifaiError || 'unavailable'}); ` + (groqApiKey ? 'Groq fallback budget exhausted for this run' : 'Groq credential missing'));
}

async function analyzeJob(provider: ProviderName, apiKey: string, input: string): Promise<OccupationalHealthEnrichment> {
  const baseUrl = provider === 'clarifai' ? CLARIFAI_BASE_URL : GROQ_BASE_URL;
  const model = provider === 'clarifai' ? CLARIFAI_MODEL : GROQ_MODEL;
  const timeoutMs = provider === 'clarifai' ? CLARIFAI_TIMEOUT_MS : GROQ_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: provider === 'clarifai' ? `Key ${apiKey}` : `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 700,
        messages: [
          { role: 'system', content: 'You are an occupational-health demand analyst. Infer only plausible job-related occupational-health service signals from the supplied posting evidence. Do not diagnose people. Return one JSON object only, with no markdown.' },
          { role: 'user', content: `${input}\n\nReturn exactly these keys: safety_sensitive (boolean), physical_demand (low|moderate|high|unknown), likely_preplacement_exam (boolean), likely_drug_testing (boolean), likely_hearing_conservation (boolean), likely_respirator_use (boolean), likely_medical_surveillance (boolean), deployment_oconus (boolean), dot_cdl (boolean), hazardous_exposure (boolean), clearance_security (boolean), opportunity_score (integer 0-100), reason (one concise sentence). Base the score on likely demand for occupational-health services, not general hiring importance.` },
        ],
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message || payload?.error?.description || `HTTP ${response.status}`;
      throw new Error(`${provider} HTTP ${response.status}: ${String(message)}`);
    }
    const text = payload?.choices?.[0]?.message?.content;
    if (!text) throw new Error(`${provider} returned no message content`);
    return normalizeResult(parseJsonObject(String(text), provider));
  } catch (error) {
    if ((error as any)?.name === 'AbortError') throw new Error(`${provider} timeout after ${timeoutMs}ms`);
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

function hashInput(input: string) {
  return createHash('sha256').update(`${VERSION}\n${CLARIFAI_MODEL}\n${input}`).digest('hex');
}

function parseJsonObject(text: string, provider: ProviderName) {
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
  const message = errorMessage(error).toLowerCase();
  return /http (401|403|408|429|5\d\d)/.test(message) || /timeout|fetch failed|network|econn|enotfound|socket|temporarily unavailable/.test(message);
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function integerEnv(name: string, fallback: number) { const parsed = Number(process.env[name]); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
