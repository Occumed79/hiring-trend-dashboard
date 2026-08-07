export type AtsProvider =
  | 'greenhouse' | 'lever' | 'workday' | 'icims' | 'taleo' | 'oracle'
  | 'smartrecruiters' | 'bamboohr' | 'jobvite' | 'usajobs' | 'ashby' | 'recruitee'
  | 'successfactors' | 'workable' | 'teamtailor' | 'personio' | 'comeet' | 'breezyhr'
  | 'jazzhr' | 'rippling' | 'dayforce' | 'ukg' | 'adp' | 'paylocity' | 'paycom'
  | 'neogov' | 'governmentjobs' | 'applicantpro' | 'pinpoint' | 'zoho_recruit'
  | 'bullhorn' | 'ceipal' | 'clearcompany' | 'cornerstone' | 'eightfold' | 'avature'
  | 'phenom' | 'hirebridge' | 'silkroad' | 'other' | 'unknown';

export interface CompanyResolution {
  name: string;
  aliases: string[];
  career_page_url: string | null;
  ats_provider: AtsProvider;
  ats_board_id: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
}

interface AtsDetection {
  ats_provider: AtsProvider;
  ats_board_id: string | null;
  matched_url: string | null;
  confidence: 'high' | 'medium' | 'low';
}

const CAREER_KEYWORDS = ['career', 'careers', 'jobs', 'job openings', 'open roles', 'employment', 'recruiting', 'vacancies'];

export async function resolveCompany(name: string, suppliedCareerUrl?: string | null): Promise<CompanyResolution> {
  const cleanName = name.trim();
  const aliases = buildAliases(cleanName);
  const notes: string[] = [];
  const career = await discoverCareerPage(cleanName, suppliedCareerUrl || null);

  if (!career.url) {
    notes.push('No career page was auto-discovered. Aggregator/API fallback can still collect lower-confidence matches.');
    return { name: cleanName, aliases, career_page_url: null, ats_provider: 'unknown', ats_board_id: null, confidence: 'low', notes };
  }

  const detection = await detectATS(career.url, cleanName, career.html);
  if (detection.ats_provider === 'unknown') {
    notes.push('Career page found, but no recognized ATS was detected. Generic career-page parsing will be used.');
  } else {
    notes.push(`Detected ${detection.ats_provider}${detection.ats_board_id ? ` board ${detection.ats_board_id}` : ''}.`);
  }

  return {
    name: cleanName,
    aliases,
    career_page_url: detection.matched_url || career.url,
    ats_provider: detection.ats_provider,
    ats_board_id: detection.ats_board_id,
    confidence: detection.confidence,
    notes,
  };
}

export async function detectATS(careerPageUrl: string, companyName?: string, suppliedHtml?: string | null): Promise<AtsDetection> {
  const html = suppliedHtml ?? await fetchText(careerPageUrl);
  const urls = [careerPageUrl, ...extractUrls(html || '', careerPageUrl)];

  for (const url of urls) {
    const detected = detectFromUrl(url);
    if (detected.ats_provider !== 'unknown') return detected;
  }

  const lower = (html || '').toLowerCase();
  const htmlSignals: Array<[RegExp, AtsProvider]> = [
    [/greenhouse/, 'greenhouse'], [/lever\.co|lever-jobs/, 'lever'], [/ashbyhq/, 'ashby'],
    [/recruitee/, 'recruitee'], [/smartrecruiters/, 'smartrecruiters'], [/bamboohr/, 'bamboohr'],
    [/myworkdayjobs|workday/, 'workday'], [/icims/, 'icims'], [/taleo/, 'taleo'],
    [/oraclecloud.*hcm|oracle recruiting/, 'oracle'], [/jobvite/, 'jobvite'], [/successfactors/, 'successfactors'],
    [/workable/, 'workable'], [/teamtailor/, 'teamtailor'], [/personio/, 'personio'], [/comeet/, 'comeet'],
    [/breezy/, 'breezyhr'], [/jazzhr|applytojob/, 'jazzhr'], [/rippling/, 'rippling'],
    [/dayforce/, 'dayforce'], [/ultipro|ukg/, 'ukg'], [/workforcenow\.adp|adp recruiting/, 'adp'],
    [/paylocity/, 'paylocity'], [/paycom/, 'paycom'], [/governmentjobs|neogov/, 'governmentjobs'],
    [/applicantpro/, 'applicantpro'], [/pinpointhq/, 'pinpoint'], [/zohorecruit/, 'zoho_recruit'],
    [/bullhornstaffing/, 'bullhorn'], [/ceipal/, 'ceipal'], [/clearcompany/, 'clearcompany'],
    [/csod|cornerstone/, 'cornerstone'], [/eightfold/, 'eightfold'], [/avature/, 'avature'],
    [/phenom/, 'phenom'], [/hirebridge/, 'hirebridge'], [/silkroad/, 'silkroad'],
  ];
  for (const [pattern, provider] of htmlSignals) {
    if (pattern.test(lower)) {
      return { ats_provider: provider, ats_board_id: inferBoardId(provider, careerPageUrl, companyName), matched_url: careerPageUrl, confidence: 'medium' };
    }
  }

  return { ats_provider: 'unknown', ats_board_id: null, matched_url: null, confidence: 'low' };
}

async function discoverCareerPage(companyName: string, suppliedCareerUrl: string | null): Promise<{ url: string | null; html: string | null }> {
  if (suppliedCareerUrl) {
    const normalized = normalizeUrl(suppliedCareerUrl);
    const html = await fetchText(normalized);
    return { url: normalized, html };
  }

  const slug = inferDomainSlug(companyName);
  if (!slug) return { url: null, html: null };

  const candidates = [
    `https://careers.${slug}.com`, `https://jobs.${slug}.com`, `https://www.${slug}.com/careers`,
    `https://www.${slug}.com/jobs`, `https://${slug}.com/careers`, `https://${slug}.com/jobs`,
    `https://${slug}.com/career`, `https://www.${slug}.com/career`,
  ];

  for (const candidate of candidates) {
    const html = await fetchText(candidate);
    if (html && looksLikeCareerPage(candidate, html)) return { url: candidate, html };
  }
  return { url: null, html: null };
}

function detectFromUrl(url: string): AtsDetection {
  const decoded = safeDecode(url);
  const parsed = safeUrl(decoded);
  const host = parsed?.hostname.toLowerCase() || '';
  const path = parsed?.pathname || '';

  const greenhouse = decoded.match(/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#&]+)/i)
    || decoded.match(/[?&]for=([^&#]+).*greenhouse/i)
    || decoded.match(/greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?#&]+)/i);
  if (greenhouse?.[1]) return hit('greenhouse', cleanupToken(greenhouse[1]), url);

  const lever = decoded.match(/jobs\.lever\.co\/([^/?#&]+)/i);
  if (lever?.[1]) return hit('lever', cleanupToken(lever[1]), url);

  const ashby = decoded.match(/jobs\.ashbyhq\.com\/([^/?#&]+)/i);
  if (ashby?.[1]) return hit('ashby', cleanupToken(ashby[1]), url);

  const recruitee = host.match(/^([^.]+)\.recruitee\.com$/i);
  if (recruitee?.[1]) return hit('recruitee', cleanupToken(recruitee[1]), url);

  const smart = decoded.match(/jobs\.smartrecruiters\.com\/([^/?#&]+)/i) || decoded.match(/api\.smartrecruiters\.com\/v1\/companies\/([^/?#&]+)/i);
  if (smart?.[1]) return hit('smartrecruiters', cleanupToken(smart[1]), url);

  const bamboo = host.match(/^([^.]+)\.bamboohr\.com$/i);
  if (bamboo?.[1] && /\/careers/i.test(path)) return hit('bamboohr', cleanupToken(bamboo[1]), url);

  if (/myworkdayjobs\.com|myworkdaysite\.com|workdayjobs\.com/i.test(host)) return hit('workday', canonicalWorkdayBoard(url), url);
  if (/icims\.com/i.test(host)) return hit('icims', null, url, 'medium');
  if (/taleo\.net/i.test(host)) return hit('taleo', null, url, 'medium');
  if (/oraclecloud\.com/i.test(host) && /hcm|career|job/i.test(decoded)) return hit('oracle', null, url, 'medium');
  if (/jobvite\.com/i.test(host)) return hit('jobvite', firstPathToken(path), url, 'medium');
  if (/successfactors\.com/i.test(host)) return hit('successfactors', firstPathToken(path), url, 'medium');
  if (/apply\.workable\.com$/i.test(host)) return hit('workable', firstPathToken(path), url);
  if (/teamtailor\.com$/i.test(host)) return hit('teamtailor', host.split('.')[0], url);
  if (/jobs\.personio\.(?:com|de)$/i.test(host)) return hit('personio', host.split('.')[0], url);
  if (/comeet\.(?:com|co)$/i.test(host)) return hit('comeet', firstPathToken(path), url, 'medium');
  if (/breezy\.hr$/i.test(host)) return hit('breezyhr', host.split('.')[0], url);
  if (/applytojob\.com$/i.test(host)) return hit('jazzhr', firstPathToken(path), url, 'medium');
  if (/ats\.rippling\.com$/i.test(host)) return hit('rippling', firstPathToken(path), url);
  if (/dayforcehcm\.com$/i.test(host)) return hit('dayforce', path.split('/').filter(Boolean)[1] || null, url, 'medium');
  if (/ultipro\.com$|ukg\.com$/i.test(host)) return hit('ukg', null, url, 'medium');
  if (/workforcenow\.adp\.com$/i.test(host)) return hit('adp', null, url, 'medium');
  if (/recruiting\.paylocity\.com$/i.test(host)) return hit('paylocity', null, url, 'medium');
  if (/paycomonline\.net$/i.test(host)) return hit('paycom', null, url, 'medium');
  if (/governmentjobs\.com$/i.test(host)) return hit('governmentjobs', path.match(/\/careers\/([^/?#]+)/i)?.[1] || null, url);
  if (/neogov\.com$/i.test(host)) return hit('neogov', null, url, 'medium');
  if (/applicantpro\.com$/i.test(host)) return hit('applicantpro', host.split('.')[0], url, 'medium');
  if (/pinpointhq\.com$/i.test(host)) return hit('pinpoint', host.split('.')[0], url, 'medium');
  if (/zohorecruit\.com$/i.test(host)) return hit('zoho_recruit', null, url, 'medium');
  if (/bullhornstaffing\.com$/i.test(host)) return hit('bullhorn', null, url, 'medium');
  if (/ceipal\.com$/i.test(host)) return hit('ceipal', null, url, 'medium');
  if (/clearcompany\.com$/i.test(host)) return hit('clearcompany', host.split('.')[0], url, 'medium');
  if (/csod\.com$/i.test(host)) return hit('cornerstone', host.split('.')[0], url, 'medium');
  if (/eightfold\.ai$/i.test(host)) return hit('eightfold', null, url, 'medium');
  if (/avature\.net$/i.test(host)) return hit('avature', host.split('.')[0], url, 'medium');
  if (/phenom\.com$/i.test(host)) return hit('phenom', null, url, 'medium');
  if (/hirebridge\.com$/i.test(host)) return hit('hirebridge', null, url, 'medium');
  if (/silkroad\.com$/i.test(host)) return hit('silkroad', null, url, 'medium');

  return { ats_provider: 'unknown', ats_board_id: null, matched_url: null, confidence: 'low' };
}

function inferBoardId(provider: AtsProvider, url: string, companyName?: string) {
  const detected = detectFromUrl(url);
  if (detected.ats_provider === provider && detected.ats_board_id) return detected.ats_board_id;
  if (provider === 'workday') return canonicalWorkdayBoard(url);
  if (['greenhouse', 'lever', 'smartrecruiters', 'ashby', 'recruitee'].includes(provider)) return inferSlug(companyName);
  return null;
}

function extractUrls(html: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const regex = /(?:href|src)=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    try {
      const absolute = new URL(href, baseUrl).toString();
      if (CAREER_KEYWORDS.some(k => absolute.toLowerCase().includes(k)) || detectFromUrl(absolute).ats_provider !== 'unknown') urls.add(absolute);
    } catch {}
  }
  return Array.from(urls).slice(0, 120);
}

function looksLikeCareerPage(url: string, html: string) {
  const lower = `${url} ${html.slice(0, 250000)}`.toLowerCase();
  return CAREER_KEYWORDS.some(k => lower.includes(k));
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'OccuMedHiringTrendDashboard/1.0 (+https://github.com/Occumed79/hiring-trend-dashboard)',
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(9000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

function hit(provider: AtsProvider, boardId: string | null, url: string, confidence: 'high' | 'medium' | 'low' = 'high'): AtsDetection {
  return { ats_provider: provider, ats_board_id: boardId, matched_url: url, confidence };
}

function canonicalWorkdayBoard(value: string) {
  const url = safeUrl(value);
  if (!url) return value;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0]?.match(/^[a-z]{2}-[A-Z]{2}$/)) parts.shift();
  const site = parts[0];
  return site ? `${url.origin}/${site}` : url.origin;
}

function firstPathToken(path: string) {
  return path.split('/').filter(Boolean)[0] || null;
}

function buildAliases(name: string) {
  const aliases = new Set<string>();
  const withoutSuffix = name.replace(/\b(inc\.?|llc|ltd\.?|corp\.?|corporation|company|co\.?|plc|holdings?|group)\b/gi, '').replace(/\s+/g, ' ').trim();
  if (withoutSuffix && withoutSuffix.toLowerCase() !== name.toLowerCase()) aliases.add(withoutSuffix);
  return Array.from(aliases);
}

function inferDomainSlug(name: string) {
  return name.toLowerCase().replace(/&/g, 'and').replace(/\b(inc\.?|llc|ltd\.?|corp\.?|corporation|company|co\.?|plc|holdings?|group|the)\b/g, '').replace(/[^a-z0-9]/g, '').trim();
}
function inferSlug(name?: string) { return name ? inferDomainSlug(name) || null : null; }
function normalizeUrl(url: string) { return /^https?:\/\//i.test(url) ? url : `https://${url}`; }
function cleanupToken(token: string) { return token.replace(/^www\./i, '').replace(/\/$/, '').trim(); }
function safeDecode(value: string) { try { return decodeURIComponent(value); } catch { return value; } }
function safeUrl(value: string) { try { return new URL(value); } catch { return null; } }
