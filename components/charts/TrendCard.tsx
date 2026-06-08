'use client';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

function TrendBadge({ value, label }: { value: number; label: string }) {
  const isUp = value > 0;
  const isFlat = value === 0;
  return (
    <div className="glass-card p-3 flex flex-col gap-1 min-w-[90px]">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`text-lg font-bold ${isFlat ? 'trend-flat' : isUp ? 'trend-up' : 'trend-down'}`}>
        {isUp ? '+' : ''}{value}%
      </p>
      <p className={`text-[10px] ${isFlat ? 'trend-flat' : isUp ? 'trend-up' : 'trend-down'}`}>
        {isFlat ? 'flat' : isUp ? '↑ growth' : '↓ decline'}
      </p>
    </div>
  );
}

export default function TrendCard({ metrics, loading, entityName }: {
  metrics: any; loading: boolean; entityName: string;
}) {
  const skeleton = loading || !metrics;

  // Mock sparkline data using trend values
  const sparkData = metrics ? [
    { t: '90d', v: Math.max(0, (metrics.totalActive || 0) * (1 - (metrics.trend90 || 0) / 100)) },
    { t: '60d', v: Math.max(0, (metrics.totalActive || 0) * (1 - (metrics.trend60 || 0) / 100)) },
    { t: '30d', v: Math.max(0, (metrics.totalActive || 0) * (1 - (metrics.trend30 || 0) / 100)) },
    { t: 'Now', v: metrics.totalActive || 0 },
  ] : [];

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-200">Hiring Trend</h3>
        <span className="text-xs text-slate-500">Live data</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {/* Total active */}
        <div className="glass-card p-3">
          <p className="text-[10px] text-slate-500 mb-1">Total Open Jobs</p>
          {skeleton
            ? <div className="h-7 w-16 bg-white/10 rounded animate-pulse" />
            : <p className="text-2xl font-bold text-slate-100">{(metrics.totalActive || 0).toLocaleString()}</p>
          }
        </div>
        {/* New this week */}
        <div className="glass-card p-3">
          <p className="text-[10px] text-slate-500 mb-1">New This Week</p>
          {skeleton
            ? <div className="h-7 w-12 bg-white/10 rounded animate-pulse" />
            : <p className="text-2xl font-bold text-blue-300">{(metrics.newThisWeek || 0).toLocaleString()}</p>
          }
        </div>
        {/* Trend 30 */}
        {skeleton
          ? <div className="h-16 rounded-xl bg-white/10 animate-pulse" />
          : <TrendBadge value={metrics.trend30 || 0} label="30-Day Trend" />
        }
        {/* Trend 60 */}
        {skeleton
          ? <div className="h-16 rounded-xl bg-white/10 animate-pulse" />
          : <TrendBadge value={metrics.trend60 || 0} label="60-Day Trend" />
        }
      </div>

      {/* Sparkline */}
      <div className="h-20">
        {!skeleton && sparkData.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData}>
              <defs>
                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'rgba(15,20,40,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                formatter={(v: any) => [Number(v).toFixed(0), 'Jobs']}
              />
              <Area type="monotone" dataKey="v" stroke="#3b82f6" strokeWidth={2} fill="url(#trendGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 90-day */}
      {!skeleton && (
        <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2">
          <span className="text-xs text-slate-500">90-Day Trend:</span>
          <span className={`text-xs font-semibold ${
            (metrics.trend90 || 0) > 0 ? 'trend-up' : (metrics.trend90 || 0) < 0 ? 'trend-down' : 'trend-flat'
          }`}>
            {metrics.trend90 > 0 ? '+' : ''}{metrics.trend90 || 0}%
          </span>
        </div>
      )}
    </div>
  );
}
