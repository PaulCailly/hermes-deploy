import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrgDashboard } from '../OrgDashboard';
import type { DeploymentSummaryDto } from '@hermes/dto';

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const mockAgents: DeploymentSummaryDto[] = [
  {
    name: 'hermes-prod',
    cloud: 'aws',
    region: 'eu-west-1',
    instanceIp: '10.0.0.1',
    storedHealth: 'healthy',
    lastDeployedAt: '2026-04-10T12:00:00Z',
  },
  {
    name: 'hermes-staging',
    cloud: 'gcp',
    region: 'us-central1',
    instanceIp: '10.0.0.2',
    storedHealth: 'unknown',
    lastDeployedAt: '2026-04-09T12:00:00Z',
  },
];

describe('OrgDashboard', () => {
  it('renders the dashboard title', () => {
    renderWithQuery(<OrgDashboard agents={mockAgents} navigate={() => {}} />);
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('renders stat cards', () => {
    renderWithQuery(<OrgDashboard agents={mockAgents} navigate={() => {}} />);
    expect(screen.getByText('Total Sessions')).toBeTruthy();
    expect(screen.getByText('Total Est. Cost')).toBeTruthy();
  });

  it('renders agent fleet', () => {
    renderWithQuery(<OrgDashboard agents={mockAgents} navigate={() => {}} />);
    expect(screen.getByText('Agent Fleet')).toBeTruthy();
    expect(screen.getAllByText('hermes-prod').length).toBeGreaterThan(0);
    expect(screen.getAllByText('hermes-staging').length).toBeGreaterThan(0);
  });

  it('renders with empty agents array', () => {
    renderWithQuery(<OrgDashboard agents={[]} navigate={() => {}} />);
    expect(screen.getByText('No agents deployed yet.')).toBeTruthy();
  });

  it('renders live activity section', () => {
    renderWithQuery(<OrgDashboard agents={mockAgents} navigate={() => {}} />);
    expect(screen.getByText('Live Activity')).toBeTruthy();
  });

  it('renders upcoming cron jobs', () => {
    renderWithQuery(<OrgDashboard agents={mockAgents} navigate={() => {}} />);
    expect(screen.getByText('Upcoming Cron Jobs')).toBeTruthy();
  });
});
