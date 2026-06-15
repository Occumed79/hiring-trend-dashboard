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

export default function RoleBreakdown({ roles, loading }: { roles: any; loading: boolean }) {
  const data = roles
    ? Object.entries(roles)
        .map(([name, value]) => ({ name, value: Number(value) }))
        .sort((a, b) => b.value - a.value)
        .filter(d => d.value > 0)
    : [];

  const total = data.reduce((s, d) => s + d.value, 0);

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
        <div className="flex items-center justify-center h-40 text-slate-600 text-sm">
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
    </div>
  );
}
