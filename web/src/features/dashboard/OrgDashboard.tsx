import { StatCard } from '../../components/shared/StatCard';
import { StatusPulse } from '../../components/shared/StatusPulse';
import { CloudIcon } from '../../components/shared/CloudIcon';
import { PlatformIcon } from '../../components/shared/PlatformIcon';
import { ModelIcon } from '../../components/shared/ModelIcon';
import { useOrgStats, useOrgActivity, useOrgCrons } from '../../lib/agent-api';
import type { Navigate } from '../../lib/types';
import type { DeploymentSummaryDto } from '@hermes/dto';

interface OrgDashboardProps {
  agents: DeploymentSummaryDto[];
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
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function OrgDashboard({ agents, navigate }: OrgDashboardProps) {
  const statsQ = useOrgStats();
  const activityQ = useOrgActivity();
  const cronsQ = useOrgCrons();

  const org = statsQ.data;
  const activity = activityQ.data ?? [];
  const crons = cronsQ.data ?? [];

  const healthyCount = agents.filter((a) => a.storedHealth === 'healthy').length;
  const offlineCount = agents.length - healthyCount;

  // Build per-agent display from stored agents + stats aggregate
  const agentStatsMap = new Map(org?.perAgent.map((a) => [a.name, a]) ?? []);
  const maxCost = Math.max(...(org?.perAgent.map((a) => a.totalCostUSD) ?? [0.01]), 0.01);
  const perAgentDisplay = agents.map((a) => {
    const s = agentStatsMap.get(a.name);
    return {
      agent: a,
      totalSessions: s?.totalSessions ?? 0,
      totalCostUSD: s?.totalCostUSD ?? 0,
      pct: s ? (s.totalCostUSD / maxCost) * 100 : 0,
    };
  }).sort((a, b) => b.totalCostUSD - a.totalCostUSD);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-lg font-bold text-slate-200">
          <i className="fa-solid fa-gauge-high text-indigo-500 mr-2" />Dashboard
        </div>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-5 gap-2.5 mb-5">
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-3.5">
          <div className="flex items-center gap-1.5 mb-1">
            <i className="fa-solid fa-robot text-[11px] text-slate-500" />
            <span className="text-[11px] text-slate-500">Agents</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-slate-200">{agents.length}</span>
            <span className="text-[12px] text-green-500">{healthyCount} online</span>
          </div>
        </div>
        <StatCard
          icon="fa-solid fa-comments"
          label="Total Sessions"
          value={statsQ.isLoading ? '…' : (org?.totalSessions ?? 0).toLocaleString()}
          sub={org && org.weekSessions > 0 ? `\u2191 ${org.weekSessions} today` : undefined}
          subColor="text-green-500"
        />
        <StatCard
          icon="fa-solid fa-microchip"
          label="Total Tokens"
          value={statsQ.isLoading ? '…' : formatTokens(org?.totalTokens ?? 0)}
          sub={org ? `in: ${formatTokens(org.totalInputTokens)} \u00B7 out: ${formatTokens(org.totalOutputTokens)}` : undefined}
        />
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-3.5">
          <div className="flex items-center gap-1.5 mb-1">
            <i className="fa-solid fa-bolt text-[11px] text-slate-500" />
            <span className="text-[11px] text-slate-500">Active Now</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-green-500">{org?.activeSessions ?? 0}</span>
            <span className="text-[12px] text-slate-500">sessions</span>
          </div>
        </div>
        <StatCard
          icon="fa-solid fa-dollar-sign"
          label="Total Est. Cost"
          value={statsQ.isLoading ? '…' : `$${(org?.totalCostUSD ?? 0).toFixed(2)}`}
          sub={org && org.weekCostUSD > 0 ? `\u2191 $${org.weekCostUSD.toFixed(2)} today` : undefined}
          subColor="text-amber-500"
        />
      </div>

      {/* Agent Fleet + Cost */}
      <div className="grid grid-cols-[1.5fr_1fr] gap-4 mb-4">
        {/* Agent Fleet */}
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <div className="text-[13px] font-semibold text-slate-200">
              <i className="fa-solid fa-server text-indigo-500 mr-1.5" />Agent Fleet
            </div>
            <button className="text-[11px] text-indigo-500 hover:text-indigo-400" onClick={() => navigate({ page: 'agents' })}>
              View all <i className="fa-solid fa-arrow-right text-[9px]" />
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {agents.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                No agents deployed yet.
                <button className="block mx-auto mt-2 text-indigo-500 hover:text-indigo-400" onClick={() => navigate({ page: 'new' })}>
                  Create your first agent
                </button>
              </div>
            ) : perAgentDisplay.map(({ agent, totalSessions, totalCostUSD }) => {
              const isHealthy = agent.storedHealth === 'healthy';
              return (
                <button
                  key={agent.name}
                  className={`flex items-center gap-3 p-2.5 bg-white/[0.02] border border-[#2a2d3a] rounded-md cursor-pointer hover:border-indigo-500/20 transition-colors ${!isHealthy ? 'opacity-60' : ''}`}
                  onClick={() => navigate({ page: 'agent', name: agent.name, tab: 'overview' })}
                >
                  <StatusPulse status={isHealthy ? 'online' : 'offline'} size={10} />
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-[13px] font-medium text-slate-200">{agent.name}</div>
                    <div className="text-[11px] text-slate-500">
                      <CloudIcon cloud={agent.cloud} className="text-[11px] mr-1" />
                      {agent.cloud.toUpperCase()} {agent.region}
                    </div>
                  </div>
                  <div className="text-right text-[11px]">
                    <div className="text-slate-400">{totalSessions.toLocaleString()} sessions</div>
                    <div className="text-amber-500">${totalCostUSD.toFixed(2)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Cost Per Agent */}
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <div className="text-[13px] font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-chart-bar text-indigo-500 mr-1.5" />Cost Per Agent
          </div>
          {statsQ.isLoading ? (
            <div className="text-slate-500 text-sm text-center py-6">Loading…</div>
          ) : perAgentDisplay.filter((a) => a.totalCostUSD > 0).length === 0 ? (
            <div className="text-slate-500 text-sm text-center py-6">No cost data yet</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {perAgentDisplay.filter((a) => a.totalCostUSD > 0).map((a) => (
                <div key={a.agent.name}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-200">{a.agent.name}</span>
                    <span className="text-amber-500">${a.totalCostUSD.toFixed(2)}</span>
                  </div>
                  <div className="h-2 bg-[#1e2030] rounded overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${a.pct}%`, background: 'linear-gradient(to right, #4f46e5, #6366f1)' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Live Activity + Crons */}
      <div className="grid grid-cols-[1.5fr_1fr] gap-4">
        {/* Live Activity */}
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <div className="text-[13px] font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-bolt text-amber-500 mr-1.5" />Live Activity
          </div>
          {activityQ.isLoading ? (
            <div className="text-slate-500 text-sm text-center py-6">Loading…</div>
          ) : activity.length === 0 ? (
            <div className="text-slate-500 text-sm text-center py-6">No recent activity</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {activity.slice(0, 8).map((a) => (
                <button
                  key={a.id}
                  className={`w-full flex items-center gap-2 p-2 rounded text-left ${a.active ? 'bg-green-500/[0.04]' : ''} hover:bg-white/[0.03] transition-colors`}
                  onClick={() => navigate({ page: 'agent', name: a.agent, tab: 'sessions' })}
                >
                  {a.active ? <StatusPulse status="online" size={8} /> : <i className="fa-solid fa-circle-check text-slate-600 text-[8px] flex-shrink-0" />}
                  <span className={`text-[12px] flex-1 truncate ${a.active ? 'text-slate-200' : 'text-slate-400'}`}>{a.title}</span>
                  <span className="text-[10px] text-slate-500 bg-[#1e2030] px-1.5 py-0.5 rounded flex-shrink-0">{a.agent}</span>
                  <span className="text-[10px] text-slate-500 flex-shrink-0">
                    <PlatformIcon platform={a.source} className="text-[9px] mr-0.5" />{timeAgo(a.startedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Crons + Fleet Health */}
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <div className="text-[13px] font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-calendar-days text-indigo-500 mr-1.5" />Upcoming Cron Jobs
          </div>
          {cronsQ.isLoading ? (
            <div className="text-slate-500 text-sm text-center py-4">Loading…</div>
          ) : crons.length === 0 ? (
            <div className="text-slate-500 text-sm text-center py-4">No scheduled jobs</div>
          ) : (
            <div className="flex flex-col gap-2">
              {crons.slice(0, 4).map((c) => (
                <button
                  key={c.id}
                  className="w-full flex items-center gap-2 p-2 bg-white/[0.02] border border-[#2a2d3a] rounded hover:border-indigo-500/20 text-left transition-colors"
                  onClick={() => navigate({ page: 'agent', name: c.agent, tab: 'cron' })}
                >
                  <i className="fa-regular fa-clock text-indigo-500 text-[10px]" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-slate-200 truncate">{c.name}</div>
                    <div className="text-[10px] text-slate-500">{c.agent} · {c.nextRun}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Fleet Health */}
          <div className="mt-3.5 pt-3 border-t border-[#2a2d3a]">
            <div className="text-[11px] text-slate-500 mb-2"><i className="fa-solid fa-heart-pulse mr-1 text-indigo-500" />Fleet Health</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center p-2 bg-green-500/5 rounded-md">
                <div className="text-lg font-bold text-green-500">{healthyCount}</div>
                <div className="text-[10px] text-slate-500">healthy</div>
              </div>
              <div className="text-center p-2 bg-slate-500/5 rounded-md">
                <div className="text-lg font-bold text-slate-500">{offlineCount}</div>
                <div className="text-[10px] text-slate-500">offline</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top model summary if we have data */}
      {org && org.totalCostUSD > 0 && (
        <div className="mt-4 bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <div className="text-[11px] text-slate-500 mb-2"><i className="fa-solid fa-robot mr-1 text-indigo-500" />Fleet Totals</div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <div className="text-[10px] text-slate-500">Messages</div>
              <div className="text-sm font-semibold text-slate-200">{formatTokens(org.totalMessages)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Tool Calls</div>
              <div className="text-sm font-semibold text-slate-200">{org.totalToolCalls.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Input Tokens</div>
              <div className="text-sm font-semibold text-slate-200">{formatTokens(org.totalInputTokens)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Output Tokens</div>
              <div className="text-sm font-semibold text-slate-200">{formatTokens(org.totalOutputTokens)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
