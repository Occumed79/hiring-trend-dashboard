export type ReliabilityIssue = {
  key: string;
  kind: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: string | null;
  message: string;
  details: Record<string, any>;
};

export function evaluateSourceReliability(input: {
  checks?: any[];
  previous?: Record<string, any>;
  assessment?: any;
  staleHours?: number;
  nowMs?: number;
}): ReliabilityIssue[];

export function collapseIndependentLineages(checks: any[]): any[];
