import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import type {
  AgentStats, AgentSession, AgentMessage, AgentSkillCategory,
  AgentCronJob, AgentGatewayState,
} from './agent-types';

const REFETCH_MS = 15_000;

export function useAgentStats(name: string) {
  return useQuery({
    queryKey: ['agent-stats', name],
    queryFn: () => apiFetch<AgentStats>(`/api/agents/${encodeURIComponent(name)}/stats`),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}

export function useAgentSessions(name: string, opts?: { platform?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.platform && opts.platform !== 'all') params.set('platform', opts.platform);
  const qs = params.toString() ? `?${params.toString()}` : '';

  return useQuery({
    queryKey: ['agent-sessions', name, opts?.platform ?? 'all', opts?.limit ?? 50],
    queryFn: () => apiFetch<AgentSession[]>(`/api/agents/${encodeURIComponent(name)}/sessions${qs}`),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}

export function useAgentMessages(name: string, sessionId: string | null | undefined) {
  return useQuery({
    queryKey: ['agent-messages', name, sessionId],
    queryFn: () => apiFetch<AgentMessage[]>(`/api/agents/${encodeURIComponent(name)}/sessions/${encodeURIComponent(sessionId!)}/messages`),
    refetchInterval: REFETCH_MS,
    enabled: Boolean(sessionId),
    retry: false,
  });
}

export function useAgentSkills(name: string) {
  return useQuery({
    queryKey: ['agent-skills', name],
    queryFn: () => apiFetch<AgentSkillCategory[]>(`/api/agents/${encodeURIComponent(name)}/skills`),
    retry: false,
  });
}

export function useAgentSkillFile(name: string, category: string, skill: string, file: string) {
  return useQuery({
    queryKey: ['agent-skill-file', name, category, skill, file],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${encodeURIComponent(name)}/skills/${encodeURIComponent(category)}/${encodeURIComponent(skill)}/${encodeURIComponent(file)}`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    },
    enabled: Boolean(category && skill && file),
    retry: false,
  });
}

export function useAgentCron(name: string) {
  return useQuery({
    queryKey: ['agent-cron', name],
    queryFn: () => apiFetch<AgentCronJob[]>(`/api/agents/${encodeURIComponent(name)}/cron`),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}

export function useAgentGateway(name: string) {
  return useQuery({
    queryKey: ['agent-gateway', name],
    queryFn: () => apiFetch<AgentGatewayState>(`/api/agents/${encodeURIComponent(name)}/gateway`),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}

function getAuthHeader(): HeadersInit {
  const token = sessionStorage.getItem('hermes-deploy-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
