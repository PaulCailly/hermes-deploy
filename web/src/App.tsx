import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './lib/api';
import { AppShell } from './components/layout/AppShell';
import { AgentList } from './features/agents/AgentList';
import { AgentWorkspace } from './features/agent/AgentWorkspace';
import { NewDeploymentWizard } from './features/wizard/NewDeploymentWizard';
import { JobFullScreen } from './features/jobs/JobFullScreen';
import type { Route, Navigate } from './lib/types';
import type { DeploymentSummaryDto } from '@hermes/dto';

export function App() {
  const [route, setRoute] = useState<Route>({ page: 'dashboard' });

  const navigate: Navigate = (r) => setRoute(r);

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => apiFetch<DeploymentSummaryDto[]>('/api/deployments'),
    refetchInterval: 15_000,
  });

  function renderPage() {
    switch (route.page) {
      case 'dashboard':
        // Will be replaced by OrgDashboard in Plan 3
        return <AgentList agents={agents} navigate={navigate} />;

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
      {renderPage()}
    </AppShell>
  );
}
