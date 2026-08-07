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
  HOSTED_ATS_PROVIDERS,
  STRUCTURED_ATS_PROVIDERS,
} from './expandedAts';
import { detectATS, resolveCompany, type CompanyResolution } from './companyResolver';

interface ConnectorResult {
  jobs: any[];
  used: string[];
  skipped: string[];
  detected: CompanyResolution | null;
}

const DIRECT_CONNECTORS = new Set([
  'greenhouse', 'lever', 'smartrecruiters', 'bamboohr', ...STRUCTURED_ATS_PROVIDERS,
]);

export async function fetchJobsForEntity(entity: any): Promise<ConnectorResult> {
  const used: string[] = [];
  const skipped: string[] = [];
  let detected: CompanyResolution | null = null;

  let atsProvider = entity.ats_provider || 'unknown';
  let boardId = entity.ats_board_id || null;
  let careerPageUrl = entity.career_page_url || null;

  if ((!careerPageUrl || atsProvider === 'unknown' || (DIRECT_CONNECTORS.has(atsProvider) && !boardId)) && entity.name) {
    detected = await resolveCompany(entity.name, careerPageUrl);
    careerPageUrl = detected.career_page_url || careerPageUrl;
    atsProvider = atsProvider !== 'unknown' ? atsProvider : detected.ats_provider;
    boardId = boardId || detected.ats_board_id;
  } else if (careerPageUrl && atsProvider === 'unknown') {
    const ats = await detectATS(careerPageUrl, entity.name);
    atsProvider = ats.ats_provider;
    boardId = ats.ats_board_id;
  }

  const jobs: any[] = [];

  if (DIRECT_CONNECTORS.has(atsProvider) && boardId) {
    const atsJobs = await fetchDirectAtsJobs(atsProvider, boardId);
    jobs.push(...atsJobs);
    if (atsJobs.length) used.push(atsProvider);
    else skipped.push(`${atsProvider} (0 jobs returned)`);
  }

  if (!jobs.length && HOSTED_ATS_PROVIDERS.has(atsProvider) && careerPageUrl) {
    const hostedJobs = await fetchHostedAtsJobs(atsProvider, careerPageUrl, entity.name);
    jobs.push(...hostedJobs);
    if (hostedJobs.length) used.push(`ats:${atsProvider}`);
    else skipped.push(`${atsProvider} hosted connector (0 parseable jobs)`);
  }

  if (!jobs.length && atsProvider && atsProvider !== 'unknown' && !DIRECT_CONNECTORS.has(atsProvider) && !HOSTED_ATS_PROVIDERS.has(atsProvider)) {
    skipped.push(`${atsProvider} (recognized but no dedicated public connector path)`);
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
