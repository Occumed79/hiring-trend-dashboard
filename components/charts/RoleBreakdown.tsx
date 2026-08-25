'use client';

const ROLE_COLORS: Record<string, string> = {
  security: '#f87171',
  logistics: '#fb923c',
  medical: '#34d399',
  admin: '#94a3b8',
  aviation: '#60a5fa',
  engineering: '#818cf8',
  other: '#64748b',
};

const LOCATION_COLORS: Record<string, string> = {
  domestic: '#60a5fa',
  overseas: '#f472b6',
  remote: '#c084fc',
  unresolved: '#64748b',
};

const LOCATION_LABELS: Record<string, string> = {
  domestic: 'United States',
  overseas: 'Overseas / international',
  remote: 'Remote',
  unresolved: 'Location unresolved',
};

export default function RoleBreakdown({ roles, locations, loading }: { roles: any; locations?: any; loading: boolean }) {
  const data = roles
    ? Object.entries(roles)
        .filter(([name]) => !name.startsWith('__') && name !== 'remote' && name !== 'overseas')
        .map(([name, value]) => ({ name, value: Number(value) }))
        .sort((a, b) => b.value - a.value)
        .filter(d => d.value > 0)
    : [];
  const locationSource = locations || roles?.__locations || null;
  const locationData = locationSource
    ? Object.entries(locationSource)
        .map(([name, value]) => ({ name, value: Number(value) }))
        .sort((a, b) => b.value - a.value)
        .filter(item => item.value > 0)
    : [];

  const total = data.reduce((s, d) => s + d.value, 0);
  const locationTotal = locationData.reduce((s, d) => s + d.value, 0);

  return (
    <div className="glass-card luminous-panel p-5 h-full">
      <div className="shimmer-top" />
      <h3 className="text-sm font-semibold text-slate-200 mb-4">Role Categories</h3>

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
        <CategoryBars data={data} total={total} colors={ROLE_COLORS} labels={{}} />
      )}

      {!loading && locationData.length > 0 && (
        <div className="mt-6 pt-5 border-t border-white/10">
          <h3 className="text-sm font-semibold text-slate-200 mb-1">Location Categories</h3>
          <p className="text-[10px] text-slate-500 mb-4">Separate from job function · based on normalized job locations</p>
          <CategoryBars data={locationData} total={locationTotal} colors={LOCATION_COLORS} labels={LOCATION_LABELS} />
        </div>
      )}
    </div>
  );
}

function CategoryBars({ data, total, colors, labels }: {
  data: Array<{ name: string; value: number }>;
  total: number;
  colors: Record<string, string>;
  labels: Record<string, string>;
}) {
  return (
    <div className="space-y-3">
      {data.map(item => {
        const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
        const color = colors[item.name] || '#64748b';
        return (
          <div key={item.name} className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
            <div className="flex-1">
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-slate-300">{labels[item.name] || titleCase(item.name)}</span>
                <span className="text-slate-500">{item.value} · {pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function titleCase(value: string) {
  return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}
