import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { AgentHeader } from './AgentHeader';
import { AgentTabBar } from './AgentTabBar';
import { OverviewTab } from './OverviewTab';
import { SessionsTab } from './SessionsTab';
import { AnalyticsTab } from './AnalyticsTab';
import { SkillsTab } from './SkillsTab';
import { CronTab } from './CronTab';
import { GatewayTab } from './GatewayTab';
import { WebhooksTab } from './WebhooksTab';
import { PluginsTab } from './PluginsTab';
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
      case 'overview':  return <OverviewTab name={name} status={status} navigate={navigate} />;
      case 'sessions':  return <SessionsTab name={name} />;
      case 'analytics': return <AnalyticsTab name={name} />;
      case 'skills':    return <SkillsTab name={name} />;
      case 'cron':      return <CronTab name={name} />;
      case 'gateway':   return <GatewayTab name={name} />;
      case 'webhooks':  return <WebhooksTab name={name} />;
      case 'plugins':   return <PluginsTab name={name} />;
      case 'infra':     return <InfraTab name={name} status={status} navigate={navigate} />;
      case 'config':    return <ConfigTab name={name} />;
      case 'logs':      return <LogsTab name={name} />;
      case 'ssh':       return <SshTab name={name} />;
      case 'secrets':   return <SecretsTab name={name} />;
      default:          return null;
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
