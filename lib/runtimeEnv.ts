export function firstRuntimeEnv(names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

export function hasRuntimeEnv(names: string[]): boolean {
  return Boolean(firstRuntimeEnv(names));
}

export const RUNTIME_ENV = {
  keenable: ['KEENABLE_API_KEY', 'KEENABLE-API-KEY'],
  langSearch: ['LANGSEARCH_API_KEY', 'LANGSEARCH-API-KEY', 'LANG_SEARCH_API_KEY'],
  langSearch2: ['LANGSEARCH_API_KEY_2', 'LANGSEARCH-API-KEY-2', 'LANG_SEARCH_API_KEY_2'],
  clarifai: ['CLARIFAI_PAT', 'CLARIFAI_API_KEY'],
  groq: ['GROQ_API_KEY', 'GROQ_API_KEY_2'],
  algoliaAppId: ['ALGOLIA_APP_ID', 'ALGOLIA_APPLICATION_ID'],
  algoliaSearchKey: ['ALGOLIA_SEARCH_API_KEY', 'ALGOLIA_API_KEY'],
  algoliaWriteKey: ['ALGOLIA_WRITE_API_KEY', 'ALGOLIA_API_KEY'],
  nlx: ['NLX_API_KEY'],
  careerOneStopToken: ['CAREERONESTOP_API_TOKEN'],
  careerOneStopUser: ['CAREERONESTOP_USER_ID'],
} as const;
