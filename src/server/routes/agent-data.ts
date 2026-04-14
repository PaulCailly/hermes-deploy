import type { FastifyInstance } from 'fastify';
import {
  runSqliteJson,
  readRemoteJson,
  listRemoteDir,
  readRemoteFile,
  AgentNotFoundError,
} from '../agent-data-source.js';
import { StateStore } from '../../state/store.js';
import { getStatePaths } from '../../state/paths.js';

// ---------- Row shapes (match Hermes state.db schema) ----------

interface SessionRow {
  id: string;
  source: string | null;
  user_id: string | null;
  model: string | null;
  title: string | null;
  parent_session_id: string | null;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  message_count: number | null;
  tool_call_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string | null;
  tool_calls: string | null; // JSON string
  tool_call_id: string | null;
  reasoning: string | null;
  timestamp: string;
  token_count: number | null;
}

// ---------- DTO shapes (sent to frontend) ----------

interface SessionDto {
  id: string;
  title: string;
  source: string;
  model: string;
  parentSessionId?: string;
  startedAt: string;
  endedAt?: string;
  endReason?: string;
  messageCount: number;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  estimatedCostUSD: number;
}

function rowToSession(r: SessionRow): SessionDto {
  return {
    id: r.id,
    title: r.title ?? '(untitled)',
    source: r.source ?? 'unknown',
    model: r.model ?? '',
    parentSessionId: r.parent_session_id ?? undefined,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? undefined,
    endReason: r.end_reason ?? undefined,
    messageCount: r.message_count ?? 0,
    toolCallCount: r.tool_call_count ?? 0,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    cacheReadTokens: r.cache_read_tokens ?? 0,
    cacheWriteTokens: r.cache_write_tokens ?? 0,
    reasoningTokens: r.reasoning_tokens ?? 0,
    estimatedCostUSD: r.actual_cost_usd ?? r.estimated_cost_usd ?? 0,
  };
}

// Validate agent exists in state store before any SSH work
async function agentExists(name: string): Promise<boolean> {
  const store = new StateStore(getStatePaths());
  const state = await store.read();
  return Boolean(state.deployments[name]);
}

const SESSION_COLUMNS = `
  id, source, user_id, model, title, parent_session_id,
  started_at, ended_at, end_reason,
  message_count, tool_call_count,
  input_tokens, output_tokens,
  cache_read_tokens, cache_write_tokens, reasoning_tokens,
  estimated_cost_usd, actual_cost_usd
`.trim().replace(/\s+/g, ' ');

export async function agentDataRoutes(app: FastifyInstance): Promise<void> {
  // ---------- GET /api/agents/:name/stats ----------
  app.get<{ Params: { name: string } }>('/api/agents/:name/stats', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });

    const rows = await runSqliteJson<{
      total_sessions: number;
      total_messages: number;
      total_tool_calls: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cache_read_tokens: number;
      total_cache_write_tokens: number;
      total_reasoning_tokens: number;
      total_cost_usd: number;
      today_sessions: number;
      today_messages: number;
      today_cost_usd: number;
    }>(name, `
      SELECT
        COUNT(*) AS total_sessions,
        COALESCE(SUM(message_count), 0) AS total_messages,
        COALESCE(SUM(tool_call_count), 0) AS total_tool_calls,
        COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) AS total_cache_read_tokens,
        COALESCE(SUM(cache_write_tokens), 0) AS total_cache_write_tokens,
        COALESCE(SUM(reasoning_tokens), 0) AS total_reasoning_tokens,
        COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)), 0) AS total_cost_usd,
        SUM(CASE WHEN date(started_at) = date('now') THEN 1 ELSE 0 END) AS today_sessions,
        COALESCE(SUM(CASE WHEN date(started_at) = date('now') THEN message_count ELSE 0 END), 0) AS today_messages,
        COALESCE(SUM(CASE WHEN date(started_at) = date('now') THEN COALESCE(actual_cost_usd, estimated_cost_usd, 0) ELSE 0 END), 0) AS today_cost_usd
      FROM sessions
    `.trim());

    const r = rows[0] ?? null;
    return {
      totalSessions: r?.total_sessions ?? 0,
      totalMessages: r?.total_messages ?? 0,
      totalToolCalls: r?.total_tool_calls ?? 0,
      totalInputTokens: r?.total_input_tokens ?? 0,
      totalOutputTokens: r?.total_output_tokens ?? 0,
      totalCacheReadTokens: r?.total_cache_read_tokens ?? 0,
      totalCacheWriteTokens: r?.total_cache_write_tokens ?? 0,
      totalReasoningTokens: r?.total_reasoning_tokens ?? 0,
      totalCostUSD: r?.total_cost_usd ?? 0,
      todaySessions: r?.today_sessions ?? 0,
      todayMessages: r?.today_messages ?? 0,
      todayCostUSD: r?.today_cost_usd ?? 0,
    };
  });

  // ---------- GET /api/agents/:name/sessions ----------
  app.get<{
    Params: { name: string };
    Querystring: { limit?: string; platform?: string };
  }>('/api/agents/:name/sessions', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });

    const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 500);
    // platform filter is applied client-side for simplicity (SQL injection risk otherwise)
    const rows = await runSqliteJson<SessionRow>(name, `
      SELECT ${SESSION_COLUMNS}
      FROM sessions
      ORDER BY started_at DESC
      LIMIT ${limit}
    `.trim());

    let sessions = rows.map(rowToSession);
    if (req.query.platform && req.query.platform !== 'all') {
      sessions = sessions.filter((s) => s.source.toLowerCase() === req.query.platform!.toLowerCase());
    }
    return sessions;
  });

  // ---------- GET /api/agents/:name/sessions/:sid/messages ----------
  app.get<{ Params: { name: string; sid: string } }>(
    '/api/agents/:name/sessions/:sid/messages',
    async (req, reply) => {
      const { name, sid } = req.params;
      if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });

      // Sanitize sid — only allow alphanumeric, underscore, hyphen
      if (!/^[A-Za-z0-9_-]+$/.test(sid)) {
        return reply.code(400).send({ error: 'invalid session id' });
      }

      const rows = await runSqliteJson<MessageRow>(name, `
        SELECT id, session_id, role, content, tool_calls, tool_call_id, reasoning, timestamp, token_count
        FROM messages
        WHERE session_id = '${sid}'
        ORDER BY timestamp ASC
      `.trim());

      return rows.map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        role: r.role as 'user' | 'assistant' | 'tool',
        content: r.content ?? '',
        toolCalls: r.tool_calls ? safeParseToolCalls(r.tool_calls) : undefined,
        toolCallId: r.tool_call_id ?? undefined,
        reasoning: r.reasoning ?? undefined,
        timestamp: r.timestamp,
        tokenCount: r.token_count ?? 0,
      }));
    },
  );

  // ---------- GET /api/agents/:name/skills ----------
  app.get<{ Params: { name: string } }>('/api/agents/:name/skills', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });

    const categories = await listRemoteDir(name, '~/.hermes/skills');
    const result: Array<{ name: string; skills: Array<{ id: string; name: string; category: string; files: string[]; requiredConfig: string[] }> }> = [];

    for (const cat of categories) {
      const skills = await listRemoteDir(name, `~/.hermes/skills/${cat}`);
      if (skills.length === 0) continue;
      const catSkills = await Promise.all(skills.map(async (skillName) => {
        const files = await listRemoteDir(name, `~/.hermes/skills/${cat}/${skillName}`);
        const yamlBody = await readRemoteFile(name, `~/.hermes/skills/${cat}/${skillName}/skill.yaml`);
        const requiredConfig = extractRequiredConfig(yamlBody ?? '');
        return {
          id: `${cat}/${skillName}`,
          name: skillName,
          category: cat,
          files,
          requiredConfig,
        };
      }));
      result.push({ name: cat, skills: catSkills });
    }
    return result;
  });

  // ---------- GET /api/agents/:name/skills/:category/:skill/:file ----------
  app.get<{ Params: { name: string; category: string; skill: string; file: string } }>(
    '/api/agents/:name/skills/:category/:skill/:file',
    async (req, reply) => {
      const { name, category, skill, file } = req.params;
      if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
      // Sanitize — no path traversal
      if ([category, skill, file].some((p) => p.includes('..') || p.includes('/'))) {
        return reply.code(400).send({ error: 'invalid path' });
      }
      const body = await readRemoteFile(name, `~/.hermes/skills/${category}/${skill}/${file}`);
      if (body === null) return reply.code(404).send({ error: 'file not found' });
      return reply.type('text/plain').send(body);
    },
  );

  // ---------- GET /api/agents/:name/cron ----------
  app.get<{ Params: { name: string } }>('/api/agents/:name/cron', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });

    const data = await readRemoteJson<unknown>(name, '~/.hermes/cron/jobs.json');
    if (!Array.isArray(data)) return [];
    return data.map(normalizeCronJob).filter(Boolean);
  });

  // ---------- GET /api/agents/:name/gateway ----------
  app.get<{ Params: { name: string } }>('/api/agents/:name/gateway', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });

    const data = await readRemoteJson<{
      pid?: number;
      kind?: string;
      gatewayState?: string;
      platforms?: Record<string, { connected?: boolean }>;
      updatedAt?: string;
    }>(name, '~/.hermes/gateway_state.json');

    if (!data) {
      return { isRunning: false, platforms: [] };
    }

    const platforms = Object.entries(data.platforms ?? {}).map(([pname, pstate]) => ({
      name: pname,
      connected: Boolean(pstate?.connected),
      sessionCount: 0, // Not tracked in gateway_state.json; would need separate query
      trafficPercent: 0,
    }));

    return {
      isRunning: data.gatewayState === 'running',
      pid: data.pid,
      uptime: undefined,
      platforms,
    };
  });
}

// ---------- Helpers ----------

function safeParseToolCalls(raw: string): Array<{
  callId: string;
  functionName: string;
  arguments: string;
  kind: string;
  summary: string;
}> | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.map((tc: { id?: string; call_id?: string; function?: { name?: string; arguments?: string }; name?: string; arguments?: string }) => {
      const fnName = tc.function?.name ?? tc.name ?? 'unknown';
      const args = tc.function?.arguments ?? tc.arguments ?? '';
      return {
        callId: tc.id ?? tc.call_id ?? '',
        functionName: fnName,
        arguments: typeof args === 'string' ? args : JSON.stringify(args),
        kind: classifyTool(fnName),
        summary: summarizeArgs(args),
      };
    });
  } catch {
    return undefined;
  }
}

function classifyTool(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('read') || n.includes('cat') || n.includes('file')) return 'read';
  if (n.includes('write') || n.includes('edit')) return 'edit';
  if (n.includes('exec') || n.includes('shell') || n.includes('terminal') || n.includes('bash')) return 'execute';
  if (n.includes('search') || n.includes('fetch') || n.includes('http') || n.includes('web')) return 'fetch';
  if (n.includes('browser')) return 'browser';
  return 'other';
}

function summarizeArgs(args: unknown): string {
  if (typeof args !== 'string') return '';
  try {
    const obj = JSON.parse(args) as Record<string, unknown>;
    const key = ['command', 'path', 'file', 'query', 'url'].find((k) => k in obj);
    if (key && typeof obj[key] === 'string') return String(obj[key]).slice(0, 100);
    return Object.keys(obj).slice(0, 3).join(', ');
  } catch {
    return args.slice(0, 100);
  }
}

function extractRequiredConfig(yaml: string): string[] {
  const match = yaml.match(/required_config:\s*\n((?:\s+-\s+[^\n]+\n?)+)/);
  if (!match) return [];
  return match[1]!.split('\n')
    .map((l) => l.trim().replace(/^-\s*/, '').trim())
    .filter(Boolean);
}

function normalizeCronJob(raw: unknown): {
  id: string;
  name: string;
  prompt: string;
  skills?: string[];
  model?: string;
  schedule: { kind: string; display?: string; expression?: string };
  enabled: boolean;
  state: 'scheduled' | 'running' | 'completed' | 'failed';
  deliver?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastError?: string;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  const sched = (j.schedule as Record<string, unknown> | undefined) ?? {};
  const state = String(j.state ?? 'scheduled');
  const validState: 'scheduled' | 'running' | 'completed' | 'failed' =
    state === 'running' || state === 'completed' || state === 'failed' ? state : 'scheduled';
  return {
    id: String(j.id ?? ''),
    name: String(j.name ?? '(unnamed)'),
    prompt: String(j.prompt ?? ''),
    skills: Array.isArray(j.skills) ? (j.skills as string[]) : undefined,
    model: typeof j.model === 'string' ? j.model : undefined,
    schedule: {
      kind: String(sched.kind ?? 'once'),
      display: typeof sched.display === 'string' ? sched.display : undefined,
      expression: typeof sched.expression === 'string' ? sched.expression : undefined,
    },
    enabled: j.enabled !== false,
    state: validState,
    deliver: typeof j.deliver === 'string' ? j.deliver : undefined,
    nextRunAt: typeof j.nextRunAt === 'string' ? j.nextRunAt : undefined,
    lastRunAt: typeof j.lastRunAt === 'string' ? j.lastRunAt : undefined,
    lastError: typeof j.lastError === 'string' ? j.lastError : undefined,
  };
}
