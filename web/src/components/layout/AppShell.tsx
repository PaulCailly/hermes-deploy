import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import type { Route, Navigate } from '../../lib/types';
import type { DeploymentSummaryDto } from '@hermes/dto';

interface AppShellProps {
  children: ReactNode;
  route: Route;
  navigate: Navigate;
  agents: DeploymentSummaryDto[];
}

export function AppShell({ children, route, navigate, agents }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-[#0f1117]">
      <Sidebar route={route} navigate={navigate} agents={agents} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
