import { StatCard } from '../../components/shared/StatCard';
import { StatusPulse } from '../../components/shared/StatusPulse';
import { CloudIcon } from '../../components/shared/CloudIcon';
import { PlatformIcon } from '../../components/shared/PlatformIcon';
import { ModelIcon } from '../../components/shared/ModelIcon';
import { getMockOrgStats, getMockLiveActivity, getMockUpcomingCrons } from '../../lib/mock-data';
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

// Mock per-agent cost data
const agentCosts = [
  { name: 'hermes-dev', cost: 52.11, pct: 100 },
  { name: 'hermes-prod', cost: 47.82, pct: 92 },
  { name: 'hermes-staging', cost: 38.42, pct: 74 },
  { name: 'agent-research', cost: 4.32, pct: 8 },
];

export function OrgDashboard({ agents, navigate }: OrgDashboardProps) {
  const org = getMockOrgStats();
  const activity = getMockLiveActivity();
  const crons = getMockUpcomingCrons();

  const healthyCount = agents.filter((a) => a.storedHealth === 'healthy').length;
  const offlineCount = agents.length - healthyCount;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-lg font-bold text-slate-200">
          <i className="fa-solid fa-gauge-high text-indigo-500 mr-2" />Dashboard
        </div>
        <div className="flex gap-0.5 bg-[#161822] border border-[#2a2d3a] rounded-md p-0.5">
          <span className="text-[11px] text-slate-500 px-2.5 py-1 rounded cursor-pointer">24h</span>
          <span className="text-[11px] text-slate-200 bg-indigo-500/20 px-2.5 py-1 rounded cursor-pointer font-medium">7d</span>
          <span className="text-[11px] text-slate-500 px-2.5 py-1 rounded cursor-pointer">30d</span>
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
            <span className="text-2xl font-bold text-slate-200">{agents.length || org.totalAgents}</span>
            <span className="text-[12px] text-green-500">{healthyCount || org.onlineAgents} online</span>
          </div>
        </div>
        <StatCard icon="fa-solid fa-comments" label="Total Sessions" value={org.totalSessions.toLocaleString()} sub={`\u2191 ${org.weekSessions} this week`} subColor="text-green-500" />
        <StatCard icon="fa-solid fa-microchip" label="Total Tokens" value={formatTokens(org.totalTokens)} sub={`in: ${formatTokens(org.inputTokens)} \u00B7 out: ${formatTokens(org.outputTokens)}`} />
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-3.5">
          <div className="flex items-center gap-1.5 mb-1">
            <i className="fa-solid fa-bolt text-[11px] text-slate-500" />
            <span className="text-[11px] text-slate-500">Active Now</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-green-500">{org.activeSessions}</span>
            <span className="text-[12px] text-slate-500">sessions</span>
          </div>
        </div>
        <StatCard icon="fa-solid fa-dollar-sign" label="Total Est. Cost" value={`$${org.totalCostUSD.toFixed(2)}`} sub={`\u2191 $${org.weekCostUSD.toFixed(2)} this week`} subColor="text-amber-500" />
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
            {agents.map((agent) => {
              const isHealthy = agent.storedHealth === 'healthy';
              return (
                <button
                  key={agent.name}
                  className={`flex items-center gap-3 p-2.5 bg-white/[0.02] border border-[#2a2d3a] rounded-md cursor-pointer hover:border-indigo-500/20 transition-colors ${!isHealthy ? 'opacity-50' : ''}`}
                  onClick={() => navigate({ page: 'agent', name: agent.name, tab: 'overview' })}
                >
                  <StatusPulse status={isHealthy ? 'online' : 'offline'} size={10} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-slate-200">{agent.name}</div>
                    <div className="text-[11px] text-slate-500">
                      <CloudIcon cloud={agent.cloud} className="text-[11px] mr-1" />
                      {agent.cloud.toUpperCase()} {agent.region}
                    </div>
                  </div>
                  <div className="text-right text-[11px]">
                    <div className="text-slate-400">{Math.floor(Math.random() * 1500 + 100)} sessions</div>
                    <div className="text-amber-500">${(Math.random() * 50 + 4).toFixed(2)}</div>
                  </div>
                </button>
              );
            })}
            {agents.length === 0 && (
              <div className="text-center py-8 text-slate-500 text-sm">
                No agents deployed yet.
                <button className="block mx-auto mt-2 text-indigo-500 hover:text-indigo-400" onClick={() => navigate({ page: 'new' })}>
                  Create your first agent
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Cost Per Agent */}
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <div className="text-[13px] font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-chart-bar text-indigo-500 mr-1.5" />Cost Per Agent (7d)
          </div>
          <div className="flex flex-col gap-2.5">
            {agentCosts.map((ac) => (
              <div key={ac.name}>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-slate-200">{ac.name}</span>
                  <span className="text-amber-500">${ac.cost.toFixed(2)}</span>
                </div>
                <div className="h-2 bg-[#1e2030] rounded overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${ac.pct}%`, background: 'linear-gradient(to right, #4f46e5, #6366f1)' }} />
                </div>
              </div>
            ))}
          </div>

          {/* Cost by Model */}
          <div className="mt-4 pt-3 border-t border-[#2a2d3a]">
            <div className="text-[11px] text-slate-500 mb-2"><i className="fa-solid fa-robot mr-1 text-indigo-500" />Cost by Model</div>
            <div className="flex gap-2">
              <div className="flex-1 bg-amber-700/5 border border-amber-700/15 rounded-md p-2 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <ModelIcon model="claude-sonnet-4-6" size={12} />
                  <span className="text-[10px] text-slate-500">Sonnet 4.6</span>
                </div>
                <div className="text-sm font-semibold text-amber-500">$108.20</div>
              </div>
              <div className="flex-1 bg-amber-700/3 border border-amber-700/10 rounded-md p-2 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <ModelIcon model="claude-haiku-4-5" size={12} />
                  <span className="text-[10px] text-slate-500">Haiku 4.5</span>
                </div>
                <div className="text-sm font-semibold text-amber-500">$34.47</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Live Activity + Crons */}
      <div className="grid grid-cols-[1.5fr_1fr] gap-4">
        {/* Live Activity */}
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <div className="text-[13px] font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-bolt text-amber-500 mr-1.5" />Live Activity
          </div>
          <div className="flex flex-col gap-1.5">
            {activity.map((a) => (
              <div key={a.id} className={`flex items-center gap-2 p-2 rounded ${a.active ? 'bg-green-500/[0.04]' : ''}`}>
                {a.active ? <StatusPulse status="online" size={8} /> : <i className="fa-solid fa-circle-check text-slate-600 text-[8px]" />}
                <span className={`text-[12px] flex-1 ${a.active ? 'text-slate-200' : 'text-slate-400'}`}>{a.title}</span>
                <span className="text-[10px] text-slate-500 bg-[#1e2030] px-1.5 py-0.5 rounded">{a.agent}</span>
                <span className="text-[10px] text-slate-500">
                  <PlatformIcon platform={a.source} className="text-[9px] mr-0.5" />{a.timeAgo}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Crons + Fleet Health */}
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <div className="text-[13px] font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-calendar-days text-indigo-500 mr-1.5" />Upcoming Cron Jobs
          </div>
          <div className="flex flex-col gap-2">
            {crons.map((c) => (
              <div key={c.id} className="flex items-center gap-2 p-2 bg-white/[0.02] border border-[#2a2d3a] rounded">
                <i className="fa-regular fa-clock text-indigo-500 text-[10px]" />
                <div className="flex-1">
                  <div className="text-[12px] text-slate-200">{c.name}</div>
                  <div className="text-[10px] text-slate-500">{c.agent} · {c.nextRun}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Fleet Health */}
          <div className="mt-3.5 pt-3 border-t border-[#2a2d3a]">
            <div className="text-[11px] text-slate-500 mb-2"><i className="fa-solid fa-heart-pulse mr-1 text-indigo-500" />Fleet Health</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center p-2 bg-green-500/5 rounded-md">
                <div className="text-lg font-bold text-green-500">{healthyCount || org.onlineAgents}</div>
                <div className="text-[10px] text-slate-500">healthy</div>
              </div>
              <div className="text-center p-2 bg-slate-500/5 rounded-md">
                <div className="text-lg font-bold text-slate-500">{offlineCount || (org.totalAgents - org.onlineAgents)}</div>
                <div className="text-[10px] text-slate-500">offline</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
