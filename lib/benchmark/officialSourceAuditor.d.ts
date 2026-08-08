export type OfficialSourceAudit = {
  status: 'complete' | 'incomplete' | 'unsupported' | 'error';
  complete: boolean;
  sourceLabel: string;
  sourceUrl: string | null;
  officialCount: number | null;
  jobUrls: string[];
  metadata: Record<string, any>;
};
export function auditOfficialSource(entity: any, source: any): Promise<OfficialSourceAudit>;
export function normalizeUrl(value: unknown): string | null;
export function parseWorkday(value: unknown): any;
export function governmentJobsSlug(board: unknown, url: unknown): string | null;
