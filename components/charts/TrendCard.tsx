'use client';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

function TrendBadge({ value, label }: { value: number; label: string }) {
  const isUp = value > 0;
  const isFlat = value === 0;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-3 flex flex-col gap-1 min-w-[90px]">
      <p className="text-[10px] text-slate-500 uppercase tracking-[0.12em]">{label}</p>
      <p className={`text-lg font-semibold ${isFlat ? 'trend-flat' : isUp ? 'trend-up' : 'trend-down'}`}>
        {isUp ? '+' : ''}{value}%
      </p>
      <p className={`text-[10px] ${isFlat ? 'trend-flat' : isUp ? 'trend-up' : 'trend-down'}`}>
        {isFlat ? 'No change' : isUp ? 'Hiring growth' : 'Hiring decline'}
      </p>
    </div>
  );
}

export default function TrendCard({ metrics, loading, entityName }: { metrics: any; loading: boolean; entityName: string }) {
  const skeleton = loading || !metrics;
  const history = Array.isArray(metrics?.history)
    ? metrics.history.map((row: any) => ({
        date: formatDate(row.date),
        jobs: Number(row.totalActive || 0),
        newJobs: Number(row.newThisWeek || 0),
      }))
    : [];

  return (
    <div className="glass-card luminous-panel p-5 lg:p-6 relative overflow-hidden">
      <div className="shimmer-top" />
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-100">Hiring Trend</h3>
          <p className="text-[10px] text-slate-500 mt-1">Actual daily snapshots for {entityName}</p>
        </div>
        <span className="text-[10px] text-slate-500 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
          {history.length ? `${history.length} snapshot${history.length === 1 ? '' : 's'}` : 'Building history'}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <Metric label="Open Jobs" value={metrics?.totalActive} loading={skeleton} />
        <Metric label="New This Week" value={metrics?.newThisWeek} loading={skeleton} accent />
        {skeleton ? <Skeleton /> : <TrendBadge value={metrics.trend30 || 0} label="30-Day" />}
        {skeleton ? <Skeleton /> : <TrendBadge value={metrics.trend60 || 0} label="60-Day" />}
        {skeleton ? <Skeleton /> : <TrendBadge value={metrics.trend90 || 0} label="90-Day" />}
      </div>

      <div className="h-[180px] rounded-2xl border border-white/8 bg-black/10 p-2">
        {skeleton ? (
          <div className="w-full h-full rounded-xl bg-white/[0.035] animate-pulse" />
        ) : history.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 10, right: 10, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="trendHistoryGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.34} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" minTickGap={28} tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} width={34} tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'rgba(8,14,30,0.96)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 11 }}
                formatter={(value: any) => [Number(value).toLocaleString(), 'Open jobs']}
              />
              <Area type="monotone" dataKey="jobs" stroke="#60a5fa" strokeWidth={2} fill="url(#trendHistoryGrad)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-center px-6">
            <div>
              <p className="text-xs font-medium text-slate-300">Trend history is building</p>
              <p className="text-[10px] text-slate-500 mt-1">Daily snapshots will turn this into a true historical curve.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, loading, accent = false }: { label: string; value: any; loading: boolean; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-[0.12em] mb-1.5">{label}</p>
      {loading ? <div className="h-7 w-14 bg-white/10 rounded animate-pulse" /> : (
        <p className={`text-2xl font-semibold ${accent ? 'text-blue-200' : 'text-slate-100'}`}>{Number(value || 0).toLocaleString()}</p>
      )}
    </div>
  );
}
function Skeleton() { return <div className="h-[76px] rounded-xl bg-white/[0.04] animate-pulse" />; }
function formatDate(value: any) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
