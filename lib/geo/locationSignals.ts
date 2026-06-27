const LOCATION_KEY_PATTERN = /(location|loc|city|state|province|region|country|address|workplace|work_location|job_location|formattedlocation)/i;
const URL_LOCATION_HINT_PATTERN = /(remote|kuwait|qatar|bahrain|iraq|germany|washington|mclean|reston|herndon|arlington|chantilly|norfolk|fort worth|dallas|houston|san antonio|colorado springs|huntsville|orlando|tampa|jacksonville|atlanta|charleston|raleigh|san diego|los angeles|seattle|chicago|new york)/i;

export function extractLocationCandidates(row: any): string[] {
  const candidates: string[] = [];

  add(candidates, row?.location);
  add(candidates, joinParts(row?.city, row?.state, row?.country));
  add(candidates, joinParts(row?.city, row?.state));
  add(candidates, row?.state);
  add(candidates, row?.country);

  const raw = row?.raw_data;
  if (raw && typeof raw === 'object') {
    scanObjectForLocations(raw, candidates, 0);
    addUrlHints(raw, candidates);
  }

  return dedupe(candidates)
    .map(cleanCandidate)
    .filter((value) => value.length >= 2)
    .slice(0, 40);
}

function scanObjectForLocations(value: unknown, candidates: string[], depth: number) {
  if (!value || depth > 5) return;

  if (typeof value === 'string') {
    if (looksLikeLocation(value)) add(candidates, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 25)) scanObjectForLocations(item, candidates, depth + 1);
    return;
  }

  if (typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;

  const city = pickString(obj, ['city', 'cityName', 'job_city', 'locationCity', 'formattedWorkLocationCity']);
  const state = pickString(obj, ['state', 'stateCode', 'province', 'region', 'job_state', 'locationState', 'formattedWorkLocationState']);
  const country = pickString(obj, ['country', 'countryCode', 'job_country', 'locationCountry', 'formattedWorkLocationCountry']);
  add(candidates, joinParts(city, state, country));
  add(candidates, joinParts(city, state));

  for (const [key, nested] of Object.entries(obj)) {
    if (LOCATION_KEY_PATTERN.test(key)) {
      if (typeof nested === 'string' || typeof nested === 'number') add(candidates, String(nested));
      else scanObjectForLocations(nested, candidates, depth + 1);
    } else if (depth < 2 && isSmallObject(nested)) {
      scanObjectForLocations(nested, candidates, depth + 1);
    }
  }
}

function addUrlHints(raw: Record<string, unknown>, candidates: string[]) {
  const urls = [
    raw.url,
    raw.normalized_apply_url,
    raw.job_apply_link,
    raw.job_url,
    raw.posting_url,
    raw.careerPageUrl,
  ];

  for (const url of urls) {
    if (typeof url !== 'string') continue;
    const decoded = safeDecode(url).toLowerCase().replace(/[+_%/-]+/g, ' ');
    const match = decoded.match(URL_LOCATION_HINT_PATTERN);
    if (match?.[0]) add(candidates, match[0]);
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function looksLikeLocation(value: string) {
  const text = value.trim();
  if (!text || text.length > 140) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (/\b(remote|hybrid|onsite|united states|usa|kuwait|qatar|bahrain|iraq|germany)\b/i.test(text)) return true;
  if (/\b[A-Z][a-zA-Z .'-]+,\s*[A-Z]{2}\b/.test(text)) return true;
  return false;
}

function isSmallObject(value: unknown) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length <= 20;
}

function joinParts(...parts: unknown[]) {
  return parts.map((part) => typeof part === 'string' ? part.trim() : '').filter(Boolean).join(', ') || null;
}

function add(candidates: string[], value: unknown) {
  if (typeof value !== 'string') return;
  const cleaned = cleanCandidate(value);
  if (cleaned) candidates.push(cleaned);
}

function cleanCandidate(value: string) {
  return value.replace(/\s+/g, ' ').replace(/^[-–—,\s]+|[-–—,\s]+$/g, '').trim();
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
