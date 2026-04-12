import { useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { DeploymentList } from './features/deployments/DeploymentList';
import { DeploymentDetail } from './features/detail/DeploymentDetail';
import { NewDeploymentWizard } from './features/wizard/NewDeploymentWizard';
import { JobFullScreen } from './features/jobs/JobFullScreen';

export type Route =
  | { page: 'home' }
  | { page: 'deployment'; name: string; tab?: string }
  | { page: 'new' }
  | { page: 'job'; jobId: string };

export function App() {
  const [route, setRoute] = useState<Route>({ page: 'home' });

  const navigate = (r: Route) => setRoute(r);

  let content;
  switch (route.page) {
    case 'home':
      content = <DeploymentList onSelect={(name) => navigate({ page: 'deployment', name })} onNew={() => navigate({ page: 'new' })} />;
      break;
    case 'deployment':
      content = (
        <DeploymentDetail
          name={route.name}
          initialTab={route.tab}
          onBack={() => navigate({ page: 'home' })}
          onJob={(jobId) => navigate({ page: 'job', jobId })}
        />
      );
      break;
    case 'new':
      content = <NewDeploymentWizard onBack={() => navigate({ page: 'home' })} onCreated={(name) => navigate({ page: 'deployment', name })} />;
      break;
    case 'job':
      content = <JobFullScreen jobId={route.jobId} onBack={() => navigate({ page: 'home' })} />;
      break;
  }

  return <AppShell onHome={() => navigate({ page: 'home' })}>{content}</AppShell>;
}
