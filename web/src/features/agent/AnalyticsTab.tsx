import { useState } from 'react';
import { StatCard } from '../../components/shared/StatCard';
import { PlatformIcon, platformLabel } from '../../components/shared/PlatformIcon';
import { ModelIcon } from '../../components/shared/ModelIcon';
import { getMockStats } from '../../lib/mock-data';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const periods = ['7d', '30d', '90d', 'All'] as const;

const toolUsage = [
  { name: 'execute', icon: 'fa-solid fa-terminal', color: '#22c55e', count: 842, pct: 34 },
  { name: 'read_file', icon: 'fa-solid fa-file', color: '#60a5fa', count: 621, pct: 25 },
  { name: 'write_file', icon: 'fa-solid fa-pen', color: '#f59e0b', count: 398, pct: 16 },
  { name: 'web_search', icon: 'fa-solid fa-globe', color: '#ec4899', count: 312, pct: 13 },
  { name: 'grep', icon: 'fa-solid fa-magnifying-glass', color: '#8b5cf6', count: 298, pct: 12 },
];

const hourlyActivity = [5, 5, 3, 3, 3, 5, 10, 20, 40, 60, 70, 90, 80, 70, 50, 60, 80, 50, 30, 20, 15, 10, 5, 5];

const platformBreakdown = [
  { platform: 'telegram', pct: 45 },
  { platform: 'slack', pct: 30 },
  { platform: 'cli', pct: 15 },
  { platform: 'cron', pct: 10 },
];

export function AnalyticsTab() {
  const [period, setPeriod] = useState<typeof periods[number]>('30d');
  const stats = getMockStats();
  const totalTokens = stats.totalInputTokens + stats.totalOutputTokens + stats.totalCacheReadTokens + stats.totalCacheWriteTokens + stats.totalReasoningTokens;

  const tokenBreakdown = [
    { label: 'Input', value: stats.totalInputTokens, color: '#6366f1', pct: 40 },
    { label: 'Output', value: stats.totalOutputTokens, color: '#818cf8', pct: 25 },
    { label: 'Cache Read', value: stats.totalCacheReadTokens, color: '#a5b4fc', pct: 20 },
    { label: 'Cache Write', value: stats.totalCacheWriteTokens, color: '#c4b5fd', pct: 10 },
    { label: 'Reasoning', value: stats.totalReasoningTokens, color: '#f59e0b', pct: 5 },
  ];

  // Cumulative offsets for donut
  let offset = 0;
  const donutSegments = tokenBreakdown.map((t) => {
    const seg = { ...t, offset };
    offset += t.pct;
    return seg;
  });

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

      {/* Top Stats */}
      <div className="grid grid-cols-6 gap-2.5 mb-4">
        <StatCard icon="fa-solid fa-comments" label="Sessions" value="847" />
        <StatCard icon="fa-solid fa-message" label="Messages" value="12.4K" />
        <StatCard icon="fa-solid fa-wrench" label="Tool Calls" value="3,891" />
        <StatCard icon="fa-solid fa-microchip" label="Tokens" value={formatTokens(totalTokens)} />
        <StatCard icon="fa-solid fa-hourglass-half" label="Active Time" value="142h" />
        <StatCard icon="fa-solid fa-dollar-sign" label="Est. Cost" value={`$${stats.totalCostUSD.toFixed(2)}`} subColor="text-amber-500" />
      </div>

      {/* Cost Over Time + Token Breakdown */}
      <div className="grid grid-cols-[1.4fr_1fr] gap-4 mb-4">
        {/* Cost Chart */}
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <div className="text-[13px] font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-chart-area text-indigo-500 mr-1.5" />Cost Over Time
          </div>
          <div className="relative h-[120px] border-b border-l border-[#2a2d3a] mb-2">
            <div className="absolute -left-7 top-0 text-[9px] text-slate-600">$4</div>
            <div className="absolute -left-7 top-1/3 text-[9px] text-slate-600">$3</div>
            <div className="absolute -left-7 top-2/3 text-[9px] text-slate-600">$1</div>
            <svg width="100%" height="100%" viewBox="0 0 400 120" preserveAspectRatio="none" className="absolute bottom-0 left-0">
              <defs>
                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <path d="M0,90 L30,85 60,70 90,75 120,50 150,55 180,40 210,45 240,30 270,35 300,20 330,25 360,15 400,10 400,120 0,120Z" fill="url(#costGrad)" />
              <path d="M0,90 L30,85 60,70 90,75 120,50 150,55 180,40 210,45 240,30 270,35 300,20 330,25 360,15 400,10" fill="none" stroke="#6366f1" strokeWidth="2" />
            </svg>
          </div>
          <div className="flex justify-between text-[9px] text-slate-600 pl-1">
            <span>Mar 14</span><span>Mar 21</span><span>Mar 28</span><span>Apr 4</span><span>Apr 13</span>
          </div>
        </div>

        {/* Token Donut */}
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

      {/* Bottom Row: Tools + Model Usage */}
      <div className="grid grid-cols-2 gap-4">
        {/* Top Tools + Hourly Activity */}
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <div className="text-[13px] font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-wrench text-indigo-500 mr-1.5" />Top Tools
          </div>
          <div className="flex flex-col gap-2">
            {toolUsage.map((t) => (
              <div key={t.name}>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-slate-400"><i className={`${t.icon} mr-1`} style={{ color: t.color, fontSize: 9 }} />{t.name}</span>
                  <span className="text-slate-500">{t.count} ({t.pct}%)</span>
                </div>
                <div className="h-[5px] bg-[#1e2030] rounded overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${t.pct}%`, background: t.color }} />
                </div>
              </div>
            ))}
          </div>
          {/* Hourly Activity Strip */}
          <div className="mt-3.5 pt-3 border-t border-[#2a2d3a]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-slate-500"><i className="fa-solid fa-clock mr-1 text-indigo-500" />Hourly Activity</span>
              <div className="flex items-center gap-1">
                <span className="text-[8px] text-slate-600">Less</span>
                {[0.08, 0.3, 0.6, 0.9].map((o) => (
                  <div key={o} className="w-2 h-2 rounded-sm" style={{ background: `rgba(99,102,241,${o})` }} />
                ))}
                <span className="text-[8px] text-slate-600">More</span>
              </div>
            </div>
            <div className="flex gap-[2px]">
              {hourlyActivity.map((v, i) => (
                <div key={i} className="flex-1 h-3.5 rounded-sm" style={{ background: `rgba(99,102,241,${Math.max(0.05, v / 100)})` }} title={`${i}h`} />
              ))}
            </div>
            <div className="flex justify-between mt-0.5 text-[8px] text-slate-600">
              <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
            </div>
          </div>
        </div>

        {/* Model Usage + Platform + Notable */}
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <div className="text-[13px] font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-robot text-indigo-500 mr-1.5" />Model Usage
          </div>
          <div className="flex flex-col gap-2.5">
            <div className="bg-amber-700/5 border border-amber-700/15 rounded-md p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <ModelIcon model="claude-sonnet-4-6" size={14} />
                <span className="text-[12px] text-slate-200 font-medium">claude-sonnet-4-6</span>
              </div>
              <div className="flex gap-3 text-[10px] text-slate-500">
                <span>712 sessions</span><span>6.1M tokens</span><span className="text-amber-500">$28.40</span>
              </div>
            </div>
            <div className="bg-amber-700/3 border border-amber-700/10 rounded-md p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <ModelIcon model="claude-haiku-4-5" size={14} />
                <span className="text-[12px] text-slate-200 font-medium">claude-haiku-4-5</span>
              </div>
              <div className="flex gap-3 text-[10px] text-slate-500">
                <span>135 sessions</span><span>2.6M tokens</span><span className="text-amber-500">$10.02</span>
              </div>
            </div>
          </div>

          {/* Platform Breakdown */}
          <div className="mt-3.5 pt-3 border-t border-[#2a2d3a]">
            <div className="text-[11px] text-slate-500 mb-2"><i className="fa-solid fa-tower-broadcast mr-1 text-indigo-500" />Platform Breakdown</div>
            <div className="flex flex-col gap-1.5">
              {platformBreakdown.map((p) => (
                <div key={p.platform} className="flex items-center gap-1.5">
                  <PlatformIcon platform={p.platform} className="text-[11px] w-3.5 text-center" />
                  <span className="text-[11px] text-slate-400 w-14">{platformLabel(p.platform)}</span>
                  <div className="flex-1 h-[5px] bg-[#1e2030] rounded overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${p.pct}%`, background: p.platform === 'telegram' ? '#26a5e4' : p.platform === 'slack' ? '#e01e5a' : '#94a3b8' }} />
                  </div>
                  <span className="text-[10px] text-slate-500 w-7 text-right">{p.pct}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Notable Sessions */}
          <div className="mt-3.5 pt-3 border-t border-[#2a2d3a]">
            <div className="text-[11px] text-slate-500 mb-1.5"><i className="fa-solid fa-trophy mr-1 text-amber-500" />Notable Sessions</div>
            <div className="flex flex-col gap-1 text-[10px]">
              <div className="flex justify-between text-slate-400"><span>Longest</span><span className="text-slate-200">4h 23m</span></div>
              <div className="flex justify-between text-slate-400"><span>Most messages</span><span className="text-slate-200">247 msgs</span></div>
              <div className="flex justify-between text-slate-400"><span>Most expensive</span><span className="text-amber-500">$4.82</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
