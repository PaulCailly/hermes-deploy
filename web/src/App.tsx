import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './lib/api';
import { AppShell } from './components/layout/AppShell';
import { ConnectionBanner } from './components/ConnectionBanner';
import { OrgDashboard } from './features/dashboard/OrgDashboard';
import { AgentList } from './features/agents/AgentList';
import { AgentWorkspace } from './features/agent/AgentWorkspace';
import { SkillsLibrary } from './features/library/SkillsLibrary';
import { TeamsPage } from './features/teams/TeamsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { NewDeploymentWizard } from './features/wizard/NewDeploymentWizard';
import { JobFullScreen } from './features/jobs/JobFullScreen';
import type { Route, Navigate } from './lib/types';
import type { DeploymentSummaryDto } from '@hermes/dto';

export function App() {
  const [route, setRoute] = useState<Route>({ page: 'dashboard' });
  const qc = useQueryClient();

  const navigate: Navigate = (r) => setRoute(r);

  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: () => apiFetch<DeploymentSummaryDto[]>('/api/deployments'),
    refetchInterval: 15_000,
    retry: false,
  });
  const agents = agentsQuery.data ?? [];
  const agentsError = agentsQuery.error instanceof Error ? agentsQuery.error : null;

  function renderPage() {
    switch (route.page) {
      case 'dashboard':
        return <OrgDashboard agents={agents} navigate={navigate} />;

      case 'agents':
        return <AgentList agents={agents} navigate={navigate} />;

      case 'agent':
        return (
          <AgentWorkspace
            name={route.name}
            tab={route.tab}
            navigate={navigate}
          />
        );

      case 'library':
        return <SkillsLibrary navigate={navigate} />;

      case 'teams':
        return <TeamsPage />;

      case 'settings':
        return <SettingsPage />;

      case 'new':
        return (
          <NewDeploymentWizard
            onCreated={(name) => navigate({ page: 'agent', name, tab: 'infra' })}
            onBack={() => navigate({ page: 'agents' })}
          />
        );

      case 'job':
        return (
          <JobFullScreen
            jobId={route.jobId}
            onBack={() => navigate({ page: 'agents' })}
          />
        );

      default:
        return <AgentList agents={agents} navigate={navigate} />;
    }
  }

  return (
    <AppShell route={route} navigate={navigate} agents={agents}>
      <ConnectionBanner
        error={agentsError}
        onRetry={() => qc.invalidateQueries({ queryKey: ['agents'] })}
      />
      {renderPage()}
    </AppShell>
  );
}
