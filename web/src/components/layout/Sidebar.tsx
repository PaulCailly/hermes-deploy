import { StatusPulse } from '../shared/StatusPulse';
import type { Route, Navigate } from '../../lib/types';
import type { DeploymentSummaryDto } from '@hermes/dto';

interface SidebarProps {
  route: Route;
  navigate: Navigate;
  agents: DeploymentSummaryDto[];
}

function healthToStatus(h: string): 'online' | 'warning' | 'offline' {
  if (h === 'healthy') return 'online';
  if (h === 'unhealthy') return 'warning';
  return 'offline';
}

export function Sidebar({ route, navigate, agents }: SidebarProps) {
  const isActive = (page: string) =>
    route.page === page
      ? 'text-indigo-300 bg-indigo-500/10 border-l-2 border-indigo-500'
      : 'text-slate-400 border-l-2 border-transparent';

  const isAgentActive = (name: string) =>
    route.page === 'agent' && route.name === name;

  return (
    <aside className="w-[200px] bg-[#161822] border-r border-[#2a2d3a] flex flex-col flex-shrink-0 h-screen sticky top-0">
      {/* Logo */}
      <div
        className="px-4 py-4 pb-5 font-bold text-[15px] tracking-tight cursor-pointer"
        onClick={() => navigate({ page: 'dashboard' })}
      >
        <span className="text-slate-200">hermes</span>
        <span className="text-indigo-500">deploy</span>
      </div>

      {/* Overview Section */}
      <div className="px-4 text-[10px] uppercase text-slate-500 tracking-widest mb-1">Overview</div>
      <button
        className={`px-4 py-2 text-left text-[13px] ${isActive('dashboard')} hover:text-indigo-300 transition-colors`}
        onClick={() => navigate({ page: 'dashboard' })}
      >
        <i className="fa-solid fa-gauge-high mr-2 text-[12px]" />
        Dashboard
      </button>
      <button
        className={`px-4 py-2 text-left text-[13px] ${isActive('agents')} hover:text-indigo-300 transition-colors`}
        onClick={() => navigate({ page: 'agents' })}
      >
        <i className="fa-solid fa-robot mr-2 text-[12px]" />
        Agents
      </button>

      {/* Shared Resources */}
      <div className="px-4 text-[10px] uppercase text-slate-500 tracking-widest mt-4 mb-1">Shared Resources</div>
      <button
        className={`px-4 py-2 text-left text-[13px] ${isActive('library')} hover:text-indigo-300 transition-colors`}
        onClick={() => navigate({ page: 'library' })}
      >
        <i className="fa-solid fa-book mr-2 text-[12px]" />
        Skills Library
      </button>
      <button
        className={`px-4 py-2 text-left text-[13px] ${isActive('teams')} hover:text-indigo-300 transition-colors`}
        onClick={() => navigate({ page: 'teams' })}
      >
        <i className="fa-solid fa-users mr-2 text-[12px]" />
        Teams
      </button>
      <button
        className={`px-4 py-2 text-left text-[13px] ${isActive('settings')} hover:text-indigo-300 transition-colors`}
        onClick={() => navigate({ page: 'settings' })}
      >
        <i className="fa-solid fa-gear mr-2 text-[12px]" />
        Settings
      </button>

      {/* Agent Shortcuts */}
      <div className="px-4 text-[10px] uppercase text-slate-500 tracking-widest mt-4 mb-1">Agents</div>
      <div className="flex-1 overflow-y-auto">
        {agents.map((agent) => (
          <button
            key={agent.name}
            className={`w-full px-4 py-1.5 text-left text-[12px] flex items-center gap-2 hover:text-indigo-300 transition-colors ${
              isAgentActive(agent.name) ? 'text-indigo-300 bg-indigo-500/5' : 'text-slate-400'
            }`}
            onClick={() => navigate({ page: 'agent', name: agent.name, tab: 'overview' })}
          >
            <StatusPulse status={healthToStatus(agent.storedHealth)} size={6} />
            <span className="truncate">{agent.name}</span>
          </button>
        ))}
      </div>

      {/* New Agent Button */}
      <button
        className="px-4 py-2.5 text-[12px] text-indigo-500 hover:text-indigo-400 transition-colors border-t border-[#2a2d3a]"
        onClick={() => navigate({ page: 'new' })}
      >
        <i className="fa-solid fa-plus mr-1" />
        New Agent
      </button>
    </aside>
  );
}
