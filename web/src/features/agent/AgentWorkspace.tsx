import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { AgentHeader } from './AgentHeader';
import { AgentTabBar } from './AgentTabBar';
import { ProfileSwitcher } from './ProfileSwitcher';
import { OverviewTab } from './OverviewTab';
import { SessionsTab } from './SessionsTab';
import { AnalyticsTab } from './AnalyticsTab';
import { SkillsTab } from './SkillsTab';
import { CronTab } from './CronTab';
import { GatewayTab } from './GatewayTab';
import { WebhooksTab } from './WebhooksTab';
import { PluginsTab } from './PluginsTab';
import { InfraTab } from './InfraTab';
import { AgentUpdateBanner } from './AgentUpdateBanner';
import { ConfigTab } from '../config/ConfigTab';
import { LogsTab } from '../logs/LogsTab';
import { SshTab } from '../ssh/SshTab';
import { SecretsTab } from '../secrets/SecretsTab';
import type { AgentTab, Navigate } from '../../lib/types';
import type { StatusPayloadDto } from '@hermes/dto';

interface AgentWorkspaceProps {
  name: string;
  tab: AgentTab;
  profile?: string;
  navigate: Navigate;
}

export function AgentWorkspace({ name, tab, profile, navigate }: AgentWorkspaceProps) {
  const activeProfile = profile ?? 'default';

  const { data: status } = useQuery({
    queryKey: ['agent-status', name],
    queryFn: () => apiFetch<StatusPayloadDto>(`/api/deployments/${encodeURIComponent(name)}`),
    refetchInterval: 20_000,
  });

  function onTabSelect(t: AgentTab) {
    navigate({ page: 'agent', name, tab: t, profile: activeProfile });
  }

  function onProfileSelect(p: string) {
    navigate({ page: 'agent', name, tab, profile: p });
  }

  function renderTab() {
    switch (tab) {
      case 'overview':  return <OverviewTab name={name} profile={activeProfile} status={status} navigate={navigate} />;
      case 'sessions':  return <SessionsTab name={name} profile={activeProfile} />;
      case 'analytics': return <AnalyticsTab name={name} profile={activeProfile} />;
      case 'skills':    return <SkillsTab name={name} profile={activeProfile} />;
      case 'cron':      return <CronTab name={name} profile={activeProfile} />;
      case 'gateway':   return <GatewayTab name={name} profile={activeProfile} />;
      case 'webhooks':  return <WebhooksTab name={name} profile={activeProfile} />;
      case 'plugins':   return <PluginsTab name={name} profile={activeProfile} />;
      case 'infra':     return <InfraTab name={name} status={status} navigate={navigate} />;
      case 'config':    return <ConfigTab name={name} profile={activeProfile} />;
      case 'logs':      return <LogsTab name={name} />;
      case 'ssh':       return <SshTab name={name} />;
      case 'secrets':   return <SecretsTab name={name} />;
      default:          return null;
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <AgentHeader name={name} status={status} />
      <ProfileSwitcher
        name={name}
        activeProfile={activeProfile}
        activeTab={tab}
        onSelect={onProfileSelect}
      />
      <AgentTabBar active={tab} onSelect={onTabSelect} />
      <AgentUpdateBanner
        name={name}
        lockedRev={(status?.stored as any)?.hermes_agent_version?.lockedRev}
        lockedDate={(status?.stored as any)?.hermes_agent_version?.lockedDate}
        lockedTag={(status?.stored as any)?.hermes_agent_version?.lockedTag}
        navigate={navigate}
      />
      <div className="flex-1 overflow-auto bg-[#0f1117]">
        {renderTab()}
      </div>
    </div>
  );
}
