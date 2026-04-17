import type { FastifyInstance } from 'fastify';
import { StateStore } from '../../state/store.js';
import { getStatePaths } from '../../state/paths.js';
import { runSqliteJson, readRemoteJson } from '../agent-data-source.js';

// ---------- Per-agent row shapes ----------

interface AgentStatsRow {
  total_sessions: number;
  total_messages: number;
  total_tool_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  today_sessions: number;
  today_messages: number;
  today_cost_usd: number;
  active_sessions: number;
}

interface RecentSessionRow {
  id: string;
  title: string | null;
  source: string | null;
  started_at: string;
  ended_at: string | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  model: string | null;
}

interface CronJobJson {
  id?: string;
  name?: string;
  enabled?: boolean;
  nextRunAt?: string;
  schedule?: { display?: string; expression?: string; kind?: string };
}

const STATS_SQL = `
  SELECT
    COUNT(*) AS total_sessions,
    COALESCE(SUM(message_count), 0) AS total_messages,
    COALESCE(SUM(tool_call_count), 0) AS total_tool_calls,
    COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
    COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
    COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)), 0) AS total_cost_usd,
    SUM(CASE WHEN date(started_at, 'unixepoch') = date('now') THEN 1 ELSE 0 END) AS today_sessions,
    COALESCE(SUM(CASE WHEN date(started_at, 'unixepoch') = date('now') THEN message_count ELSE 0 END), 0) AS today_messages,
    COALESCE(SUM(CASE WHEN date(started_at, 'unixepoch') = date('now') THEN COALESCE(actual_cost_usd, estimated_cost_usd, 0) ELSE 0 END), 0) AS today_cost_usd,
    SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) AS active_sessions
  FROM sessions
`.trim();

const RECENT_SESSIONS_SQL = `
  SELECT id, title, source, started_at, ended_at, estimated_cost_usd, actual_cost_usd, model
  FROM sessions
  ORDER BY started_at DESC
  LIMIT 20
`.trim();

async function listAgents(): Promise<string[]> {
  const store = new StateStore(getStatePaths());
  const state = await store.read();
  return Object.keys(state.deployments);
}

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  // ---------- GET /api/org/stats ----------
  // Aggregate stats across all agents + per-agent breakdown for the fleet list
  app.get('/api/org/stats', async () => {
    const names = await listAgents();
    const results = await Promise.allSettled(
      names.map(async (name) => {
        const rows = await runSqliteJson<AgentStatsRow>(name, STATS_SQL);
        return { name, stats: rows[0] ?? null };
      }),
    );

    const perAgent: Array<{
      name: string;
      totalSessions: number;
      totalCostUSD: number;
      activeSessions: number;
      todayCostUSD: number;
    }> = [];

    let totalSessions = 0;
    let totalMessages = 0;
    let totalToolCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUSD = 0;
    let weekSessions = 0;
    let weekCostUSD = 0;
    let activeSessions = 0;

    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value.stats) continue;
      const s = r.value.stats;
      totalSessions += s.total_sessions ?? 0;
      totalMessages += s.total_messages ?? 0;
      totalToolCalls += s.total_tool_calls ?? 0;
      totalInputTokens += s.total_input_tokens ?? 0;
      totalOutputTokens += s.total_output_tokens ?? 0;
      totalCostUSD += s.total_cost_usd ?? 0;
      weekSessions += s.today_sessions ?? 0;
      weekCostUSD += s.today_cost_usd ?? 0;
      activeSessions += s.active_sessions ?? 0;

      perAgent.push({
        name: r.value.name,
        totalSessions: s.total_sessions ?? 0,
        totalCostUSD: s.total_cost_usd ?? 0,
        activeSessions: s.active_sessions ?? 0,
        todayCostUSD: s.today_cost_usd ?? 0,
      });
    }

    return {
      totalAgents: names.length,
      totalSessions,
      totalMessages,
      totalToolCalls,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCostUSD,
      weekSessions,
      weekCostUSD,
      activeSessions,
      perAgent: perAgent.sort((a, b) => b.totalCostUSD - a.totalCostUSD),
    };
  });

  // ---------- GET /api/org/activity ----------
  // Recent sessions across all agents (flattened, sorted, top N)
  app.get<{ Querystring: { limit?: string } }>('/api/org/activity', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '20', 10) || 20, 100);
    const names = await listAgents();
    const results = await Promise.allSettled(
      names.map(async (name) => {
        const rows = await runSqliteJson<RecentSessionRow>(name, RECENT_SESSIONS_SQL);
        return { name, rows };
      }),
    );

    const flat: Array<{
      id: string;
      agent: string;
      title: string;
      source: string;
      startedAt: string;
      active: boolean;
      estimatedCostUSD: number;
      model: string;
    }> = [];

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const row of r.value.rows) {
        flat.push({
          id: `${r.value.name}/${row.id}`,
          agent: r.value.name,
          title: row.title ?? '(untitled)',
          source: row.source ?? 'unknown',
          startedAt: row.started_at,
          active: !row.ended_at,
          estimatedCostUSD: row.actual_cost_usd ?? row.estimated_cost_usd ?? 0,
          model: row.model ?? '',
        });
      }
    }

    flat.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return flat.slice(0, limit);
  });

  // ---------- GET /api/org/crons ----------
  // Upcoming cron jobs across all agents (enabled only, sorted by next run)
  app.get('/api/org/crons', async () => {
    const names = await listAgents();
    const results = await Promise.allSettled(
      names.map(async (name) => {
        const data = await readRemoteJson<unknown>(name, '/var/lib/hermes/.hermes/cron/jobs.json');
        if (!Array.isArray(data)) return { name, jobs: [] as CronJobJson[] };
        return { name, jobs: data as CronJobJson[] };
      }),
    );

    const flat: Array<{
      id: string;
      agent: string;
      name: string;
      nextRun: string;
    }> = [];

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const j of r.value.jobs) {
        if (!j.enabled) continue;
        flat.push({
          id: `${r.value.name}/${j.id ?? ''}`,
          agent: r.value.name,
          name: j.name ?? '(unnamed)',
          nextRun: j.nextRunAt ?? j.schedule?.display ?? j.schedule?.expression ?? 'scheduled',
        });
      }
    }

    // Sort by presence of nextRunAt timestamp, else alphabetically
    flat.sort((a, b) => a.nextRun.localeCompare(b.nextRun));
    return flat.slice(0, 20);
  });

  // ---------- GET /api/org/skills ----------
  // Aggregate skills across all agents, deduplicated by category/name
  app.get('/api/org/skills', async () => {
    const names = await listAgents();
    const results = await Promise.allSettled(
      names.map(async (name) => {
        // Reuse the per-agent skills endpoint logic inline
        const { listRemoteDir, readRemoteFile } = await import('../agent-data-source.js');
        const cats = await listRemoteDir(name, '/var/lib/hermes/.hermes/skills');
        const cats2: Array<{ name: string; skills: Array<{ id: string; name: string; category: string; files: string[]; requiredConfig: string[]; agents: string[] }> }> = [];
        for (const cat of cats) {
          const skills = await listRemoteDir(name, `/var/lib/hermes/.hermes/skills/${cat}`);
          if (skills.length === 0) continue;
          const catSkills = await Promise.all(skills.map(async (skillName) => {
            const files = await listRemoteDir(name, `/var/lib/hermes/.hermes/skills/${cat}/${skillName}`);
            const yaml = await readRemoteFile(name, `/var/lib/hermes/.hermes/skills/${cat}/${skillName}/skill.yaml`);
            const requiredConfig = extractRequiredConfig(yaml ?? '');
            return {
              id: `${cat}/${skillName}`,
              name: skillName,
              category: cat,
              files,
              requiredConfig,
              agents: [name],
            };
          }));
          cats2.push({ name: cat, skills: catSkills });
        }
        return { name, categories: cats2 };
      }),
    );

    // Deduplicate by skill id, merge agents array
    const skillMap = new Map<string, { id: string; name: string; category: string; files: string[]; requiredConfig: string[]; agents: string[] }>();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const cat of r.value.categories) {
        for (const skill of cat.skills) {
          const existing = skillMap.get(skill.id);
          if (existing) {
            for (const a of skill.agents) if (!existing.agents.includes(a)) existing.agents.push(a);
          } else {
            skillMap.set(skill.id, { ...skill });
          }
        }
      }
    }

    // Group back into categories
    const catMap = new Map<string, Array<{ id: string; name: string; category: string; files: string[]; requiredConfig: string[]; agents: string[] }>>();
    for (const skill of skillMap.values()) {
      if (!catMap.has(skill.category)) catMap.set(skill.category, []);
      catMap.get(skill.category)!.push(skill);
    }

    return Array.from(catMap.entries()).map(([name, skills]) => ({ name, skills }));
  });
}

function extractRequiredConfig(yaml: string): string[] {
  const match = yaml.match(/required_config:\s*\n((?:\s+-\s+[^\n]+\n?)+)/);
  if (!match) return [];
  return match[1]!.split('\n')
    .map((l) => l.trim().replace(/^-\s*/, '').trim())
    .filter(Boolean);
}
