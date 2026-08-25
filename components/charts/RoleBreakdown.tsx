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

export default function RoleBreakdown({ roles, countries, loading }: { roles: any; countries?: any; loading: boolean }) {
  const roleData = roles
    ? Object.entries(roles)
        .filter(([name]) => !name.startsWith('__') && name !== 'remote' && name !== 'overseas')
        .map(([name, value]) => ({ name, value: Number(value) }))
        .sort((a, b) => b.value - a.value)
        .filter(item => item.value > 0)
    : [];

  const countrySource = countries || roles?.__countries || null;
  const countryData = countrySource
    ? Object.entries(countrySource)
        .map(([code, value]) => ({ name: countryName(code), value: Number(value) }))
        .sort((a, b) => b.value - a.value)
        .filter(item => item.value > 0)
    : [];

  const roleTotal = roleData.reduce((sum, item) => sum + item.value, 0);
  const countryTotal = countryData.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="glass-card luminous-panel p-5 h-full">
      <div className="shimmer-top" />
      <h3 className="text-sm font-semibold text-slate-200 mb-4">Role Categories</h3>

      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, index) => <div key={index} className="h-8 rounded-lg bg-white/8 animate-pulse" />)}
        </div>
      ) : roleData.length === 0 ? (
        <div className="flex items-center justify-center h-28 text-slate-600 text-sm">No role data yet</div>
      ) : (
        <CategoryBars data={roleData} total={roleTotal} roleColors />
      )}

      {!loading && countryData.length > 0 && (
        <div className="mt-6 pt-5 border-t border-white/10">
          <h3 className="text-sm font-semibold text-slate-200 mb-1">Country Breakdown</h3>
          <p className="text-[10px] text-slate-500 mb-4">Actual normalized job countries — not a domestic/international bucket.</p>
          <CategoryBars data={countryData} total={countryTotal} />
        </div>
      )}
    </div>
  );
}

function CategoryBars({ data, total, roleColors = false }: {
  data: Array<{ name: string; value: number }>;
  total: number;
  roleColors?: boolean;
}) {
  return (
    <div className="space-y-3 max-h-[440px] overflow-y-auto scrollbar-glass pr-1">
      {data.map((item, index) => {
        const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
        const color = roleColors ? (ROLE_COLORS[item.name] || '#64748b') : countryColor(index);
        return (
          <div key={item.name} className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
            <div className="flex-1 min-w-0">
              <div className="flex justify-between gap-3 text-[10px] mb-1">
                <span className="text-slate-300 truncate">{titleCase(item.name)}</span>
                <span className="text-slate-500 shrink-0">{item.value.toLocaleString()} · {pct}%</span>
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

function countryName(value: string) {
  const code = String(value || '').trim().toUpperCase();
  if (!code) return 'Unknown';
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { return code; }
}
function countryColor(index: number) {
  const palette = ['#a855f7','#8b5cf6','#6366f1','#3b82f6','#06b6d4','#14b8a6','#22c55e','#84cc16','#eab308','#f59e0b','#f97316','#ec4899'];
  return palette[index % palette.length];
}
function titleCase(value: string) { return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase()); }
