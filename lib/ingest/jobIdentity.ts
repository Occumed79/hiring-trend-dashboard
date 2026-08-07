const SOURCE_PRIORITY: Record<string, number> = {
  greenhouse: 100,
  lever: 100,
  smartrecruiters: 100,
  bamboohr: 100,
  usajobs: 95,
  career_page: 90,
  adzuna: 70,
  'web:langsearch': 45,
};

const TRACKING_PARAMS = new Set([
  'gh_src',
  'source',
  'src',
  'trackingid',
  'trk',
  'referrer',
  'referral',
  'lever-origin',
  'lever-source',
]);

export function normalizeApplyUrl(item: any): string | null {
  const raw = item?.raw_data && typeof item.raw_data === 'object' ? item.raw_data : {};
  const candidates = [
    item?.normalized_apply_url,
    item?.apply_url,
    item?.applyUrl,
    item?.url,
    item?.job_url,
    item?.job_apply_link,
    raw.normalized_apply_url,
    raw.absolute_url,
    raw.hostedUrl,
    raw.applyUrl,
    raw.apply_url,
    raw.url,
    raw.jobUrl,
    raw.job_url,
    raw.job_apply_link,
    raw.PositionURI,
    raw.positionURI,
    raw.canonicalPositionUrl,
    raw.ref,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (normalized) return normalized;
  }

  return null;
}

export function dedupeJobsAcrossSources(items: any[]) {
  const byIdentity = new Map<string, any>();
  let duplicates = 0;

  for (const item of items) {
    if (!item) continue;
    const applyUrl = normalizeApplyUrl(item);
    const source = String(item.source || '').trim().toLowerCase();
    const externalId = String(item.external_id || '').trim().toLowerCase();
    const identity = applyUrl
      ? `url:${applyUrl.toLowerCase()}`
      : source && externalId
        ? `source:${source}:${externalId}`
        : `row:${byIdentity.size}:${String(item.title || '').toLowerCase()}`;

    const normalizedItem = withNormalizedUrl(item, applyUrl);
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, normalizedItem);
      continue;
    }

    duplicates++;
    byIdentity.set(identity, mergeDuplicateJobs(existing, normalizedItem));
  }

  return { jobs: Array.from(byIdentity.values()), duplicates };
}

export function filterWebSearchJobsForEntity(items: any[], entity: any) {
  return filterByEmployerEvidence(items, entity, (source) => source === 'web:langsearch');
}

export function filterJobApiJobsForEntity(items: any[], entity: any) {
  return filterByEmployerEvidence(items, entity, (source) => source.startsWith('jobapi:'));
}

function filterByEmployerEvidence(items: any[], entity: any, shouldFilter: (source: string) => boolean) {
  const jobs: any[] = [];
  let rejected = 0;

  for (const item of items) {
    const source = String(item?.source || '').trim().toLowerCase();
    if (!shouldFilter(source)) {
      jobs.push(item);
      continue;
    }

    const evidence = getEmployerEvidence(item, entity);
    if (!evidence) {
      rejected++;
      continue;
    }

    jobs.push({
      ...item,
      raw_data: {
        ...(item.raw_data || {}),
        normalized_employer: entity?.name || item.raw_data?.normalized_employer || null,
        normalized_employer_match: evidence,
      },
    });
  }

  return { jobs, rejected };
}

function getEmployerEvidence(item: any, entity: any): string | null {
  const applyUrl = normalizeApplyUrl(item);
  const candidateUrl = parseUrl(applyUrl);
  const careerUrl = parseUrl(entity?.career_page_url);

  if (candidateUrl && careerUrl && sameSite(candidateUrl.hostname, careerUrl.hostname)) {
    return 'career-domain';
  }

  const boardId = normalizeComparable(entity?.ats_board_id);
  if (candidateUrl && boardId.length >= 3) {
    const urlText = normalizeComparable(`${candidateUrl.hostname} ${candidateUrl.pathname} ${candidateUrl.search}`);
    if (containsPhrase(urlText, boardId)) return 'ats-board-id';
  }

  const raw = item?.raw_data || {};
  const searchable = normalizeComparable([
    item?.title,
    item?.department,
    raw.langsearch_title,
    raw.langsearch_snippet,
    raw.langsearch_summary,
    raw.employer_name,
    raw.company_name,
    raw.company,
    raw.hiring_company,
    raw.organization,
    raw.job_publisher,
    raw.normalized_apply_url,
    raw.url,
    raw.job_apply_link,
    raw.job_url,
  ].filter(Boolean).join(' '));

  const names = [entity?.name, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const name of names) {
    const normalizedName = normalizeComparable(name);
    if (normalizedName.length >= 3 && containsPhrase(searchable, normalizedName)) {
      return `employer-name:${name}`;
    }

    const withoutLegalSuffix = stripLegalSuffix(normalizedName);
    if (withoutLegalSuffix.length >= 4 && withoutLegalSuffix !== normalizedName && containsPhrase(searchable, withoutLegalSuffix)) {
      return `employer-name:${name}`;
    }
  }

  return null;
}

function mergeDuplicateJobs(left: any, right: any) {
  const leftScore = sourceScore(left?.source);
  const rightScore = sourceScore(right?.source);
  const preferred = rightScore > leftScore ? right : left;
  const fallback = preferred === left ? right : left;
  const normalizedApplyUrl = normalizeApplyUrl(preferred) || normalizeApplyUrl(fallback);
  const duplicateSources = Array.from(new Set([
    ...readDuplicateSources(left),
    ...readDuplicateSources(right),
    String(left?.source || '').trim(),
    String(right?.source || '').trim(),
  ].filter(Boolean)));

  return {
    ...fallback,
    ...preferred,
    department: preferred.department || fallback.department || null,
    location: preferred.location || fallback.location || null,
    city: preferred.city || fallback.city || null,
    state: preferred.state || fallback.state || null,
    country: preferred.country || fallback.country || null,
    lat: preferred.lat ?? fallback.lat ?? null,
    lng: preferred.lng ?? fallback.lng ?? null,
    posted_at: preferred.posted_at || fallback.posted_at || null,
    raw_data: {
      ...(fallback.raw_data || {}),
      ...(preferred.raw_data || {}),
      normalized_apply_url: normalizedApplyUrl,
      duplicate_sources: duplicateSources,
    },
  };
}

function withNormalizedUrl(item: any, normalizedApplyUrl: string | null) {
  if (!normalizedApplyUrl) return item;
  return {
    ...item,
    raw_data: {
      ...(item.raw_data || {}),
      normalized_apply_url: normalizedApplyUrl,
    },
  };
}

function readDuplicateSources(item: any): string[] {
  const value = item?.raw_data?.duplicate_sources;
  return Array.isArray(value) ? value.map(String).map((entry) => entry.trim()).filter(Boolean) : [];
}

function sourceScore(source: unknown) {
  const normalized = String(source || '').trim().toLowerCase();
  if (SOURCE_PRIORITY[normalized] !== undefined) return SOURCE_PRIORITY[normalized];
  if (normalized.startsWith('scrapy:')) return 80;
  if (normalized.includes('portal')) return 85;
  if (normalized.includes('api')) return 65;
  return 50;
}

function normalizeUrl(value: unknown): string | null {
  const url = parseUrl(value);
  if (!url) return null;

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  for (const key of Array.from(url.searchParams.keys())) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.startsWith('utm_') || TRACKING_PARAMS.has(normalizedKey)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();

  return url.toString();
}

function parseUrl(value: unknown): URL | null {
  if (!value) return null;

  try {
    const url = new URL(String(value).trim());
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function sameSite(leftHost: string, rightHost: string) {
  const left = leftHost.toLowerCase().replace(/^www\./, '');
  const right = rightHost.toLowerCase().replace(/^www\./, '');
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function normalizeComparable(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPhrase(haystack: string, needle: string) {
  if (!haystack || !needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function stripLegalSuffix(value: string) {
  return value
    .replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|llc|plc|holdings?|group)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
