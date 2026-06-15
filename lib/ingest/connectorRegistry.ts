import { fetchGreenhouseJobs } from './greenhouse';
import { fetchLeverJobs } from './lever';
import { fetchSmartRecruitersJobs } from './smartrecruiters';
import { fetchBambooHRJobs } from './bamboohr';
import { fetchCareerPageJobs } from './careerPage';
import { detectATS, resolveCompany, type CompanyResolution } from './companyResolver';

interface ConnectorResult {
  jobs: any[];
  used: string[];
  skipped: string[];
  detected: CompanyResolution | null;
}

const DIRECT_CONNECTORS = new Set(['greenhouse', 'lever', 'smartrecruiters', 'bamboohr']);

export async function fetchJobsForEntity(entity: any): Promise<ConnectorResult> {
  const used: string[] = [];
  const skipped: string[] = [];
  let detected: CompanyResolution | null = null;

  let atsProvider = entity.ats_provider || 'unknown';
  let boardId = entity.ats_board_id || null;
  let careerPageUrl = entity.career_page_url || null;

  if ((!careerPageUrl || atsProvider === 'unknown' || !boardId) && entity.name) {
    detected = await resolveCompany(entity.name, careerPageUrl);
    careerPageUrl = careerPageUrl || detected.career_page_url;
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
  } else if (atsProvider && atsProvider !== 'unknown') {
    skipped.push(`${atsProvider} (detected but generic connector not implemented yet)`);
  }

  if (careerPageUrl && jobs.length === 0) {
    const careerJobs = await fetchCareerPageJobs(careerPageUrl, entity.name);
    jobs.push(...careerJobs);
    if (careerJobs.length) used.push('career_page');
    else skipped.push('career_page (no parseable jobs found)');
  }

  return { jobs, used, skipped, detected };
}

async function fetchDirectAtsJobs(atsProvider: string, boardId: string) {
  switch (atsProvider) {
    case 'greenhouse':
      return fetchGreenhouseJobs(boardId);
    case 'lever':
      return fetchLeverJobs(boardId);
    case 'smartrecruiters':
      return fetchSmartRecruitersJobs(boardId);
    case 'bamboohr':
      return fetchBambooHRJobs(boardId);
    default:
      return [];
  }
}
