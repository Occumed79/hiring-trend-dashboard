function normalizeEnvName(value: string) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function resolvedRuntimeEntry(names: readonly string[]): { name: string; value: string } | null {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return { name, value };
  }

  // Render normally preserves environment names, but this normalized fallback also
  // catches equivalent hyphen/underscore spellings such as LANGSEARCH-API-KEY.
  const wanted = new Set(names.map(normalizeEnvName));
  for (const [name, raw] of Object.entries(process.env)) {
    const value = String(raw || '').trim();
    if (value && wanted.has(normalizeEnvName(name))) return { name, value };
  }
  return null;
}

export function firstRuntimeEnv(names: readonly string[]): string {
  return resolvedRuntimeEntry(names)?.value || '';
}

export function detectedRuntimeEnvName(names: readonly string[]): string | null {
  return resolvedRuntimeEntry(names)?.name || null;
}

export function hasRuntimeEnv(names: readonly string[]): boolean {
  return Boolean(firstRuntimeEnv(names));
}

export const RUNTIME_ENV = {
  keenable: ['KEENABLE_API_KEY', 'KEENABLE-API-KEY'],
  tinyfish: ['TINYFISH_API_KEY', 'TINYFISH-API-KEY'],
  langSearch: ['LANGSEARCH_API_KEY', 'LANGSEARCH-API-KEY', 'LANG_SEARCH_API_KEY'],
  langSearch2: ['LANGSEARCH_API_KEY_2', 'LANGSEARCH-API-KEY-2', 'LANG_SEARCH_API_KEY_2'],
  adzunaId1: ['ADZUNA_APP_ID', 'ADZUNA_APPID'],
  adzunaKey1: ['ADZUNA_APP_KEY', 'ADZUNA_API_KEY'],
  adzunaId2: ['ADZUNA_APP_ID_2', 'ADZUNA_APPID_2'],
  adzunaKey2: ['ADZUNA_APP_KEY_2', 'ADZUNA_API_KEY_2'],
  adzunaId3: ['ADZUNA_APP_ID_3', 'ADZUNA_APPID_3'],
  adzunaKey3: ['ADZUNA_APP_KEY_3', 'ADZUNA_API_KEY_3'],
  geoapify: ['GEOAPIFY_API_KEY'],
  groq1: ['GROQ_API_KEY'],
  groq2: ['GROQ_API_KEY_2'],
  groq: ['GROQ_API_KEY', 'GROQ_API_KEY_2'],
  cerebras: ['CEREBRAS_API_KEY'],
  fireworks: ['FIREWORKS_AI_API_KEY', 'FIREWORKS_API_KEY'],
  openRouter: ['OPEN_ROUTER_API_KEY', 'OPENROUTER_API_KEY'],
  algoliaAppId: ['ALGOLIA_APP_ID', 'ALGOLIA_APPLICATION_ID'],
  algoliaSearchKey: ['ALGOLIA_SEARCH_API_KEY', 'ALGOLIA_API_KEY'],
  algoliaWriteKey: ['ALGOLIA_WRITE_API_KEY', 'ALGOLIA_API_KEY'],
  careerOneStopToken: ['CAREERONESTOP_API_TOKEN'],
  careerOneStopUser: ['CAREERONESTOP_USER_ID'],
  // Dormant direct-NLx connector compatibility. CareerOneStop is the visible
  // resilience path and direct NLX is not surfaced as a required integration.
  nlx: ['NLX_API_KEY'],
} as const;
