import { fetchGreenhouseJobs } from './greenhouse';
import { fetchLeverJobs } from './lever';
import { fetchSmartRecruitersJobs } from './smartrecruiters';
import { fetchBambooHRJobs } from './bamboohr';
import { fetchCareerPageJobs } from './careerPage';
import {
  fetchAshbyJobs,
  fetchRecruiteeJobs,
  fetchWorkdayJobs,
  fetchHostedAtsJobs,
  STRUCTURED_ATS_PROVIDERS,
} from './expandedAts';
import { detectATS, resolveCompany, type CompanyResolution } from './companyResolver';

interface ConnectorResult {
  jobs: any[];
  used: string[];
  skipped: string[];
  detected: CompanyResolution | null;
}

const DIRECT_CONNECTORS = new Set(['greenhouse', 'lever', 'smartrecruiters', 'bamboohr', ...STRUCTURED_ATS_PROVIDERS]);

export async function fetchJobsForEntity(entity: any): Promise<ConnectorResult> {
  const used: string[] = [];
  const skipped: string[] = [];
  let detected: CompanyResolution | null = null;

  let atsProvider = entity.ats_provider || 'unknown';
  let boardId = entity.ats_board_id || null;
  let careerPageUrl = entity.career_page_url || knownCareerHint(entity.name) || null;

  if ((!careerPageUrl || atsProvider === 'unknown' || (DIRECT_CONNECTORS.has(atsProvider) && !boardId)) && entity.name) {
    detected = await resolveCompany(entity.name, careerPageUrl);
    careerPageUrl = detected.career_page_url || careerPageUrl;
    atsProvider = atsProvider !== 'unknown' ? atsProvider : detected.ats_provider;
    boardId = boardId || detected.ats_board_id;
  } else if (careerPageUrl && atsProvider === 'unknown') {
    const ats = await detectATS(careerPageUrl, entity.name);
    atsProvider = ats.ats_provider;
    boardId = ats.ats_board_id;
    detected = {
      name: entity.name,
      aliases: Array.isArray(entity.aliases) ? entity.aliases : [],
      career_page_url: ats.matched_url || careerPageUrl,
      ats_provider: ats.ats_provider,
      ats_board_id: ats.ats_board_id,
      confidence: ats.confidence,
      notes: [`Known employer career site resolved${ats.ats_provider !== 'unknown' ? ` to ${ats.ats_provider}` : ''}.`],
    };
    careerPageUrl = detected.career_page_url;
  }

  const jobs: any[] = [];

  if (DIRECT_CONNECTORS.has(atsProvider) && boardId) {
    const atsJobs = await fetchDirectAtsJobs(atsProvider, boardId);
    jobs.push(...atsJobs);
    if (atsJobs.length) used.push(atsProvider);
    else skipped.push(`${atsProvider} (0 jobs returned)`);
  }

  const recognizedHostedProvider = atsProvider && atsProvider !== 'unknown' && atsProvider !== 'other' && !DIRECT_CONNECTORS.has(atsProvider);
  if (!jobs.length && recognizedHostedProvider && careerPageUrl) {
    const hostedJobs = await fetchHostedAtsJobs(atsProvider, careerPageUrl, entity.name);
    jobs.push(...hostedJobs);
    if (hostedJobs.length) used.push(`ats:${atsProvider}`);
    else skipped.push(`${atsProvider} hosted connector (0 parseable jobs)`);
  }

  if (careerPageUrl && jobs.length === 0) {
    const careerJobs = await fetchCareerPageJobs(careerPageUrl, entity.name);
    jobs.push(...careerJobs);
    if (careerJobs.length) used.push('career_page');
    else skipped.push('career_page (no parseable jobs found)');
  }

  return { jobs, used: Array.from(new Set(used)), skipped: Array.from(new Set(skipped)), detected };
}

async function fetchDirectAtsJobs(atsProvider: string, boardId: string) {
  switch (atsProvider) {
    case 'greenhouse': return fetchGreenhouseJobs(boardId);
    case 'lever': return fetchLeverJobs(boardId);
    case 'smartrecruiters': return fetchSmartRecruitersJobs(boardId);
    case 'bamboohr': return fetchBambooHRJobs(boardId);
    case 'ashby': return fetchAshbyJobs(boardId);
    case 'recruitee': return fetchRecruiteeJobs(boardId);
    case 'workday': return fetchWorkdayJobs(boardId);
    default: return [];
  }
}

function knownCareerHint(name: unknown) {
  const normalized = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (/\b(?:v2x|vectrus)\b/.test(normalized)) return 'https://careers.gov2x.com';
  if (/\bids international\b/.test(normalized)) return 'https://idsinternational.applytojob.com/apply';
  return null;
}
