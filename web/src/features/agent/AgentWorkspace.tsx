import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { AgentHeader } from './AgentHeader';
import { AgentTabBar } from './AgentTabBar';
import { InfraTab } from './InfraTab';
import { ConfigTab } from '../config/ConfigTab';
import { LogsTab } from '../logs/LogsTab';
import { SshTab } from '../ssh/SshTab';
import { SecretsTab } from '../secrets/SecretsTab';
import type { AgentTab, Navigate } from '../../lib/types';
import type { StatusPayloadDto } from '@hermes/dto';

interface AgentWorkspaceProps {
  name: string;
  tab: AgentTab;
  navigate: Navigate;
}

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-96 text-slate-500">
      <div className="text-center">
        <i className="fa-solid fa-hammer text-3xl mb-3 block text-slate-600" />
        <p className="text-sm">{label} — coming soon</p>
      </div>
    </div>
  );
}

export function AgentWorkspace({ name, tab, navigate }: AgentWorkspaceProps) {
  const { data: status } = useQuery({
    queryKey: ['agent-status', name],
    queryFn: () => apiFetch<StatusPayloadDto>(`/api/deployments/${encodeURIComponent(name)}`),
    refetchInterval: 20_000,
  });

  function onTabSelect(t: AgentTab) {
    navigate({ page: 'agent', name, tab: t });
  }

  function renderTab() {
    switch (tab) {
      case 'overview':  return <PlaceholderTab label="Overview" />;
      case 'sessions':  return <PlaceholderTab label="Sessions" />;
      case 'analytics': return <PlaceholderTab label="Analytics" />;
      case 'skills':    return <PlaceholderTab label="Skills" />;
      case 'cron':      return <PlaceholderTab label="Cron" />;
      case 'gateway':   return <PlaceholderTab label="Gateway" />;
      case 'infra':     return <InfraTab name={name} status={status} navigate={navigate} />;
      case 'config':    return <ConfigTab name={name} />;
      case 'logs':      return <LogsTab name={name} />;
      case 'ssh':       return <SshTab name={name} />;
      case 'secrets':   return <SecretsTab name={name} />;
      default:          return <PlaceholderTab label={tab} />;
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <AgentHeader name={name} status={status} />
      <AgentTabBar active={tab} onSelect={onTabSelect} />
      <div className="flex-1 overflow-auto bg-[#0f1117]">
        {renderTab()}
      </div>
    </div>
  );
}
