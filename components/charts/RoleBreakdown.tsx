'use client';

const ROLE_COLORS: Record<string, string> = {
  security: '#f87171',
  logistics: '#fb923c',
  medical: '#34d399',
  admin: '#94a3b8',
  aviation: '#60a5fa',
  engineering: '#818cf8',
  remote: '#c084fc',
  overseas: '#f472b6',
  other: '#64748b',
};

const OH_LABELS: Record<string, string> = {
  high_opportunity: 'High OH opportunity',
  safety_sensitive: 'Safety-sensitive',
  preplacement_exam: 'Pre-placement exam',
  drug_testing: 'Drug testing',
  hearing_conservation: 'Hearing conservation',
  respirator_use: 'Respirator / fit testing',
  medical_surveillance: 'Medical surveillance',
  deployment_oconus: 'Deployment / OCONUS',
  dot_cdl: 'DOT / CDL',
  hazardous_exposure: 'Hazardous exposure',
  high_physical_demand: 'High physical demand',
  clearance_security: 'Clearance / security',
};

export default function RoleBreakdown({ roles, loading }: { roles: any; loading: boolean }) {
  const occupationalHealth = roles?.__occupationalHealth || null;
  const data = roles
    ? Object.entries(roles)
        .filter(([name]) => !name.startsWith('__'))
        .map(([name, value]) => ({ name, value: Number(value) }))
        .sort((a, b) => b.value - a.value)
        .filter(d => d.value > 0)
    : [];

  const total = data.reduce((s, d) => s + d.value, 0);
  const ohSignals = occupationalHealth?.signals
    ? Object.entries(occupationalHealth.signals)
        .map(([name, value]) => ({ name, value: Number(value) }))
        .filter(item => item.value > 0)
        .sort((a, b) => b.value - a.value)
    : [];

  return (
    <div className="glass-card luminous-panel p-5 h-full">
      <div className="shimmer-top" />
      <h3 className="text-sm font-semibold text-slate-200 mb-4">Role Breakdown</h3>

      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-8 rounded-lg bg-white/8 animate-pulse" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="flex items-center justify-center h-28 text-slate-600 text-sm">
          No role data yet
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(item => {
            const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
            const color = ROLE_COLORS[item.name] || ROLE_COLORS.other;
            return (
              <div key={item.name} className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
                <div className="flex-1">
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-slate-300 capitalize">{item.name}</span>
                    <span className="text-slate-500">{item.value} · {pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, background: color, boxShadow: `0 0 10px ${color}88` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && occupationalHealth && (
        <div className="mt-5 pt-5 border-t border-white/10">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Occupational Health Signals</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">AI enrichment · Clarifai primary / Groq fallback · separate from role classification</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-semibold text-slate-100">{Number(occupationalHealth.averageOpportunityScore || 0)}</p>
              <p className="text-[9px] text-slate-500">avg OH score</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-500 mb-3">
            <span>{Number(occupationalHealth.enrichedJobs || 0).toLocaleString()} / {Number(occupationalHealth.totalJobs || 0).toLocaleString()} jobs analyzed</span>
            <span>{Number(occupationalHealth.coveragePct || 0)}% coverage</span>
          </div>

          {ohSignals.length ? (
            <div className="grid grid-cols-1 gap-2">
              {ohSignals.slice(0, 10).map(item => (
                <div key={item.name} className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.025] px-2.5 py-2">
                  <span className="text-[10px] text-slate-300">{OH_LABELS[item.name] || item.name.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] font-semibold text-blue-200">{item.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-slate-600 py-2">
              {Number(occupationalHealth.totalJobs || 0) > 0 ? 'No occupational-health enrichment has been persisted for these active roles yet.' : 'No active jobs to analyze yet.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
