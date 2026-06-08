'use client';
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Cell, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';

const ROLE_COLORS: Record<string, string> = {
  security: '#f87171',
  logistics: '#fb923c',
  medical: '#34d399',
  admin: '#94a3b8',
  aviation: '#60a5fa',
  engineering: '#818cf8',
  remote: '#c084fc',
  overseas: '#f472b6',
  other: '#475569',
};

const ROLE_ICONS: Record<string, string> = {
  security: '🛡️', logistics: '📦', medical: '🏥', admin: '📋',
  aviation: '✈️', engineering: '⚙️', remote: '🌐', overseas: '🌍', other: '📌',
};

export default function RoleBreakdown({ roles, loading }: { roles: any; loading: boolean }) {
  const data = roles
    ? Object.entries(roles)
        .map(([name, value]) => ({ name, value: Number(value), icon: ROLE_ICONS[name] || '📌' }))
        .sort((a, b) => b.value - a.value)
        .filter(d => d.value > 0)
    : [];

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="glass-card p-5 h-full">
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
        <div className="space-y-2">
          {data.map(item => {
            const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
            return (
              <div key={item.name} className="flex items-center gap-2">
                <span className="text-xs w-4">{item.icon}</span>
                <div className="flex-1">
                  <div className="flex justify-between text-[10px] mb-0.5">
                    <span className="text-slate-300 capitalize">{item.name}</span>
                    <span className="text-slate-500">{item.value} · {pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${pct}%`,
                        background: ROLE_COLORS[item.name] || '#475569',
                        boxShadow: `0 0 8px ${ROLE_COLORS[item.name] || '#475569'}66`,
                      }}
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
