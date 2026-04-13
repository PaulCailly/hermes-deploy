import { StatCard } from '../../components/shared/StatCard';
import { StatusPulse } from '../../components/shared/StatusPulse';
import { PlatformIcon, platformLabel } from '../../components/shared/PlatformIcon';
import { ModelIcon } from '../../components/shared/ModelIcon';
import { CloudIcon } from '../../components/shared/CloudIcon';
import { getMockStats, getMockSessions } from '../../lib/mock-data';
import type { StatusPayloadDto } from '@hermes/dto';
import type { Navigate } from '../../lib/types';

interface OverviewTabProps {
  name: string;
  status: StatusPayloadDto | undefined;
  navigate: Navigate;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function OverviewTab({ name, status, navigate }: OverviewTabProps) {
  const stats = getMockStats();
  const sessions = getMockSessions();
  const health = status?.stored?.health ?? 'unknown';
  const cloud = status?.stored?.cloud ?? '';
  const region = status?.stored?.region ?? '';

  const activityData = [30, 55, 45, 80, 65, 90, 40];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const platformBreakdown = [
    { platform: 'telegram', pct: 45 },
    { platform: 'slack', pct: 30 },
    { platform: 'cli', pct: 15 },
    { platform: 'cron', pct: 10 },
  ];

  return (
    <div className="p-5">
      {/* Status Row */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-3.5 flex items-center gap-2.5">
          <div className="w-9 h-9 bg-green-500/10 rounded-lg flex items-center justify-center">
            <StatusPulse status={health === 'healthy' ? 'online' : health === 'unhealthy' ? 'warning' : 'offline'} size={14} />
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Agent Status</div>
            <div className={`text-sm font-semibold ${health === 'healthy' ? 'text-green-500' : health === 'unhealthy' ? 'text-red-400' : 'text-slate-400'}`}>
              {health === 'healthy' ? 'Running' : health === 'unhealthy' ? 'Unhealthy' : 'Unknown'}
            </div>
          </div>
        </div>
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-3.5 flex items-center gap-2.5">
          <div className="w-9 h-9 bg-amber-700/10 rounded-lg flex items-center justify-center">
            <ModelIcon model="claude-sonnet-4-6" size={18} />
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Model</div>
            <div className="text-sm font-semibold text-slate-200">claude-sonnet-4-6</div>
          </div>
        </div>
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-3.5 flex items-center gap-2.5">
          <div className="w-9 h-9 bg-amber-500/10 rounded-lg flex items-center justify-center">
            <i className="fa-solid fa-tower-broadcast text-amber-500 text-[15px]" />
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Gateway</div>
            <div className="text-sm font-semibold text-amber-500">3 platforms</div>
          </div>
        </div>
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-3.5 flex items-center gap-2.5">
          <div className="w-9 h-9 bg-orange-500/10 rounded-lg flex items-center justify-center">
            {cloud && <CloudIcon cloud={cloud} className="text-[17px]" />}
          </div>
          <div>
            <div className="text-[11px] text-slate-500">Infrastructure</div>
            <div className="text-sm font-semibold text-slate-200">{cloud ? `${cloud.toUpperCase()} ${region}` : '\u2014'}</div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        <StatCard icon="fa-solid fa-comments" label="Sessions" value={stats.totalSessions.toLocaleString()} sub={`\u2191 ${stats.todaySessions} today`} subColor="text-green-500" />
        <StatCard icon="fa-solid fa-message" label="Messages" value={formatTokens(stats.totalMessages)} sub={`\u2191 ${stats.todayMessages} today`} subColor="text-green-500" />
        <StatCard icon="fa-solid fa-wrench" label="Tool Calls" value={stats.totalToolCalls.toLocaleString()} sub="avg 4.5/session" />
        <StatCard icon="fa-solid fa-microchip" label="Total Tokens" value={formatTokens(stats.totalInputTokens + stats.totalOutputTokens)} sub={`in: ${formatTokens(stats.totalInputTokens)} \u00B7 out: ${formatTokens(stats.totalOutputTokens)}`} />
        <StatCard icon="fa-solid fa-dollar-sign" label="Est. Cost" value={`$${stats.totalCostUSD.toFixed(2)}`} sub={`\u2191 $${stats.todayCostUSD.toFixed(2)} today`} subColor="text-amber-500" />
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Recent Sessions */}
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <div className="text-[13px] font-semibold text-slate-200">
              <i className="fa-solid fa-clock-rotate-left mr-1.5 text-indigo-500" />Recent Sessions
            </div>
            <button
              className="text-[11px] text-indigo-500 hover:text-indigo-400"
              onClick={() => navigate({ page: 'agent', name, tab: 'sessions' })}
            >
              View all <i className="fa-solid fa-arrow-right text-[9px]" />
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {sessions.slice(0, 4).map((s) => {
              const isActive = !s.endedAt;
              const isFailed = s.endReason === 'error';
              return (
                <div key={s.id} className={`p-2.5 rounded-md flex items-center gap-2.5 ${isActive ? 'bg-green-500/5 border border-green-500/15' : 'bg-white/[0.02] border border-[#2a2d3a]'}`}>
                  {isActive ? (
                    <StatusPulse status="online" size={8} />
                  ) : isFailed ? (
                    <i className="fa-solid fa-circle-xmark text-red-500 text-[10px] flex-shrink-0" />
                  ) : (
                    <i className="fa-solid fa-circle-check text-slate-600 text-[10px] flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-slate-200 truncate">{s.title}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      <PlatformIcon platform={s.source} className="text-[10px] mr-1" />
                      {platformLabel(s.source)} · {s.messageCount} msgs · {timeAgo(s.startedAt)}
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 flex-shrink-0">${s.estimatedCostUSD.toFixed(2)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Activity + Platform */}
        <div className="flex flex-col gap-3">
          <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4 flex-1">
            <div className="text-[13px] font-semibold text-slate-200 mb-3">
              <i className="fa-solid fa-chart-bar mr-1.5 text-indigo-500" />Activity (7 days)
            </div>
            <div className="flex items-end gap-1 h-[60px]">
              {activityData.map((v, i) => (
                <div key={i} className="flex-1 rounded-t" style={{ height: `${v}%`, background: 'linear-gradient(to top, #4f46e5, #6366f1)' }} />
              ))}
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-slate-600">
              {days.map((d) => <span key={d}>{d}</span>)}
            </div>
          </div>

          <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4 flex-1">
            <div className="text-[13px] font-semibold text-slate-200 mb-3">
              <i className="fa-solid fa-chart-pie mr-1.5 text-indigo-500" />Platform Sources
            </div>
            <div className="flex flex-col gap-2">
              {platformBreakdown.map((p) => (
                <div key={p.platform} className="flex items-center gap-2">
                  <PlatformIcon platform={p.platform} className="text-[13px] w-4 text-center" />
                  <span className="text-[12px] text-slate-400 w-[60px]">{platformLabel(p.platform)}</span>
                  <div className="flex-1 h-1.5 bg-[#1e2030] rounded overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${p.pct}%`, background: 'linear-gradient(to right, #4f46e5, #6366f1)' }} />
                  </div>
                  <span className="text-[11px] text-slate-500 w-8 text-right">{p.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
