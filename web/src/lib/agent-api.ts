import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';
import type {
  AgentStats, AgentSession, AgentMessage, AgentSkillCategory,
  AgentCronJob, AgentGatewayState,
} from './agent-types';

const REFETCH_MS = 15_000;

// ---------- Per-agent hooks ----------

export function useAgentStats(name: string) {
  return useQuery({
    queryKey: ['agent-stats', name],
    queryFn: () => apiFetch<AgentStats>(`/api/agents/${encodeURIComponent(name)}/stats`),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}

export function useAgentSessions(name: string, opts?: { platform?: string; limit?: number; q?: string }) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.platform && opts.platform !== 'all') params.set('platform', opts.platform);
  if (opts?.q) params.set('q', opts.q);
  const qs = params.toString() ? `?${params.toString()}` : '';

  return useQuery({
    queryKey: ['agent-sessions', name, opts?.platform ?? 'all', opts?.limit ?? 50, opts?.q ?? ''],
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

// ---------- Mutations ----------

export function useGatewayAction(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') =>
      apiFetch<{ ok: boolean; output: string }>(
        `/api/agents/${encodeURIComponent(name)}/gateway/${action}`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-gateway', name] });
    },
  });
}

export function useCronToggle(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      apiFetch<{ ok: boolean; enabled: boolean }>(
        `/api/agents/${encodeURIComponent(name)}/cron/${encodeURIComponent(jobId)}/toggle`,
        { method: 'PATCH' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-cron', name] });
    },
  });
}

// ---------- Org-level hooks ----------

export interface OrgStats {
  totalAgents: number;
  totalSessions: number;
  totalMessages: number;
  totalToolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUSD: number;
  weekSessions: number;
  weekCostUSD: number;
  activeSessions: number;
  perAgent: Array<{
    name: string;
    totalSessions: number;
    totalCostUSD: number;
    activeSessions: number;
    todayCostUSD: number;
  }>;
}

export interface OrgActivityItem {
  id: string;
  agent: string;
  title: string;
  source: string;
  startedAt: string;
  active: boolean;
  estimatedCostUSD: number;
  model: string;
}

export interface OrgCronItem {
  id: string;
  agent: string;
  name: string;
  nextRun: string;
}

export interface OrgSkill {
  id: string;
  name: string;
  category: string;
  files: string[];
  requiredConfig: string[];
  agents: string[];
}

export interface OrgSkillCategory {
  name: string;
  skills: OrgSkill[];
}

export function useOrgStats() {
  return useQuery({
    queryKey: ['org-stats'],
    queryFn: () => apiFetch<OrgStats>('/api/org/stats'),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}

export function useOrgActivity() {
  return useQuery({
    queryKey: ['org-activity'],
    queryFn: () => apiFetch<OrgActivityItem[]>('/api/org/activity'),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}

export function useOrgCrons() {
  return useQuery({
    queryKey: ['org-crons'],
    queryFn: () => apiFetch<OrgCronItem[]>('/api/org/crons'),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}

export function useOrgSkills() {
  return useQuery({
    queryKey: ['org-skills'],
    queryFn: () => apiFetch<OrgSkillCategory[]>('/api/org/skills'),
    retry: false,
  });
}

// ---------- Helpers ----------

function getAuthHeader(): HeadersInit {
  const token = sessionStorage.getItem('hermes-deploy-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
