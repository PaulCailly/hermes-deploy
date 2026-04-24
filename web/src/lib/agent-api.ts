import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';
import { createWs } from './ws';
import type {
  AgentStats, AgentSession, AgentMessage, AgentSkillCategory,
  AgentCronJob, AgentGatewayState, AgentWebhooksState, AgentPlugin,
} from './agent-types';

const REFETCH_MS = 15_000;

/** Build query string suffix for profile-scoped API calls. */
function profileQs(profile?: string, existingParams?: string): string {
  if (!profile || profile === 'default') return existingParams ? `?${existingParams}` : '';
  const sep = existingParams ? `${existingParams}&` : '';
  return `?${sep}profile=${encodeURIComponent(profile)}`;
}

// ---------- Profile hook ----------

export function useAgentProfiles(name: string) {
  return useQuery({
    queryKey: ['agent-profiles', name],
    queryFn: () => apiFetch<{ name: string; path: string }[]>(`/api/agents/${encodeURIComponent(name)}/profiles`),
    staleTime: 60_000,
    retry: false,
  });
}

// ---------- Per-agent hooks ----------

export function useAgentStats(name: string, profile?: string) {
  return useQuery({
    queryKey: ['agent-stats', name, profile ?? 'default'],
    queryFn: () => apiFetch<AgentStats>(`/api/agents/${encodeURIComponent(name)}/stats${profileQs(profile)}`),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}

export function useAgentSessions(name: string, opts?: { platform?: string; limit?: number; q?: string; profile?: string }) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.platform && opts.platform !== 'all') params.set('platform', opts.platform);
  if (opts?.q) params.set('q', opts.q);
  if (opts?.profile && opts.profile !== 'default') params.set('profile', opts.profile);
  const qs = params.toString() ? `?${params.toString()}` : '';

  return useQuery({
    queryKey: ['agent-sessions', name, opts?.platform ?? 'all', opts?.limit ?? 50, opts?.q ?? '', opts?.profile ?? 'default'],
    queryFn: () => apiFetch<AgentSession[]>(`/api/agents/${encodeURIComponent(name)}/sessions${qs}`),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}

export function useAgentMessages(name: string, sessionId: string | null | undefined, profile?: string) {
  return useQuery({
    queryKey: ['agent-messages', name, sessionId, profile ?? 'default'],
    queryFn: () => apiFetch<AgentMessage[]>(`/api/agents/${encodeURIComponent(name)}/sessions/${encodeURIComponent(sessionId!)}/messages${profileQs(profile)}`),
    refetchInterval: REFETCH_MS,
    enabled: Boolean(sessionId),
    retry: false,
  });
}

export function useAgentSkills(name: string, profile?: string) {
  return useQuery({
    queryKey: ['agent-skills', name, profile ?? 'default'],
    queryFn: () => apiFetch<AgentSkillCategory[]>(`/api/agents/${encodeURIComponent(name)}/skills${profileQs(profile)}`),
    retry: false,
  });
}

export function useAgentSkillFile(name: string, category: string, skill: string, file: string, profile?: string) {
  return useQuery({
    queryKey: ['agent-skill-file', name, category, skill, file, profile ?? 'default'],
    queryFn: async () => {
      const qs = profile && profile !== 'default' ? `?profile=${encodeURIComponent(profile)}` : '';
      const res = await fetch(`/api/agents/${encodeURIComponent(name)}/skills/${encodeURIComponent(category)}/${encodeURIComponent(skill)}/${encodeURIComponent(file)}${qs}`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    },
    enabled: Boolean(category && skill && file),
    retry: false,
  });
}

export function useAgentCron(name: string, profile?: string) {
  return useQuery({
    queryKey: ['agent-cron', name, profile ?? 'default'],
    queryFn: () => apiFetch<AgentCronJob[]>(`/api/agents/${encodeURIComponent(name)}/cron${profileQs(profile)}`),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}

export function useAgentGateway(name: string, profile?: string) {
  return useQuery({
    queryKey: ['agent-gateway', name, profile ?? 'default'],
    queryFn: () => apiFetch<AgentGatewayState>(`/api/agents/${encodeURIComponent(name)}/gateway${profileQs(profile)}`),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}

export function useAgentWebhooks(name: string, profile?: string) {
  return useQuery({
    queryKey: ['agent-webhooks', name, profile ?? 'default'],
    queryFn: () => apiFetch<AgentWebhooksState>(`/api/agents/${encodeURIComponent(name)}/webhooks${profileQs(profile)}`),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}

export function useAgentPlugins(name: string, profile?: string) {
  return useQuery({
    queryKey: ['agent-plugins', name, profile ?? 'default'],
    queryFn: () => apiFetch<AgentPlugin[]>(`/api/agents/${encodeURIComponent(name)}/plugins${profileQs(profile)}`),
    refetchInterval: 30_000,
    retry: false,
  });
}

// ---------- Mutations ----------

export function useGatewayAction(name: string, profile?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') =>
      apiFetch<{ ok: boolean; output: string }>(
        `/api/agents/${encodeURIComponent(name)}/gateway/${action}${profileQs(profile)}`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-gateway', name] });
    },
  });
}

export function useCronToggle(name: string, profile?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      apiFetch<{ ok: boolean; enabled: boolean }>(
        `/api/agents/${encodeURIComponent(name)}/cron/${encodeURIComponent(jobId)}/toggle${profileQs(profile)}`,
        { method: 'PATCH' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-cron', name] });
    },
  });
}

export interface CronJobInput {
  name: string;
  prompt: string;
  schedule: { kind: string; display?: string; expression?: string };
  enabled?: boolean;
  model?: string;
  deliver?: string;
  skills?: string[];
}

export function useCronCreate(name: string, profile?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CronJobInput) =>
      apiFetch<{ ok: boolean; id: string }>(
        `/api/agents/${encodeURIComponent(name)}/cron${profileQs(profile)}`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-cron', name] });
      qc.invalidateQueries({ queryKey: ['org-crons'] });
    },
  });
}

export function useCronUpdate(name: string, profile?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, input }: { jobId: string; input: CronJobInput }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(name)}/cron/${encodeURIComponent(jobId)}${profileQs(profile)}`,
        { method: 'PUT', body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-cron', name] });
      qc.invalidateQueries({ queryKey: ['org-crons'] });
    },
  });
}

export function useCronDelete(name: string, profile?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(name)}/cron/${encodeURIComponent(jobId)}${profileQs(profile)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-cron', name] });
      qc.invalidateQueries({ queryKey: ['org-crons'] });
    },
  });
}

// Skill file write
export function useSkillFileWrite(name: string, profile?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ category, skill, file, content }: { category: string; skill: string; file: string; content: string }) => {
      const token = sessionStorage.getItem('hermes-deploy-token');
      const qs = profile && profile !== 'default' ? `?profile=${encodeURIComponent(profile)}` : '';
      const res = await fetch(
        `/api/agents/${encodeURIComponent(name)}/skills/${encodeURIComponent(category)}/${encodeURIComponent(skill)}/${encodeURIComponent(file)}${qs}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'text/plain',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: content,
        },
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agent-skill-file', name, variables.category, variables.skill, variables.file] });
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
    profile: string;
    totalSessions: number;
    totalCostUSD: number;
    activeSessions: number;
    todayCostUSD: number;
  }>;
}

export interface OrgActivityItem {
  id: string;
  agent: string;
  profile: string;
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

// ---------- Live WebSocket hooks ----------

/**
 * Subscribe to live message updates for an active session via WebSocket.
 * Returns the latest messages array. Falls back to empty array until the
 * first message arrives. Pass `enabled=false` to skip the WS connection.
 */
export function useLiveAgentMessages(
  name: string,
  sessionId: string | null | undefined,
  enabled: boolean,
  profile?: string,
): { messages: AgentMessage[]; connected: boolean } {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!sessionId || !enabled) {
      setMessages([]);
      setConnected(false);
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      const qs = profile && profile !== 'default' ? `?profile=${encodeURIComponent(profile)}` : '';
      const ws = createWs(`/ws/agents/${encodeURIComponent(name)}/sessions/${encodeURIComponent(sessionId)}/messages${qs}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { ws.close(); return; }
        attempt = 0; // reset backoff on successful connect
        setConnected(true);
      };
      ws.onclose = () => {
        if (cancelled) return;
        if (wsRef.current !== ws) return;
        setConnected(false);
        // Reconnect with exponential backoff (1s, 2s, 4s, 8s, capped at 30s)
        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        if (wsRef.current === ws) setConnected(false);
      };
      ws.onmessage = (e) => {
        if (wsRef.current !== ws) return;
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'messages' && Array.isArray(data.items)) {
            setMessages(data.items as AgentMessage[]);
          }
        } catch {
          // ignore malformed frame
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, [name, sessionId, enabled, profile]);

  return { messages, connected };
}

/**
 * Subscribe to live stats updates via WebSocket. Provides near-real-time
 * deltas when new sessions/messages are written.
 */
export function useLiveAgentStats(name: string, enabled: boolean, profile?: string): {
  data: Partial<AgentStats> | undefined;
  connected: boolean;
} {
  const [data, setData] = useState<Partial<AgentStats> | undefined>(undefined);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      const qs = profile && profile !== 'default' ? `?profile=${encodeURIComponent(profile)}` : '';
      const ws = createWs(`/ws/agents/${encodeURIComponent(name)}/stats${qs}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { ws.close(); return; }
        attempt = 0;
        setConnected(true);
      };
      ws.onclose = () => {
        if (cancelled) return;
        if (wsRef.current !== ws) return;
        setConnected(false);
        const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        if (wsRef.current === ws) setConnected(false);
      };
      ws.onmessage = (e) => {
        if (wsRef.current !== ws) return;
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'stats' && msg.data) {
            setData({
              totalSessions: msg.data.total_sessions,
              totalMessages: msg.data.total_messages,
              totalToolCalls: msg.data.total_tool_calls,
              totalInputTokens: msg.data.total_input_tokens,
              totalOutputTokens: msg.data.total_output_tokens,
              totalCostUSD: msg.data.total_cost_usd,
            });
          }
        } catch {
          // ignore
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, [name, enabled, profile]);

  return { data, connected };
}

// ---------- Helpers ----------

function getAuthHeader(): HeadersInit {
  const token = sessionStorage.getItem('hermes-deploy-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
