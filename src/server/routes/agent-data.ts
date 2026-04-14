import type { FastifyInstance } from 'fastify';
import {
  runSqliteJson,
  readRemoteJson,
  listRemoteDir,
  readRemoteFile,
  writeRemoteFile,
  runRemoteCommand,
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
    Querystring: { limit?: string; platform?: string; q?: string };
  }>('/api/agents/:name/sessions', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });

    const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 500);

    // Build WHERE clause with SQL-escaped search term for title
    let whereClause = '';
    if (req.query.q) {
      // Escape single quotes and % for LIKE — keep the query simple
      const q = req.query.q.replace(/'/g, "''").replace(/\\/g, '\\\\');
      whereClause = `WHERE title LIKE '%${q}%'`;
    }

    const rows = await runSqliteJson<SessionRow>(name, `
      SELECT ${SESSION_COLUMNS}
      FROM sessions
      ${whereClause}
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

  // ---------- POST /api/agents/:name/gateway/:action ----------
  // action: start | stop | restart
  app.post<{ Params: { name: string; action: string } }>(
    '/api/agents/:name/gateway/:action',
    async (req, reply) => {
      const { name, action } = req.params;
      if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
      if (!['start', 'stop', 'restart'].includes(action)) {
        return reply.code(400).send({ error: 'invalid action' });
      }
      try {
        const res = await runRemoteCommand(name, `hermes gateway ${action} 2>&1`);
        return reply.code(res.exitCode === 0 ? 200 : 500).send({
          ok: res.exitCode === 0,
          exitCode: res.exitCode,
          output: res.stdout || res.stderr,
        });
      } catch (e: unknown) {
        return reply.code(500).send({ error: e instanceof Error ? e.message : 'SSH failed' });
      }
    },
  );

  // ---------- WS /ws/agents/:name/sessions/:sid/messages ----------
  // Live stream of messages for an active session. Server polls the DB every
  // 2s and pushes the full message list when the count changes. On the
  // client, this replaces the React Query snapshot for the current session.
  app.get<{ Params: { name: string; sid: string } }>(
    '/ws/agents/:name/sessions/:sid/messages',
    { websocket: true },
    async (socket, request) => {
      const { name, sid } = request.params;
      if (!(await agentExists(name))) {
        socket.close(4004, 'agent not found');
        return;
      }
      if (!/^[A-Za-z0-9_-]+$/.test(sid)) {
        socket.close(4000, 'invalid session id');
        return;
      }

      let running = true;
      let lastCount = -1;
      let lastTs = '';

      const pollOnce = async () => {
        const rows = await runSqliteJson<{
          id: string; session_id: string; role: string; content: string | null;
          tool_calls: string | null; tool_call_id: string | null; reasoning: string | null;
          timestamp: string; token_count: number | null;
        }>(name, `
          SELECT id, session_id, role, content, tool_calls, tool_call_id, reasoning, timestamp, token_count
          FROM messages
          WHERE session_id = '${sid}'
          ORDER BY timestamp ASC
        `.trim());

        const lastRowTs = rows.length > 0 ? rows[rows.length - 1]!.timestamp : '';
        if (rows.length === lastCount && lastRowTs === lastTs) return;
        lastCount = rows.length;
        lastTs = lastRowTs;

        const items = rows.map((r) => ({
          id: r.id,
          sessionId: r.session_id,
          role: r.role,
          content: r.content ?? '',
          toolCalls: r.tool_calls ? safeParseToolCalls(r.tool_calls) : undefined,
          toolCallId: r.tool_call_id ?? undefined,
          reasoning: r.reasoning ?? undefined,
          timestamp: r.timestamp,
          tokenCount: r.token_count ?? 0,
        }));
        try {
          socket.send(JSON.stringify({ type: 'messages', items }));
        } catch {
          running = false;
        }
      };

      const loop = async () => {
        while (running) {
          await pollOnce().catch(() => {});
          await new Promise((r) => setTimeout(r, 2000));
        }
      };

      socket.on('close', () => { running = false; });
      socket.on('error', () => { running = false; });
      loop();
    },
  );

  // ---------- WS /ws/agents/:name/stats ----------
  // Live stats deltas (polled every 5s).
  app.get<{ Params: { name: string } }>(
    '/ws/agents/:name/stats',
    { websocket: true },
    async (socket, request) => {
      const { name } = request.params;
      if (!(await agentExists(name))) {
        socket.close(4004, 'agent not found');
        return;
      }

      let running = true;
      let lastKey = '';

      const pollOnce = async () => {
        const rows = await runSqliteJson<{
          total_sessions: number;
          total_messages: number;
          total_tool_calls: number;
          total_input_tokens: number;
          total_output_tokens: number;
          total_cost_usd: number;
        }>(name, `
          SELECT
            COUNT(*) AS total_sessions,
            COALESCE(SUM(message_count), 0) AS total_messages,
            COALESCE(SUM(tool_call_count), 0) AS total_tool_calls,
            COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
            COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
            COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)), 0) AS total_cost_usd
          FROM sessions
        `.trim());

        const r = rows[0];
        if (!r) return;
        const key = `${r.total_sessions}|${r.total_messages}|${r.total_tool_calls}|${r.total_input_tokens}|${r.total_output_tokens}|${r.total_cost_usd}`;
        if (key === lastKey) return;
        lastKey = key;
        try {
          socket.send(JSON.stringify({ type: 'stats', data: r }));
        } catch {
          running = false;
        }
      };

      const loop = async () => {
        while (running) {
          await pollOnce().catch(() => {});
          await new Promise((r) => setTimeout(r, 5000));
        }
      };

      socket.on('close', () => { running = false; });
      socket.on('error', () => { running = false; });
      loop();
    },
  );

  // ---------- PATCH /api/agents/:name/cron/:jobId/toggle ----------
  // Toggle the `enabled` field on a cron job in ~/.hermes/cron/jobs.json
  app.patch<{ Params: { name: string; jobId: string } }>(
    '/api/agents/:name/cron/:jobId/toggle',
    async (req, reply) => {
      const { name, jobId } = req.params;
      if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
      if (!/^[A-Za-z0-9_-]+$/.test(jobId)) {
        return reply.code(400).send({ error: 'invalid job id' });
      }

      const data = await readRemoteJson<unknown>(name, '~/.hermes/cron/jobs.json');
      if (!Array.isArray(data)) {
        return reply.code(404).send({ error: 'jobs.json not found or invalid' });
      }

      const jobs = data as Array<Record<string, unknown>>;
      const job = jobs.find((j) => String(j.id ?? '') === jobId);
      if (!job) {
        return reply.code(404).send({ error: 'job not found' });
      }
      job.enabled = !(job.enabled !== false);

      try {
        await writeRemoteFile(name, '~/.hermes/cron/jobs.json', JSON.stringify(jobs, null, 2));
        return { ok: true, enabled: job.enabled };
      } catch (e: unknown) {
        return reply.code(500).send({ error: e instanceof Error ? e.message : 'write failed' });
      }
    },
  );
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
