const ROLE_PATTERNS: Record<string, RegExp> = {
  security: /\b(security|guard|protection|surveillance|clearance|cleared|intelligence|cia|nsa|dod|soc|ciso)\b/i,
  logistics: /\b(logistics|supply chain|warehouse|shipping|distribution|transport|fleet|procurement|dispatcher)\b/i,
  medical: /\b(medical|nurse|physician|doctor|paramedic|emt|health|clinical|rn|lpn|cna|surgical|pharmacy|dental)\b/i,
  admin: /\b(admin|administrative|coordinator|receptionist|executive assistant|office manager|hr |human resources|payroll|clerk)\b/i,
  aviation: /\b(aviation|pilot|aircraft|flight|airfield|airport|helicopter|fixed wing|mechanic|avionics|faa)\b/i,
  engineering: /\b(engineer|developer|software|hardware|systems|network|devops|architect|technical|data|cyber|it |information technology)\b/i,
  remote: /\b(remote|work from home|wfh|virtual|telecommute)\b/i,
  overseas: /\b(overseas|deployed|deployment|contingency|oconus|iraq|afghanistan|kuwait|bahrain|qatar|djibouti|germany|japan|korea)\b/i,
};

export function classifyRole(title: string, location?: string | null): string {
  const text = `${title} ${location || ''}`;
  for (const [category, pattern] of Object.entries(ROLE_PATTERNS)) {
    if (pattern.test(text)) return category;
  }
  return 'other';
}
