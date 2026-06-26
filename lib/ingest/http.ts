const DEFAULT_TIMEOUT_MS = 10000;

export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const res = await fetchWithTimeout(url, {
    ...init,
    headers: mergeHeaders({ accept: 'application/json' }, init.headers),
  }, timeoutMs);

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchText(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const res = await fetchWithTimeout(url, {
    ...init,
    headers: mergeHeaders({ accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' }, init.headers),
  }, timeoutMs);

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as any)?.name === 'AbortError') {
      throw new Error(`timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function getIngestTimeout(defaultMs = DEFAULT_TIMEOUT_MS) {
  const parsed = Number(process.env.INGEST_HTTP_TIMEOUT_MS || defaultMs);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : defaultMs;
}

export const INGEST_USER_AGENT = 'OccuMedHiringTrendDashboard/1.0 (+https://github.com/Occumed79/hiring-trend-dashboard)';

function mergeHeaders(defaults: Record<string, string>, provided?: HeadersInit) {
  const headers = new Headers(defaults);
  if (provided) {
    new Headers(provided).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}
