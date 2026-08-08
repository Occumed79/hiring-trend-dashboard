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
import { fetchWorkableJobs } from './workable';
import { fetchPersonioJobs } from './personio';
import { fetchSpecializedEmployerJobs } from './employerConnectors';
import { detectATS, resolveCompany, type CompanyResolution, type AtsProvider } from './companyResolver';
import { isGovernmentPortal, resolveGovernmentEntity } from './governmentResolver';

type DetectedResolution = CompanyResolution & { replace_existing?: boolean };
interface ConnectorResult { jobs: any[]; used: string[]; skipped: string[]; detected: DetectedResolution | null; }
type CareerProfile = { career_page_url: string; ats_provider: AtsProvider; ats_board_id: string | null; };
export type ConfiguredJobSource = {
  source_key: string;
  source_type: string;
  source_url?: string | null;
  ats_provider?: string | null;
  board_id?: string | null;
  source_class?: string | null;
  lineage_root?: string | null;
  metadata?: Record<string, any> | null;
};

const DIRECT_CONNECTORS = new Set([
  'greenhouse', 'lever', 'smartrecruiters', 'bamboohr', 'workable', 'personio', ...Array.from(STRUCTURED_ATS_PROVIDERS),
]);

export async function fetchJobsForEntity(entity: any): Promise<ConnectorResult> {
  const used: string[] = [];
  const skipped: string[] = [];
  let detected: DetectedResolution | null = null;

  const pinned = knownCareerProfile(entity.name);
  let atsProvider = pinned?.ats_provider || entity.ats_provider || 'unknown';
  let boardId = pinned?.ats_board_id ?? entity.ats_board_id ?? null;
  let careerPageUrl = pinned?.career_page_url || entity.career_page_url || null;
  const federalSourceResolved = entity.portal === 'federal_agencies' && atsProvider === 'usajobs' && Boolean(boardId);
  const needsResolution = !federalSourceResolved && (
    !careerPageUrl
    || atsProvider === 'unknown'
    || atsProvider === 'other'
    || (DIRECT_CONNECTORS.has(atsProvider) && !boardId)
  );

  if (pinned) {
    detected = {
      name: entity.name,
      aliases: Array.isArray(entity.aliases) ? entity.aliases : [],
      career_page_url: pinned.career_page_url,
      ats_provider: pinned.ats_provider,
      ats_board_id: pinned.ats_board_id,
      confidence: 'high',
      notes: ['Pinned authoritative employer career surface.'],
      replace_existing: true,
    };
  } else if (needsResolution && entity.name) {
    const governmentPortal = isGovernmentPortal(entity.portal);
    detected = governmentPortal
      ? await resolveGovernmentEntity(entity.name, entity.portal, careerPageUrl)
      : await resolveCompany(entity.name, careerPageUrl);

    const governmentCanHeal = governmentPortal && (
      detected.ats_provider === 'usajobs'
      || detected.ats_provider === 'governmentjobs'
      || detected.ats_provider === 'neogov'
      || Boolean(detected.career_page_url)
      || Boolean(detected.ats_board_id)
      || detected.confidence !== 'low'
    );
    if (governmentCanHeal) detected.replace_existing = true;

    careerPageUrl = detected.replace_existing
      ? (detected.career_page_url || null)
      : (detected.career_page_url || careerPageUrl);
    atsProvider = detected.replace_existing
      ? (detected.ats_provider || 'unknown')
      : (atsProvider !== 'unknown' && atsProvider !== 'other' ? atsProvider : detected.ats_provider);
    boardId = detected.replace_existing
      ? (detected.ats_board_id || null)
      : (boardId || detected.ats_board_id);
  } else if (careerPageUrl && atsProvider === 'unknown') {
    detected = asResolution(entity, await detectATS(careerPageUrl, entity.name), careerPageUrl, false);
    atsProvider = detected.ats_provider;
    boardId = detected.ats_board_id;
    careerPageUrl = detected.career_page_url;
  }

  const jobs: any[] = [];

  if (careerPageUrl) {
    const specialized = await fetchSpecializedEmployerJobs(entity.name, atsProvider, careerPageUrl).catch((error) => {
      skipped.push(`specialized employer connector (${error instanceof Error ? error.message : String(error)})`);
      return { handled: false, jobs: [], source: null };
    });
    if (specialized.handled) {
      jobs.push(...specialized.jobs);
      if (specialized.jobs.length && specialized.source) used.push(specialized.source);
      else if (specialized.source) skipped.push(`${specialized.source} (0 verified jobs returned)`);
    }
  }

  if (!jobs.length && DIRECT_CONNECTORS.has(atsProvider) && boardId) {
    const atsJobs = await fetchDirectAtsJobs(atsProvider, boardId);
    jobs.push(...atsJobs);
    if (atsJobs.length) {
      used.push(atsProvider);
    } else {
      skipped.push(`${atsProvider} (0 jobs returned; validating stored ATS mapping)`);
      if (careerPageUrl) {
        const redetected = await detectATS(careerPageUrl, entity.name);
        if (redetected.ats_provider !== atsProvider || redetected.ats_board_id !== boardId) {
          detected = asResolution(entity, redetected, careerPageUrl, true);
          atsProvider = redetected.ats_provider;
          boardId = redetected.ats_board_id;
          careerPageUrl = redetected.matched_url || careerPageUrl;
          skipped.push(`stale ${entity.ats_provider || atsProvider} mapping replaced with ${atsProvider || 'unknown'}`);
        }
      }
    }
  }

  const recognizedHostedProvider = atsProvider && atsProvider !== 'unknown' && atsProvider !== 'other' && atsProvider !== 'usajobs' && !DIRECT_CONNECTORS.has(atsProvider);
  if (!jobs.length && recognizedHostedProvider && careerPageUrl) {
    const hostedJobs = await fetchHostedAtsJobs(atsProvider, careerPageUrl, entity.name);
    jobs.push(...hostedJobs);
    if (hostedJobs.length) used.push(`ats:${atsProvider}`);
    else skipped.push(`${atsProvider} hosted connector (0 verified jobs)`);
  }

  if (careerPageUrl && jobs.length === 0 && atsProvider !== 'usajobs') {
    const careerJobs = await fetchCareerPageJobs(careerPageUrl, entity.name);
    jobs.push(...careerJobs);
    if (careerJobs.length) used.push('career_page');
    else skipped.push('career_page (0 verified job-detail rows)');
  }

  return { jobs, used: Array.from(new Set(used)), skipped: Array.from(new Set(skipped)), detected };
}

export async function fetchJobsForConfiguredSource(entity: any, source: ConfiguredJobSource): Promise<{ jobs: any[]; used: string[]; skipped: string[] }> {
  const provider = String(source.ats_provider || '').toLowerCase();
  const boardId = source.board_id || null;
  const url = source.source_url || null;
  const jobs: any[] = [];
  const used: string[] = [];
  const skipped: string[] = [];

  if (provider === 'usajobs') return { jobs: [], used: [], skipped: [`${source.source_key} handled by federal USAJOBS connector`] };

  if (url) {
    const specialized = await fetchSpecializedEmployerJobs(entity.name, provider || 'unknown', url).catch(() => ({ handled: false, jobs: [], source: null }));
    if (specialized.handled) {
      jobs.push(...specialized.jobs);
      if (specialized.jobs.length && specialized.source) used.push(`${source.source_key}:${specialized.source}`);
    }
  }

  if (!jobs.length && provider && DIRECT_CONNECTORS.has(provider) && boardId) {
    const direct = await fetchDirectAtsJobs(provider, boardId);
    jobs.push(...direct);
    if (direct.length) used.push(source.source_key);
    else skipped.push(`${source.source_key} (${provider} returned 0 jobs)`);
  }

  const hosted = provider && provider !== 'unknown' && provider !== 'other' && !DIRECT_CONNECTORS.has(provider);
  if (!jobs.length && hosted && url) {
    const rows = await fetchHostedAtsJobs(provider, url, entity.name);
    jobs.push(...rows);
    if (rows.length) used.push(source.source_key);
    else skipped.push(`${source.source_key} (${provider} hosted page returned 0 verified jobs)`);
  }

  if (!jobs.length && url) {
    const rows = await fetchCareerPageJobs(url, entity.name);
    jobs.push(...rows);
    if (rows.length) used.push(source.source_key);
    else skipped.push(`${source.source_key} (official page returned 0 verified jobs)`);
  }

  return {
    jobs: jobs.map(job => ({
      ...job,
      raw_data: {
        ...(job.raw_data || {}),
        source_graph_key: source.source_key,
        source_graph_lineage: source.lineage_root || source.source_key,
        source_graph_class: source.source_class || 'authoritative',
      },
    })),
    used: Array.from(new Set(used)),
    skipped: Array.from(new Set(skipped)),
  };
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
    case 'workable': return fetchWorkableJobs(boardId);
    case 'personio': return fetchPersonioJobs(boardId);
    default: return [];
  }
}

function asResolution(entity: any, ats: any, fallbackUrl: string, replaceExisting: boolean): DetectedResolution {
  return {
    name: entity.name,
    aliases: Array.isArray(entity.aliases) ? entity.aliases : [],
    career_page_url: ats.matched_url || fallbackUrl,
    ats_provider: ats.ats_provider || 'unknown',
    ats_board_id: ats.ats_board_id || null,
    confidence: ats.confidence || 'low',
    notes: [replaceExisting ? 'Stored ATS mapping was stale and was re-detected.' : 'Career surface detected.'],
    replace_existing: replaceExisting,
  };
}

function knownCareerProfile(name: unknown): CareerProfile | null {
  const normalized = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (/\bamentum\b/.test(normalized)) {
    return { career_page_url: 'https://www.amentumcareers.com/jobs/search', ats_provider: 'other', ats_board_id: null };
  }
  if (/\b(?:v2x|vectrus)\b/.test(normalized)) {
    return { career_page_url: 'https://careers.gov2x.com/why-gov2x/jobs', ats_provider: 'icims', ats_board_id: 'why-gov2x' };
  }
  if (/\bids international\b/.test(normalized)) {
    return { career_page_url: 'https://idsinternational.applytojob.com/apply/jobs/', ats_provider: 'jazzhr', ats_board_id: 'idsinternational' };
  }
  return null;
}