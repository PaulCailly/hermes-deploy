import type { FastifyInstance } from 'fastify';
import {
  runSqliteJson,
  readRemoteJson,
  listRemoteDir,
  readRemoteFile,
  writeRemoteFile,
  runRemoteCommand,
  withAgentLock,
  HERMES_HOME,
  resolveHermesHome,
} from '../agent-data-source.js';
import { StateStore } from '../../state/store.js';
import { getStatePaths } from '../../state/paths.js';

import { estimateCost } from '../model-pricing.js';

/** Extract and validate the ?profile= query param, return resolved HERMES_HOME path. */
function profileHome(query: { profile?: string }): string {
  return resolveHermesHome(query.profile);
}

function cronJobsPath(home: string): string {
  return `${home}/cron/jobs.json`;
}

// ---------- Configured model fallback ----------
// Newer hermes-agent versions may not write `model` to the sessions table.
// Fall back to the model configured in /etc/nixos/config.yaml.

const configuredModelCache = new Map<string, { model: string; expiresAt: number }>();
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getConfiguredModel(agentName: string, configPath?: string): Promise<string> {
  const cacheKey = `${agentName}:${configPath ?? 'default'}`;
  const cached = configuredModelCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.model;
  try {
    const path = configPath ?? '/etc/nixos/config.yaml';
    const yaml = await readRemoteFile(agentName, path);
    if (!yaml) return '';
    // Simple YAML parse: look for "default:" under "model:" section
    const match = yaml.match(/model:\s*\n\s+default:\s*(\S+)/);
    const model = match?.[1] ?? '';
    configuredModelCache.set(cacheKey, { model, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });
    return model;
  } catch {
    return '';
  }
}

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

function rowToSession(r: SessionRow, fallbackModel = ''): SessionDto {
  return {
    id: r.id,
    title: r.title ?? '(untitled)',
    source: r.source ?? 'unknown',
    model: r.model || fallbackModel,
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
    estimatedCostUSD: r.actual_cost_usd || r.estimated_cost_usd
      || estimateCost(r.model, r.input_tokens ?? 0, r.output_tokens ?? 0),
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
  // ---------- GET /api/agents/:name/profiles ----------
  app.get<{ Params: { name: string } }>('/api/agents/:name/profiles', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });

    const profiles: Array<{ name: string; path: string }> = [
      { name: 'default', path: HERMES_HOME },
    ];

    const dirs = await listRemoteDir(name, `${HERMES_HOME}/profiles`);
    for (const dir of dirs) {
      if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(dir)) {
        profiles.push({ name: dir, path: `${HERMES_HOME}/profiles/${dir}` });
      }
    }

    return profiles;
  });

  // ---------- GET /api/agents/:name/stats ----------
  app.get<{ Params: { name: string }; Querystring: { profile?: string } }>('/api/agents/:name/stats', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
    const home = profileHome(req.query);

    // Fetch per-session data so we can apply fallback pricing when
    // hermes-agent didn't record cost (e.g. Gemini models).
    const cfgModelPath = home === HERMES_HOME ? undefined : `${home}/config.yaml`;
    const [sessions, cfgModel] = await Promise.all([
      runSqliteJson<{
        model: string | null;
        started_at: string;
        message_count: number | null;
        tool_call_count: number | null;
        input_tokens: number | null;
        output_tokens: number | null;
        cache_read_tokens: number | null;
        cache_write_tokens: number | null;
        reasoning_tokens: number | null;
        actual_cost_usd: number | null;
        estimated_cost_usd: number | null;
      }>(name, `
        SELECT model, started_at, message_count, tool_call_count,
               input_tokens, output_tokens, cache_read_tokens,
               cache_write_tokens, reasoning_tokens,
               actual_cost_usd, estimated_cost_usd
        FROM sessions
      `.trim(), home),
      getConfiguredModel(name, cfgModelPath),
    ]);

    let totalSessions = 0, totalMessages = 0, totalToolCalls = 0;
    let totalInputTokens = 0, totalOutputTokens = 0;
    let totalCacheReadTokens = 0, totalCacheWriteTokens = 0, totalReasoningTokens = 0;
    let totalCostUSD = 0;
    let todaySessions = 0, todayMessages = 0, todayCostUSD = 0;

    const todayStr = new Date().toISOString().slice(0, 10);

    for (const s of sessions) {
      totalSessions++;
      totalMessages += s.message_count ?? 0;
      totalToolCalls += s.tool_call_count ?? 0;
      totalInputTokens += s.input_tokens ?? 0;
      totalOutputTokens += s.output_tokens ?? 0;
      totalCacheReadTokens += s.cache_read_tokens ?? 0;
      totalCacheWriteTokens += s.cache_write_tokens ?? 0;
      totalReasoningTokens += s.reasoning_tokens ?? 0;

      const cost = s.actual_cost_usd || s.estimated_cost_usd
        || estimateCost(s.model || cfgModel, s.input_tokens ?? 0, s.output_tokens ?? 0);
      totalCostUSD += cost;

      const sessionDate = new Date(
        typeof s.started_at === 'string' && s.started_at.length > 10
          ? s.started_at
          : Number(s.started_at) * 1000,
      ).toISOString().slice(0, 10);
      if (sessionDate === todayStr) {
        todaySessions++;
        todayMessages += s.message_count ?? 0;
        todayCostUSD += cost;
      }
    }

    return {
      totalSessions, totalMessages, totalToolCalls,
      totalInputTokens, totalOutputTokens,
      totalCacheReadTokens, totalCacheWriteTokens, totalReasoningTokens,
      totalCostUSD: Math.round(totalCostUSD * 1_000_000) / 1_000_000,
      todaySessions, todayMessages,
      todayCostUSD: Math.round(todayCostUSD * 1_000_000) / 1_000_000,
    };
  });

  // ---------- GET /api/agents/:name/sessions ----------
  app.get<{
    Params: { name: string };
    Querystring: { limit?: string; platform?: string; q?: string; profile?: string };
  }>('/api/agents/:name/sessions', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
    const home = profileHome(req.query);

    // Clamp to [1, 500]. Negative/zero/NaN/undefined all fall back to default 50.
    const parsedLimit = parseInt(req.query.limit ?? '50', 10);
    const limit = !Number.isFinite(parsedLimit) || parsedLimit <= 0
      ? 50
      : Math.min(parsedLimit, 500);

    // Build WHERE clauses (SQL-escape LIKE search; whitelist platform).
    const clauses: string[] = [];
    if (req.query.q) {
      const q = req.query.q.replace(/'/g, "''").replace(/\\/g, '\\\\');
      clauses.push(`title LIKE '%${q}%'`);
    }
    if (req.query.platform && req.query.platform !== 'all') {
      // Only allow alphanumeric platform names — defense in depth against injection.
      if (/^[A-Za-z0-9_-]+$/.test(req.query.platform)) {
        const p = req.query.platform.toLowerCase().replace(/'/g, "''");
        clauses.push(`LOWER(source) = '${p}'`);
      }
    }
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const cfgModelPath = home === HERMES_HOME ? undefined : `${home}/config.yaml`;
    const [rows, fallbackModel] = await Promise.all([
      runSqliteJson<SessionRow>(name, `
        SELECT ${SESSION_COLUMNS}
        FROM sessions
        ${whereClause}
        ORDER BY started_at DESC
        LIMIT ${limit}
      `.trim(), home),
      getConfiguredModel(name, cfgModelPath),
    ]);

    return rows.map(r => rowToSession(r, fallbackModel));
  });

  // ---------- GET /api/agents/:name/sessions/:sid/messages ----------
  app.get<{ Params: { name: string; sid: string }; Querystring: { profile?: string } }>(
    '/api/agents/:name/sessions/:sid/messages',
    async (req, reply) => {
      const { name, sid } = req.params;
      if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
      const home = profileHome(req.query);

      // Sanitize sid — only allow alphanumeric, underscore, hyphen
      if (!/^[A-Za-z0-9_-]+$/.test(sid)) {
        return reply.code(400).send({ error: 'invalid session id' });
      }

      const rows = await runSqliteJson<MessageRow>(name, `
        SELECT id, session_id, role, content, tool_calls, tool_call_id, reasoning, timestamp, token_count
        FROM messages
        WHERE session_id = '${sid}'
        ORDER BY timestamp ASC
      `.trim(), home);

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
  app.get<{ Params: { name: string }; Querystring: { profile?: string } }>('/api/agents/:name/skills', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
    const home = profileHome(req.query);

    const categories = await listRemoteDir(name, `${home}/skills`);
    const result: Array<{ name: string; skills: Array<{ id: string; name: string; category: string; files: string[]; requiredConfig: string[] }> }> = [];

    for (const cat of categories) {
      const skills = await listRemoteDir(name, `${home}/skills/${cat}`);
      if (skills.length === 0) continue;
      const catSkills = await Promise.all(skills.map(async (skillName) => {
        const files = await listRemoteDir(name, `${home}/skills/${cat}/${skillName}`);
        const yamlBody = await readRemoteFile(name, `${home}/skills/${cat}/${skillName}/skill.yaml`);
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
  app.get<{ Params: { name: string; category: string; skill: string; file: string }; Querystring: { profile?: string } }>(
    '/api/agents/:name/skills/:category/:skill/:file',
    async (req, reply) => {
      const { name, category, skill, file } = req.params;
      if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
      const home = profileHome(req.query);
      if ([category, skill, file].some((p) => p.includes('..') || p.includes('/'))) {
        return reply.code(400).send({ error: 'invalid path' });
      }
      const body = await readRemoteFile(name, `${home}/skills/${category}/${skill}/${file}`);
      if (body === null) return reply.code(404).send({ error: 'file not found' });
      return reply.type('text/plain').send(body);
    },
  );

  // ---------- PUT /api/agents/:name/skills/:category/:skill/:file ----------
  // Write an existing skill file with an editable extension. Only allows
  // modifying files that already exist under the enumerated skill path
  // (prevents arbitrary file creation) and only editable extensions
  // (prevents overwriting executable scripts).
  const EDITABLE_SKILL_EXTS = ['.md', '.txt', '.yaml', '.yml', '.json'];
  app.put<{
    Params: { name: string; category: string; skill: string; file: string };
    Querystring: { profile?: string };
  }>(
    '/api/agents/:name/skills/:category/:skill/:file',
    async (req, reply) => {
      const { name, category, skill, file } = req.params;
      if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
      const home = profileHome(req.query);
      if ([category, skill, file].some((p) => p.includes('..') || p.includes('/') || p.startsWith('.'))) {
        return reply.code(400).send({ error: 'invalid path' });
      }
      const lower = file.toLowerCase();
      if (!EDITABLE_SKILL_EXTS.some((ext) => lower.endsWith(ext))) {
        return reply.code(400).send({ error: `file extension not editable (allowed: ${EDITABLE_SKILL_EXTS.join(', ')})` });
      }

      // Verify the file already exists under the skill directory. We only
      // permit edits to files enumerated by the skill listing — no new-file
      // creation via this endpoint.
      const existingFiles = await listRemoteDir(name, `${home}/skills/${category}/${skill}`);
      if (!existingFiles.includes(file)) {
        return reply.code(404).send({ error: 'file not found in skill directory' });
      }

      // Accept body as text (Fastify default is JSON; treat body as string)
      let content: string;
      if (typeof req.body === 'string') {
        content = req.body;
      } else if (req.body && typeof req.body === 'object' && 'content' in (req.body as Record<string, unknown>)) {
        content = String((req.body as Record<string, unknown>).content ?? '');
      } else {
        return reply.code(400).send({ error: 'body required (text/plain or {content})' });
      }

      try {
        await writeRemoteFile(name, `${home}/skills/${category}/${skill}/${file}`, content);
        return { ok: true };
      } catch (e: unknown) {
        return reply.code(500).send({ error: e instanceof Error ? e.message : 'write failed' });
      }
    },
  );

  // ---------- GET /api/agents/:name/cron ----------
  app.get<{ Params: { name: string }; Querystring: { profile?: string } }>('/api/agents/:name/cron', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
    const home = profileHome(req.query);

    const data = await readRemoteJson<unknown>(name, cronJobsPath(home));
    if (!Array.isArray(data)) return [];
    return data.map(normalizeCronJob).filter(Boolean);
  });

  // ---------- GET /api/agents/:name/gateway ----------
  app.get<{ Params: { name: string }; Querystring: { profile?: string } }>('/api/agents/:name/gateway', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
    const home = profileHome(req.query);

    const data = await readRemoteJson<{
      pid?: number;
      kind?: string;
      gateway_state?: string;
      platforms?: Record<string, { state?: string; connected?: boolean }>;
      updated_at?: string;
    }>(name, `${home}/gateway_state.json`);

    if (!data) {
      return { isRunning: false, platforms: [] };
    }

    const platforms = Object.entries(data.platforms ?? {}).map(([pname, pstate]) => ({
      name: pname,
      // hermes-agent uses { state: "connected" }, older versions used { connected: true }
      connected: pstate?.state === 'connected' || Boolean(pstate?.connected),
      sessionCount: 0,
      trafficPercent: 0,
    }));

    return {
      isRunning: data.gateway_state === 'running',
      pid: data.pid,
      uptime: undefined,
      platforms,
    };
  });

  // ---------- POST /api/agents/:name/gateway/:action ----------
  // action: start | stop | restart
  app.post<{ Params: { name: string; action: string }; Querystring: { profile?: string } }>(
    '/api/agents/:name/gateway/:action',
    async (req, reply) => {
      const { name, action } = req.params;
      if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
      if (!['start', 'stop', 'restart'].includes(action)) {
        return reply.code(400).send({ error: 'invalid action' });
      }
      try {
        // Validate profile name before interpolating into shell command
        const home = profileHome(req.query);
        const profileFlag = home !== HERMES_HOME && req.query.profile
          ? `-p '${req.query.profile.replace(/'/g, "'\\''")}' `
          : '';
        const res = await runRemoteCommand(name, `hermes ${profileFlag}gateway ${action} 2>&1`);
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

  // ---------- GET /api/agents/:name/webhooks ----------
  app.get<{ Params: { name: string }; Querystring: { profile?: string } }>('/api/agents/:name/webhooks', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
    const home = profileHome(req.query);

    // 1. Check webhook health (the platform HTTP server on port 8644)
    let healthy = false;
    try {
      const healthRes = await runRemoteCommand(name, 'curl -sf http://localhost:8644/health 2>/dev/null');
      healthy = healthRes.exitCode === 0;
    } catch { /* not reachable */ }

    // 2. Read config.yaml for static webhook routes
    interface WebhookRouteConfig {
      events?: string[];
      action_filter?: string[];
      deliver?: string;
      deliver_extra?: Record<string, string>;
      prompt?: string;
      skills?: string[];
    }

    let configRoutes: Record<string, WebhookRouteConfig> = {};
    try {
      const parseRes = await runRemoteCommand(
        name,
        `PY=$(grep -ho "/nix/store/[^']*/bin/python3" /nix/store/*/bin/hermes 2>/dev/null | head -1) && cat ${home}/config.yaml | $PY -c "
import sys, yaml, json
cfg = yaml.safe_load(sys.stdin)
wh = cfg.get('platforms', {}).get('webhook', {}).get('extra', {}).get('routes', {})
json.dump(wh, sys.stdout)
"`,
      );
      if (parseRes.exitCode === 0 && parseRes.stdout) {
        configRoutes = JSON.parse(parseRes.stdout);
      }
    } catch { /* no config or parse error */ }

    // 3. Read dynamic webhook subscriptions
    const dynamicSubs = await readRemoteJson<Record<string, {
      events?: string[];
      action_filter?: string[];
      deliver?: string;
      deliver_extra?: Record<string, string>;
      prompt?: string;
      skills?: string[];
      created_at?: string;
    }>>(name, `${home}/webhook_subscriptions.json`);

    // 4. Merge routes
    const routes = [
      ...Object.entries(configRoutes).map(([rname, r]) => ({
        name: rname,
        events: r.events ?? [],
        actionFilter: r.action_filter,
        deliver: r.deliver ?? 'log',
        deliverExtra: r.deliver_extra,
        prompt: r.prompt,
        skills: r.skills,
        source: 'config' as const,
      })),
      ...Object.entries(dynamicSubs ?? {}).map(([rname, r]) => ({
        name: rname,
        events: r.events ?? [],
        actionFilter: r.action_filter,
        deliver: r.deliver ?? 'log',
        deliverExtra: r.deliver_extra,
        prompt: r.prompt,
        skills: r.skills,
        source: 'dynamic' as const,
        createdAt: r.created_at,
      })),
    ];

    // 5. Query recent webhook sessions from state.db with message details
    const recentDeliveries: Array<{
      id: string; route: string; event: string; action: string;
      status: string; timestamp: string; sessionId?: string;
      messageCount: number; endReason: string | null;
      detail?: string; duration?: number;
    }> = [];
    try {
      const rows = await runSqliteJson<{
        id: string;
        source: string | null;
        started_at: number;
        ended_at: number | null;
        end_reason: string | null;
        title: string | null;
        message_count: number | null;
      }>(
        name,
        `SELECT id, source, started_at, ended_at, end_reason, title, message_count
         FROM sessions
         WHERE source LIKE '%webhook%'
         ORDER BY started_at DESC
         LIMIT 50`,
        home,
      );
      for (const row of rows) {
        const parts = (row.source ?? '').split(':');
        const ts = typeof row.started_at === 'number'
          ? new Date(row.started_at * 1000).toISOString()
          : String(row.started_at);
        const duration = row.ended_at && row.started_at
          ? Math.round((row.ended_at - row.started_at) * 10) / 10
          : undefined;
        const isRunning = !row.ended_at;
        const status = isRunning ? 'running' : row.end_reason === 'error' ? 'error' : 'completed';
        recentDeliveries.push({
          id: parts.length > 2 ? (parts[2] ?? row.id) : row.id,
          route: parts.length > 1 ? (parts[1] ?? 'webhook') : 'webhook',
          event: row.title ?? 'webhook',
          action: '',
          status,
          timestamp: ts,
          sessionId: row.id,
          messageCount: row.message_count ?? 0,
          endReason: row.end_reason,
          duration,
        });
      }

      // Extract action/detail from first message of each recent session
      if (recentDeliveries.length > 0) {
        const sessionIds = recentDeliveries.slice(0, 20).map(d => d.sessionId).filter(Boolean);
        const detailRes = await runRemoteCommand(
          name,
          `PY=$(grep -ho "/nix/store/[^']*/bin/python3" /nix/store/*/bin/hermes 2>/dev/null | head -1) && $PY << 'PYEOF'
import json, os
sids = ${JSON.stringify(sessionIds)}
for sid in sids:
    path = f"${home}/sessions/session_{sid}.json"
    if not os.path.exists(path):
        print(json.dumps({"sid": sid}))
        continue
    try:
        with open(path) as f:
            d = json.load(f)
        msgs = d.get("messages", [])
        if not msgs:
            print(json.dumps({"sid": sid}))
            continue
        content = msgs[0].get("content", "")
        info = {"sid": sid}
        for line in content.split("\\n"):
            if line.startswith("Action: "):
                info["action"] = line[8:].strip()
            elif line.startswith("Moved to: "):
                info["moved_to"] = line[10:].strip()
            elif line.startswith("Moved from: "):
                info["moved_from"] = line[12:].strip()
            elif line.startswith("Field changed: "):
                info["field"] = line[15:].strip()
            elif line.startswith("Content type: "):
                info["content_type"] = line[14:].strip()
        # Get last assistant message as detail
        for m in reversed(msgs):
            if m.get("role") == "assistant":
                c = m.get("content", "")
                if c and len(c) < 500:
                    info["response"] = c[:200]
                break
        print(json.dumps(info))
    except:
        print(json.dumps({"sid": sid}))
PYEOF`,
        );
        if (detailRes.exitCode === 0 && detailRes.stdout) {
          const details = new Map<string, Record<string, string>>();
          for (const line of detailRes.stdout.trim().split('\n')) {
            try {
              const d = JSON.parse(line);
              if (d.sid) details.set(d.sid, d);
            } catch { /* skip */ }
          }
          for (const delivery of recentDeliveries) {
            const d = details.get(delivery.sessionId ?? '');
            if (d) {
              delivery.action = d.action ?? '';
              if (d.moved_to) {
                delivery.detail = `${d.moved_from ?? '?'} → ${d.moved_to}`;
              }
              if (d.response) {
                delivery.event = d.response.startsWith('skip') ? 'skipped' : delivery.event;
              }
            }
          }
        }
      }
    } catch { /* state.db may not exist */ }

    return { healthy, routes, recentDeliveries };
  });

  // ---------- GET /api/agents/:name/plugins ----------
  app.get<{ Params: { name: string }; Querystring: { profile?: string } }>('/api/agents/:name/plugins', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
    const home = profileHome(req.query);

    // Derive plugins dir from home — avoids using unvalidated query param
    const pluginsDir = home === HERMES_HOME
      ? '~/.hermes/plugins'
      : `${home}/plugins`;

    try {
      const res = await runRemoteCommand(
        name,
        `PY=$(grep -ho "/nix/store/[^']*/bin/python3" /nix/store/*/bin/hermes 2>/dev/null | head -1) && su - hermes -s /bin/sh -c "$PY -c \\"
import json, os, glob
try:
    from hermes_cli.plugins import discover_plugins, get_plugin_manager
    discover_plugins()
    mgr = get_plugin_manager()
    plugins = mgr.list_plugins()
    # Enrich with source files
    plugins_dir = os.path.expanduser('${pluginsDir}')
    for p in plugins:
        pname = p['name']
        pdir = os.path.join(plugins_dir, pname)
        files = {}
        if os.path.isdir(pdir):
            for fpath in sorted(glob.glob(os.path.join(pdir, '**'), recursive=True)):
                if os.path.isfile(fpath):
                    relpath = os.path.relpath(fpath, pdir)
                    try:
                        with open(fpath) as f:
                            files[relpath] = f.read()
                    except:
                        files[relpath] = '(could not read)'
        p['files'] = files
    json.dump(plugins, __import__('sys').stdout)
except Exception as e:
    json.dump([], __import__('sys').stdout)
\\""`,
      );
      if (res.exitCode === 0 && res.stdout) {
        return JSON.parse(res.stdout);
      }
      return [];
    } catch {
      return [];
    }
  });

  // ---------- WS /ws/agents/:name/sessions/:sid/messages ----------
  // Live stream of messages for an active session. Server polls the DB every
  // 2s and pushes the full message list when the count changes. On the
  // client, this replaces the React Query snapshot for the current session.
  app.get<{ Params: { name: string; sid: string }; Querystring: { profile?: string } }>(
    '/ws/agents/:name/sessions/:sid/messages',
    { websocket: true },
    async (socket, request) => {
      const { name, sid } = request.params;
      const home = profileHome(request.query as { profile?: string });
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
        `.trim(), home);

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
  app.get<{ Params: { name: string }; Querystring: { profile?: string } }>(
    '/ws/agents/:name/stats',
    { websocket: true },
    async (socket, request) => {
      const { name } = request.params;
      const home = profileHome(request.query as { profile?: string });
      if (!(await agentExists(name))) {
        socket.close(4004, 'agent not found');
        return;
      }

      let running = true;
      let lastKey = '';

      const pollOnce = async () => {
        const sessions = await runSqliteJson<{
          model: string | null;
          message_count: number | null;
          tool_call_count: number | null;
          input_tokens: number | null;
          output_tokens: number | null;
          actual_cost_usd: number | null;
          estimated_cost_usd: number | null;
        }>(name, `
          SELECT model, message_count, tool_call_count,
                 input_tokens, output_tokens,
                 actual_cost_usd, estimated_cost_usd
          FROM sessions
        `.trim(), home);

        let total_sessions = 0, total_messages = 0, total_tool_calls = 0;
        let total_input_tokens = 0, total_output_tokens = 0, total_cost_usd = 0;
        for (const s of sessions) {
          total_sessions++;
          total_messages += s.message_count ?? 0;
          total_tool_calls += s.tool_call_count ?? 0;
          total_input_tokens += s.input_tokens ?? 0;
          total_output_tokens += s.output_tokens ?? 0;
          total_cost_usd += s.actual_cost_usd ?? s.estimated_cost_usd
            ?? estimateCost(s.model, s.input_tokens ?? 0, s.output_tokens ?? 0);
        }
        total_cost_usd = Math.round(total_cost_usd * 1_000_000) / 1_000_000;

        const r = { total_sessions, total_messages, total_tool_calls, total_input_tokens, total_output_tokens, total_cost_usd };
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
  // Toggle the `enabled` field on a cron job
  app.patch<{ Params: { name: string; jobId: string }; Querystring: { profile?: string } }>(
    '/api/agents/:name/cron/:jobId/toggle',
    async (req, reply) => {
      const { name, jobId } = req.params;
      if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
      const home = profileHome(req.query);
      if (!/^[A-Za-z0-9_-]+$/.test(jobId)) {
        return reply.code(400).send({ error: 'invalid job id' });
      }

      return withAgentLock(name, async () => {
        const cronPath = cronJobsPath(home);
        const data = await readRemoteJson<unknown>(name, cronPath);
        if (!Array.isArray(data)) {
          reply.code(404).send({ error: 'jobs.json not found or invalid' });
          return;
        }

        const jobs = data as Array<Record<string, unknown>>;
        const job = jobs.find((j) => String(j.id ?? '') === jobId);
        if (!job) {
          reply.code(404).send({ error: 'job not found' });
          return;
        }
        job.enabled = !(job.enabled !== false);

        try {
          await writeRemoteFile(name, cronPath, JSON.stringify(jobs, null, 2));
          return { ok: true, enabled: job.enabled };
        } catch (e: unknown) {
          reply.code(500).send({ error: e instanceof Error ? e.message : 'write failed' });
        }
      });
    },
  );

  // ---------- POST /api/agents/:name/cron ----------
  // Create a new cron job. Server generates the id. Body includes name,
  // prompt, schedule ({kind, display?, expression?}), optional model/deliver.
  app.post<{ Params: { name: string }; Querystring: { profile?: string } }>('/api/agents/:name/cron', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
    const home = profileHome(req.query);

    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body.name !== 'string' || typeof body.prompt !== 'string') {
      return reply.code(400).send({ error: 'name and prompt required' });
    }

    return withAgentLock(name, async () => {
      const cronPath = cronJobsPath(home);
      const existing = await readRemoteJson<unknown>(name, cronPath);
      const jobs = Array.isArray(existing) ? (existing as Array<Record<string, unknown>>) : [];

      const newId = genCronId();
      const newJob: Record<string, unknown> = {
        id: newId,
        name: body.name,
        prompt: body.prompt,
        schedule: body.schedule ?? { kind: 'once', display: 'manual' },
        enabled: body.enabled !== false,
        state: 'scheduled',
      };
      if (typeof body.model === 'string') newJob.model = body.model;
      if (typeof body.deliver === 'string') newJob.deliver = body.deliver;
      if (Array.isArray(body.skills)) newJob.skills = body.skills;

      jobs.push(newJob);

      try {
        await writeRemoteFile(name, cronPath, JSON.stringify(jobs, null, 2));
        return { ok: true, id: newId };
      } catch (e: unknown) {
        reply.code(500).send({ error: e instanceof Error ? e.message : 'write failed' });
      }
    });
  });

  // ---------- PUT /api/agents/:name/cron/:jobId ----------
  // Update a cron job in place. Body replaces the updateable fields.
  app.put<{ Params: { name: string; jobId: string }; Querystring: { profile?: string } }>(
    '/api/agents/:name/cron/:jobId',
    async (req, reply) => {
      const { name, jobId } = req.params;
      if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
      const home = profileHome(req.query);
      if (!/^[A-Za-z0-9_-]+$/.test(jobId)) {
        return reply.code(400).send({ error: 'invalid job id' });
      }

      const body = req.body as Record<string, unknown> | null;
      if (!body) return reply.code(400).send({ error: 'body required' });

      return withAgentLock(name, async () => {
        const cronPath = cronJobsPath(home);
        const existing = await readRemoteJson<unknown>(name, cronPath);
        if (!Array.isArray(existing)) {
          reply.code(404).send({ error: 'jobs.json not found' });
          return;
        }

        const jobs = existing as Array<Record<string, unknown>>;
        const job = jobs.find((j) => String(j.id ?? '') === jobId);
        if (!job) {
          reply.code(404).send({ error: 'job not found' });
          return;
        }

        if (typeof body.name === 'string') job.name = body.name;
        if (typeof body.prompt === 'string') job.prompt = body.prompt;
        if (body.schedule && typeof body.schedule === 'object') job.schedule = body.schedule;
        if (typeof body.enabled === 'boolean') job.enabled = body.enabled;
        if (typeof body.model === 'string') job.model = body.model;
        if (body.model === null) delete job.model;
        if (typeof body.deliver === 'string') job.deliver = body.deliver;
        if (body.deliver === null) delete job.deliver;
        if (Array.isArray(body.skills)) job.skills = body.skills;

        try {
          await writeRemoteFile(name, cronPath, JSON.stringify(jobs, null, 2));
          return { ok: true };
        } catch (e: unknown) {
          reply.code(500).send({ error: e instanceof Error ? e.message : 'write failed' });
        }
      });
    },
  );

  // ---------- DELETE /api/agents/:name/cron/:jobId ----------
  app.delete<{ Params: { name: string; jobId: string }; Querystring: { profile?: string } }>(
    '/api/agents/:name/cron/:jobId',
    async (req, reply) => {
      const { name, jobId } = req.params;
      if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
      const home = profileHome(req.query);
      if (!/^[A-Za-z0-9_-]+$/.test(jobId)) {
        return reply.code(400).send({ error: 'invalid job id' });
      }

      return withAgentLock(name, async () => {
        const cronPath = cronJobsPath(home);
        const existing = await readRemoteJson<unknown>(name, cronPath);
        if (!Array.isArray(existing)) {
          reply.code(404).send({ error: 'jobs.json not found' });
          return;
        }

        const jobs = existing as Array<Record<string, unknown>>;
        const filtered = jobs.filter((j) => String(j.id ?? '') !== jobId);
        if (filtered.length === jobs.length) {
          reply.code(404).send({ error: 'job not found' });
          return;
        }

        try {
          await writeRemoteFile(name, cronPath, JSON.stringify(filtered, null, 2));
          return { ok: true };
        } catch (e: unknown) {
          reply.code(500).send({ error: e instanceof Error ? e.message : 'write failed' });
        }
      });
    },
  );
}

function genCronId(): string {
  // Short readable id: cron_<timestamp36><random36>
  return `cron_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
