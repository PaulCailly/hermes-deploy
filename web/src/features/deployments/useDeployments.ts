import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import type { DeploymentSummaryDto } from '@hermes/dto';

export function useDeployments() {
  return useQuery({
    queryKey: ['deployments'],
    queryFn: () => apiFetch<DeploymentSummaryDto[]>('/api/deployments'),
    refetchInterval: 15_000,
  });
}
