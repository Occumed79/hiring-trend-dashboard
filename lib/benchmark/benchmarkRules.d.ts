export const DEFAULT_RELEASE_THRESHOLDS: {
  minBenchmarkEntities: number;
  minTruthEntities: number;
  minPrecision: number;
  minRecall: number;
  minParity: number;
  maxDuplicateRate: number;
  maxStaleRate: number;
  minMappedRate: number;
  minAuthoritativeHealth: number;
  maxHighIncidentRate: number;
};
export function normalizeJobUrl(value: unknown): string | null;
export function compareTruth(appUrls: unknown[], truthUrls: unknown[]): any;
export function parityScore(appCount: unknown, referenceCount: unknown): number | null;
export function assessEntityBenchmark(input: any): any;
export function assessPortalRelease(rows: any[], overrides?: Record<string, number>): any;
