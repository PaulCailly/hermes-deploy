import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';
import { createWs } from './ws';
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

export interface CronJobInput {
  name: string;
  prompt: string;
  schedule: { kind: string; display?: string; expression?: string };
  enabled?: boolean;
  model?: string;
  deliver?: string;
  skills?: string[];
}

export function useCronCreate(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CronJobInput) =>
      apiFetch<{ ok: boolean; id: string }>(
        `/api/agents/${encodeURIComponent(name)}/cron`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-cron', name] });
      qc.invalidateQueries({ queryKey: ['org-crons'] });
    },
  });
}

export function useCronUpdate(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, input }: { jobId: string; input: CronJobInput }) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(name)}/cron/${encodeURIComponent(jobId)}`,
        { method: 'PUT', body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-cron', name] });
      qc.invalidateQueries({ queryKey: ['org-crons'] });
    },
  });
}

export function useCronDelete(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      apiFetch<{ ok: boolean }>(
        `/api/agents/${encodeURIComponent(name)}/cron/${encodeURIComponent(jobId)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-cron', name] });
      qc.invalidateQueries({ queryKey: ['org-crons'] });
    },
  });
}

// Skill file write
export function useSkillFileWrite(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ category, skill, file, content }: { category: string; skill: string; file: string; content: string }) => {
      const token = sessionStorage.getItem('hermes-deploy-token');
      const res = await fetch(
        `/api/agents/${encodeURIComponent(name)}/skills/${encodeURIComponent(category)}/${encodeURIComponent(skill)}/${encodeURIComponent(file)}`,
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
      const ws = createWs(`/ws/agents/${encodeURIComponent(name)}/sessions/${encodeURIComponent(sessionId)}/messages`);
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
  }, [name, sessionId, enabled]);

  return { messages, connected };
}

/**
 * Subscribe to live stats updates via WebSocket. Provides near-real-time
 * deltas when new sessions/messages are written.
 */
export function useLiveAgentStats(name: string, enabled: boolean): {
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
      const ws = createWs(`/ws/agents/${encodeURIComponent(name)}/stats`);
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
  }, [name, enabled]);

  return { data, connected };
}

// ---------- Helpers ----------

function getAuthHeader(): HeadersInit {
  const token = sessionStorage.getItem('hermes-deploy-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
