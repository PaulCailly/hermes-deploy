import { useState, useMemo } from 'react';
import { StatCard } from '../../components/shared/StatCard';
import { PlatformIcon, platformLabel } from '../../components/shared/PlatformIcon';
import { ModelIcon } from '../../components/shared/ModelIcon';
import { useAgentStats, useAgentSessions } from '../../lib/agent-api';
import type { AgentSession } from '../../lib/agent-types';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const periods = ['7d', '30d', '90d', 'All'] as const;

interface AnalyticsTabProps {
  name: string;
  profile: string;
}

export function AnalyticsTab({ name, profile }: AnalyticsTabProps) {
  const [period, setPeriod] = useState<typeof periods[number]>('30d');
  const statsQ = useAgentStats(name, profile);
  const sessionsQ = useAgentSessions(name, { limit: 500, profile });
  const stats = statsQ.data;
  const allSessions = sessionsQ.data ?? [];

  // Filter sessions by period
  const sessions = useMemo(() => {
    if (period === 'All') return allSessions;
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return allSessions.filter((s) => new Date(s.startedAt).getTime() >= cutoff);
  }, [allSessions, period]);

  // Aggregate periodStats from filtered sessions
  const periodStats = useMemo(() => aggregateStats(sessions), [sessions]);

  // Platform breakdown
  const platformBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of sessions) counts[s.source] = (counts[s.source] ?? 0) + 1;
    const total = sessions.length || 1;
    return Object.entries(counts)
      .map(([platform, count]) => ({ platform, pct: Math.round((count / total) * 100) }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 6);
  }, [sessions]);

  // Model usage
  const modelUsage = useMemo(() => {
    const map: Record<string, { sessions: number; tokens: number; cost: number }> = {};
    for (const s of sessions) {
      const m = s.model || 'unknown';
      if (!map[m]) map[m] = { sessions: 0, tokens: 0, cost: 0 };
      map[m].sessions++;
      map[m].tokens += s.inputTokens + s.outputTokens;
      map[m].cost += s.estimatedCostUSD;
    }
    return Object.entries(map)
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.cost - a.cost);
  }, [sessions]);

  // Hourly activity (0-23 bucket from startedAt)
  const hourlyActivity = useMemo(() => {
    const buckets = new Array(24).fill(0);
    for (const s of sessions) {
      const h = new Date(s.startedAt).getHours();
      buckets[h]++;
    }
    const max = Math.max(...buckets, 1);
    return buckets.map((v) => (v / max) * 100);
  }, [sessions]);

  // Notable sessions
  const notable = useMemo(() => {
    if (sessions.length === 0) return null;
    const longest = sessions.slice().sort((a, b) => durationMs(b) - durationMs(a))[0]!;
    const mostMessages = sessions.slice().sort((a, b) => b.messageCount - a.messageCount)[0]!;
    const mostExpensive = sessions.slice().sort((a, b) => b.estimatedCostUSD - a.estimatedCostUSD)[0]!;
    return {
      longestDuration: formatDuration(durationMs(longest)),
      mostMessages: mostMessages.messageCount,
      mostExpensiveCost: mostExpensive.estimatedCostUSD,
    };
  }, [sessions]);

  const totalTokens = periodStats.totalInputTokens + periodStats.totalOutputTokens + periodStats.totalCacheReadTokens + periodStats.totalCacheWriteTokens + periodStats.totalReasoningTokens;
  const tokenBreakdown = [
    { label: 'Input', value: periodStats.totalInputTokens, color: '#6366f1' },
    { label: 'Output', value: periodStats.totalOutputTokens, color: '#818cf8' },
    { label: 'Cache Read', value: periodStats.totalCacheReadTokens, color: '#a5b4fc' },
    { label: 'Cache Write', value: periodStats.totalCacheWriteTokens, color: '#c4b5fd' },
    { label: 'Reasoning', value: periodStats.totalReasoningTokens, color: '#f59e0b' },
  ].map((t) => ({ ...t, pct: totalTokens > 0 ? Math.round((t.value / totalTokens) * 100) : 0 }));

  let offset = 0;
  const donutSegments = tokenBreakdown.map((t) => {
    const seg = { ...t, offset };
    offset += t.pct;
    return seg;
  });

  const hasData = sessions.length > 0;

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-base font-semibold text-slate-200">
          <i className="fa-solid fa-chart-line text-indigo-500 mr-2" />Analytics
        </div>
        <div className="flex gap-0.5 bg-[#161822] border border-[#2a2d3a] rounded-md p-0.5">
          {periods.map((p) => (
            <button
              key={p}
              className={`text-[11px] px-2.5 py-1 rounded transition-colors ${period === p ? 'text-slate-200 bg-indigo-500/20 font-medium' : 'text-slate-500 hover:text-slate-300'}`}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Loading/Empty state */}
      {sessionsQ.isLoading || statsQ.isLoading ? (
        <div className="text-slate-500 text-sm text-center py-12">Loading analytics…</div>
      ) : !hasData ? (
        <div className="text-slate-500 text-sm text-center py-12">
          <i className="fa-solid fa-chart-line text-3xl mb-3 block text-slate-600" />
          No session data for this period
        </div>
      ) : (
        <>
          {/* Top Stats */}
          <div className="grid grid-cols-6 gap-2.5 mb-4">
            <StatCard icon="fa-solid fa-comments" label="Sessions" value={periodStats.totalSessions.toLocaleString()} />
            <StatCard icon="fa-solid fa-message" label="Messages" value={formatTokens(periodStats.totalMessages)} />
            <StatCard icon="fa-solid fa-wrench" label="Tool Calls" value={periodStats.totalToolCalls.toLocaleString()} />
            <StatCard icon="fa-solid fa-microchip" label="Tokens" value={formatTokens(totalTokens)} />
            <StatCard icon="fa-solid fa-hourglass-half" label="Active Time" value={formatDuration(periodStats.totalActiveMs)} />
            <StatCard icon="fa-solid fa-dollar-sign" label="Est. Cost" value={`$${periodStats.totalCostUSD.toFixed(2)}`} subColor="text-amber-500" />
          </div>

          {/* Token Breakdown Donut */}
          <div className="grid grid-cols-[1.4fr_1fr] gap-4 mb-4">
            <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
              <div className="text-[13px] font-semibold text-slate-200 mb-3">
                <i className="fa-solid fa-chart-area text-indigo-500 mr-1.5" />Cost Over Time
              </div>
              <CostChart sessions={sessions} />
            </div>
            <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
              <div className="text-[13px] font-semibold text-slate-200 mb-3">
                <i className="fa-solid fa-chart-pie text-indigo-500 mr-1.5" />Token Breakdown
              </div>
              <div className="flex items-center gap-4">
                <div className="relative w-[100px] h-[100px] flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1e2030" strokeWidth="3" />
                    {donutSegments.map((s) => (
                      <circle key={s.label} cx="18" cy="18" r="15.9" fill="none" stroke={s.color} strokeWidth="3" strokeDasharray={`${s.pct} ${100 - s.pct}`} strokeDashoffset={-s.offset} />
                    ))}
                  </svg>
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                    <div className="text-[13px] font-bold text-slate-200">{formatTokens(totalTokens)}</div>
                    <div className="text-[8px] text-slate-600">total</div>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  {tokenBreakdown.map((t) => (
                    <div key={t.label} className="flex items-center gap-1.5 text-[11px]">
                      <div className="w-2 h-2 rounded-sm" style={{ background: t.color }} />
                      <span className="text-slate-400 flex-1">{t.label}</span>
                      <span className="text-slate-200 font-medium">{formatTokens(t.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Hourly Activity + Platform */}
            <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
              <div className="text-[13px] font-semibold text-slate-200 mb-3">
                <i className="fa-solid fa-clock text-indigo-500 mr-1.5" />Hourly Activity
              </div>
              <div className="flex gap-[2px] mb-1">
                {hourlyActivity.map((v, i) => (
                  <div key={i} className="flex-1 h-5 rounded-sm" style={{ background: `rgba(99,102,241,${Math.max(0.05, v / 100)})` }} title={`${i}h`} />
                ))}
              </div>
              <div className="flex justify-between text-[8px] text-slate-600 mb-4">
                <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
              </div>

              <div className="pt-3 border-t border-[#2a2d3a]">
                <div className="text-[11px] text-slate-500 mb-2"><i className="fa-solid fa-tower-broadcast mr-1 text-indigo-500" />Platform Breakdown</div>
                <div className="flex flex-col gap-1.5">
                  {platformBreakdown.map((p) => (
                    <div key={p.platform} className="flex items-center gap-1.5">
                      <PlatformIcon platform={p.platform} className="text-[11px] w-3.5 text-center" />
                      <span className="text-[11px] text-slate-400 w-14">{platformLabel(p.platform)}</span>
                      <div className="flex-1 h-[5px] bg-[#1e2030] rounded overflow-hidden">
                        <div className="h-full rounded" style={{ width: `${p.pct}%`, background: '#6366f1' }} />
                      </div>
                      <span className="text-[10px] text-slate-500 w-7 text-right">{p.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Model Usage + Notable */}
            <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
              <div className="text-[13px] font-semibold text-slate-200 mb-3">
                <i className="fa-solid fa-robot text-indigo-500 mr-1.5" />Model Usage
              </div>
              <div className="flex flex-col gap-2.5">
                {modelUsage.slice(0, 3).map((m) => (
                  <div key={m.model} className="bg-amber-700/5 border border-amber-700/15 rounded-md p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <ModelIcon model={m.model} size={14} />
                      <span className="text-[12px] text-slate-200 font-medium">{m.model}</span>
                    </div>
                    <div className="flex gap-3 text-[10px] text-slate-500">
                      <span>{m.sessions} sessions</span>
                      <span>{formatTokens(m.tokens)} tokens</span>
                      <span className="text-amber-500">${m.cost.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {notable && (
                <div className="mt-3.5 pt-3 border-t border-[#2a2d3a]">
                  <div className="text-[11px] text-slate-500 mb-1.5"><i className="fa-solid fa-trophy mr-1 text-amber-500" />Notable Sessions</div>
                  <div className="flex flex-col gap-1 text-[10px]">
                    <div className="flex justify-between text-slate-400"><span>Longest</span><span className="text-slate-200">{notable.longestDuration}</span></div>
                    <div className="flex justify-between text-slate-400"><span>Most messages</span><span className="text-slate-200">{notable.mostMessages} msgs</span></div>
                    <div className="flex justify-between text-slate-400"><span>Most expensive</span><span className="text-amber-500">${notable.mostExpensiveCost.toFixed(2)}</span></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Show overall stats even if period is empty */}
      {stats && !hasData && (
        <div className="mt-6 text-xs text-slate-600 text-center">
          Agent has {stats.totalSessions.toLocaleString()} sessions total ($${stats.totalCostUSD.toFixed(2)}) — try a longer period.
        </div>
      )}
    </div>
  );
}

function CostChart({ sessions }: { sessions: AgentSession[] }) {
  // Bucket cost by day
  const buckets: Record<string, number> = {};
  for (const s of sessions) {
    const day = s.startedAt.slice(0, 10);
    buckets[day] = (buckets[day] ?? 0) + s.estimatedCostUSD;
  }
  const days = Object.keys(buckets).sort();
  if (days.length === 0) return <div className="text-slate-500 text-sm">No data</div>;

  const values = days.map((d) => buckets[d]!);
  const max = Math.max(...values, 0.01);
  const points = values.map((v, i) => ({
    x: days.length > 1 ? (i / (days.length - 1)) * 400 : 200,
    y: 120 - (v / max) * 110,
  }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaD = `${pathD} L${points[points.length - 1]!.x},120 L${points[0]!.x},120 Z`;

  return (
    <>
      <div className="relative h-[120px] border-b border-l border-[#2a2d3a] mb-2">
        <svg width="100%" height="100%" viewBox="0 0 400 120" preserveAspectRatio="none" className="absolute bottom-0 left-0">
          <defs>
            <linearGradient id="costGradLive" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#costGradLive)" />
          <path d={pathD} fill="none" stroke="#6366f1" strokeWidth="2" />
        </svg>
      </div>
      <div className="flex justify-between text-[9px] text-slate-600 pl-1">
        <span>{formatDay(days[0]!)}</span>
        <span>{formatDay(days[days.length - 1]!)}</span>
      </div>
    </>
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function durationMs(s: AgentSession): number {
  if (!s.endedAt) return 0;
  return new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime();
}

function formatDuration(ms: number): string {
  if (ms === 0) return '—';
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return `${Math.round(ms / (1000 * 60))}m`;
  if (hours < 24) return `${Math.floor(hours)}h ${Math.floor((ms / (1000 * 60)) % 60)}m`;
  return `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
}

function aggregateStats(sessions: AgentSession[]) {
  let totalMessages = 0, totalToolCalls = 0;
  let totalInputTokens = 0, totalOutputTokens = 0;
  let totalCacheReadTokens = 0, totalCacheWriteTokens = 0, totalReasoningTokens = 0;
  let totalCostUSD = 0, totalActiveMs = 0;
  for (const s of sessions) {
    totalMessages += s.messageCount;
    totalToolCalls += s.toolCallCount;
    totalInputTokens += s.inputTokens;
    totalOutputTokens += s.outputTokens;
    totalCacheReadTokens += s.cacheReadTokens;
    totalCacheWriteTokens += s.cacheWriteTokens;
    totalReasoningTokens += s.reasoningTokens;
    totalCostUSD += s.estimatedCostUSD;
    if (s.endedAt) totalActiveMs += new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime();
  }
  return {
    totalSessions: sessions.length,
    totalMessages, totalToolCalls,
    totalInputTokens, totalOutputTokens,
    totalCacheReadTokens, totalCacheWriteTokens, totalReasoningTokens,
    totalCostUSD, totalActiveMs,
  };
}
