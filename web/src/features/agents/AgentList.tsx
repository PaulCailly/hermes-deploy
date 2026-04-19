import { StatusPulse } from '../../components/shared/StatusPulse';
import { CloudIcon } from '../../components/shared/CloudIcon';
import type { Navigate } from '../../lib/types';
import type { DeploymentSummaryDto } from '@hermes/dto';

interface AgentListProps {
  agents: DeploymentSummaryDto[];
  navigate: Navigate;
}

function healthToStatus(h: string): 'online' | 'warning' | 'offline' {
  if (h === 'healthy') return 'online';
  if (h === 'unhealthy') return 'warning';
  return 'offline';
}

function healthLabel(h: string) {
  if (h === 'healthy') return { text: 'healthy', cls: 'text-green-400 bg-green-900/20' };
  if (h === 'unhealthy') return { text: 'unhealthy', cls: 'text-red-400 bg-red-900/20' };
  return { text: 'unknown', cls: 'text-yellow-400 bg-yellow-900/20' };
}

export function AgentList({ agents, navigate }: AgentListProps) {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-slate-200">
          <i className="fa-solid fa-robot mr-2 text-indigo-500" />
          Agents
        </h1>
        <button
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors"
          onClick={() => navigate({ page: 'new' })}
        >
          <i className="fa-solid fa-plus mr-1.5" />
          New Agent
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <i className="fa-solid fa-robot text-4xl mb-4 block text-slate-600" />
          <p className="text-sm mb-4">No agents yet</p>
          <button
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors"
            onClick={() => navigate({ page: 'new' })}
          >
            Create your first agent
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => {
            const h = healthLabel(agent.storedHealth);
            return (
              <button
                key={agent.name}
                className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4 text-left hover:border-indigo-500/30 transition-colors"
                onClick={() => navigate({ page: 'agent', name: agent.name, tab: 'overview' })}
              >
                <div className="flex items-center gap-2 mb-3">
                  <StatusPulse status={healthToStatus(agent.storedHealth)} size={8} />
                  <span className="font-semibold text-slate-200 text-sm truncate">{agent.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ml-auto ${h.cls}`}>{h.text}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-2">
                  <CloudIcon cloud={agent.cloud} className="text-[12px]" />
                  <span>{agent.cloud.toUpperCase()} {agent.region}</span>
                </div>
                {agent.instanceIp && (
                  <div className="text-[11px] text-slate-500 font-mono">{agent.instanceIp}</div>
                )}
                {agent.lastDeployedAt && (
                  <div className="text-[10px] text-slate-600 mt-2">
                    Deployed {new Date(agent.lastDeployedAt).toLocaleDateString()}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
