const ROLE_PATTERNS: Record<string, RegExp> = {
  security: /\b(security|guard|protection|surveillance|clearance|cleared|intelligence|cia|nsa|dod|soc|ciso)\b/i,
  logistics: /\b(logistics|supply chain|warehouse|shipping|distribution|transport|fleet|procurement|dispatcher)\b/i,
  medical: /\b(medical|nurse|physician|doctor|paramedic|emt|health|clinical|rn|lpn|cna|surgical|pharmacy|dental)\b/i,
  admin: /\b(admin|administrative|coordinator|receptionist|executive assistant|office manager|hr |human resources|payroll|clerk)\b/i,
  aviation: /\b(aviation|pilot|aircraft|flight|airfield|airport|helicopter|fixed wing|mechanic|avionics|faa)\b/i,
  engineering: /\b(engineer|developer|software|hardware|systems|network|devops|architect|technical|data|cyber|it |information technology)\b/i,
};

export function classifyRole(title: string, _location?: string | null): string {
  const text = String(title || '');
  for (const [category, pattern] of Object.entries(ROLE_PATTERNS)) {
    if (pattern.test(text)) return category;
  }
  return 'other';
}
