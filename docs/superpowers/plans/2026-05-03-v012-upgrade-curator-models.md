# v0.12.0 Upgrade, Curator & Models Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade hermes-agent to v0.12.0 on both deployed agents, enable the Curator, and add Curator + Models dashboard tabs to the web frontend.

**Architecture:** Two new backend routes (`/curator`, `/models`) read data over SSH from the agent's filesystem and state.db. Two new React tab components consume these via react-query hooks. Agent configs are updated in their respective deploy directories to enable the Curator. The actual upgrade + deploy are CLI operations run after the code changes.

**Tech Stack:** TypeScript, Fastify, React, TanStack Query, Tailwind CSS, SSH (via existing `agent-data-source.ts` helpers)

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `web/src/features/agent/CuratorTab.tsx` | Curator dashboard UI (status, run history, skill health, report) |
| `web/src/features/agent/ModelsTab.tsx` | Models dashboard UI (active models, usage stats, cost breakdown) |

### Modified files
| File | Change |
|------|--------|
| `web/src/lib/types.ts` | Add `'curator'` and `'models'` to `AGENT_TABS` |
| `web/src/lib/agent-types.ts` | Add Curator and Models response interfaces |
| `web/src/lib/agent-api.ts` | Add `useCurator()` and `useModels()` hooks |
| `web/src/features/agent/AgentTabBar.tsx` | Add curator and models to tab lists |
| `web/src/features/agent/AgentWorkspace.tsx` | Import + route new tabs |
| `src/server/routes/agent-data.ts` | Add `/curator` and `/models` GET routes |

### External files (agent deploy configs)
| File | Change |
|------|--------|
| `/Users/paulcailly/work/backresto/landing-jarvis/deploy/jarvis/config.yaml` | Add `auxiliary.curator` block |
| `/Users/paulcailly/workforce/apps/alberto/config.yaml` | Add `curator` to existing `auxiliary` block |

---

### Task 1: Create feature branch

**Files:** None (git operation)

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feat/v012-curator-models
```

- [ ] **Step 2: Verify clean state**

```bash
git status
```

Expected: clean working tree on `feat/v012-curator-models`, based on latest `main`.

---

### Task 2: Add Curator and Models types

**Files:**
- Modify: `web/src/lib/agent-types.ts`

- [ ] **Step 1: Add Curator and Models interfaces to agent-types.ts**

Append after the existing `AgentPlugin` interface (line 140):

```typescript
export interface CuratorRun {
  timestamp: string;
  skillsGraded: number;
  skillsPruned: number;
  skillsConsolidated: number;
  duration_s: number;
}

export interface SkillHealthEntry {
  name: string;
  usageCount: number;
  lastUsed: string | null;
  grade: string | null;
  status: 'active' | 'archived' | 'consolidated';
}

export interface CuratorResponse {
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
  runs: CuratorRun[];
  report: string | null;
  skillHealth: SkillHealthEntry[];
}

export interface ModelStats {
  model: string;
  totalSessions: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUSD: number;
  avgLatencyMs: number | null;
  lastUsed: string | null;
}

export interface ModelsResponse {
  config: {
    default: string;
    provider: string;
    auxiliary: Record<string, { model?: string; provider?: string }>;
  };
  stats: ModelStats[];
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/agent-types.ts
git commit -m "feat(types): add Curator and Models response interfaces"
```

---

### Task 3: Add tab type entries

**Files:**
- Modify: `web/src/lib/types.ts`

- [ ] **Step 1: Add curator and models to AGENT_TABS**

Change line 1-4 from:

```typescript
export const AGENT_TABS = [
  'overview', 'sessions', 'analytics', 'skills', 'cron', 'gateway', 'webhooks', 'plugins',
  'infra', 'config', 'logs', 'ssh', 'secrets',
] as const;
```

To:

```typescript
export const AGENT_TABS = [
  'overview', 'sessions', 'analytics', 'models', 'curator', 'skills', 'cron', 'gateway', 'webhooks', 'plugins',
  'infra', 'config', 'logs', 'ssh', 'secrets',
] as const;
```

- [ ] **Step 2: Verify types compile**

```bash
cd web && npx tsc --noEmit
```

Expected: errors in `AgentTabBar.tsx` (new tabs not yet in the arrays) and `AgentWorkspace.tsx` (missing switch cases). This is expected — we'll fix them in Tasks 6 and 7.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/types.ts
git commit -m "feat(types): add curator and models to AGENT_TABS union"
```

---

### Task 4: Add useCurator and useModels API hooks

**Files:**
- Modify: `web/src/lib/agent-api.ts`

- [ ] **Step 1: Add import for new types**

Change the import on line 6-8 from:

```typescript
import type {
  AgentStats, AgentSession, AgentMessage, AgentSkillCategory,
  AgentCronJob, AgentGatewayState, AgentWebhooksState, AgentPlugin,
} from './agent-types';
```

To:

```typescript
import type {
  AgentStats, AgentSession, AgentMessage, AgentSkillCategory,
  AgentCronJob, AgentGatewayState, AgentWebhooksState, AgentPlugin,
  CuratorResponse, ModelsResponse,
} from './agent-types';
```

- [ ] **Step 2: Add useCurator hook**

Add after the `useAgentPlugins` function (after line 124):

```typescript
export function useCurator(name: string, profile?: string) {
  return useQuery({
    queryKey: ['agent-curator', name, profile ?? 'default'],
    queryFn: () => apiFetch<CuratorResponse>(`/api/agents/${encodeURIComponent(name)}/curator${profileQs(profile)}`),
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useModels(name: string, profile?: string) {
  return useQuery({
    queryKey: ['agent-models', name, profile ?? 'default'],
    queryFn: () => apiFetch<ModelsResponse>(`/api/agents/${encodeURIComponent(name)}/models${profileQs(profile)}`),
    refetchInterval: 30_000,
    retry: false,
  });
}
```

- [ ] **Step 3: Verify types compile**

```bash
cd web && npx tsc --noEmit
```

Expected: no new errors from this file (hooks reference types that exist, routes don't exist yet but hooks are just functions).

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/agent-api.ts
git commit -m "feat(api): add useCurator and useModels hooks"
```

---

### Task 5: Add backend routes for Curator and Models

**Files:**
- Modify: `src/server/routes/agent-data.ts`

- [ ] **Step 1: Add Curator route**

Add the following route inside the `agentDataRoutes` function, before the closing `}` of the function (before line 1041). Insert it after the DELETE `/api/agents/:name/cron/:jobId` route block:

```typescript
  // ---------- GET /api/agents/:name/curator ----------
  app.get<{ Params: { name: string }; Querystring: { profile?: string } }>('/api/agents/:name/curator', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
    const home = profileHome(req.query);

    // Read curator config from the agent's config.yaml
    const configYaml = await readRemoteFile(name, `${home === HERMES_HOME ? '/etc/nixos' : home}/config.yaml`);
    const curatorEnabled = configYaml ? /curator:[\s\S]*?enabled:\s*true/.test(configYaml) : false;

    // Read curator run history
    const runsRaw = await readRemoteJson<unknown[]>(name, `${home}/logs/curator/run.json`);
    const runs = Array.isArray(runsRaw)
      ? runsRaw.map((r: any) => ({
          timestamp: String(r.timestamp ?? ''),
          skillsGraded: Number(r.skills_graded ?? r.skillsGraded ?? 0),
          skillsPruned: Number(r.skills_pruned ?? r.skillsPruned ?? 0),
          skillsConsolidated: Number(r.skills_consolidated ?? r.skillsConsolidated ?? 0),
          duration_s: Number(r.duration_s ?? r.duration ?? 0),
        }))
      : [];

    // Read latest curator report
    const report = await readRemoteFile(name, `${home}/logs/curator/REPORT.md`);

    // Read skill health from curator status output
    const healthRaw = await readRemoteJson<unknown[]>(name, `${home}/logs/curator/skill_health.json`);
    const skillHealth = Array.isArray(healthRaw)
      ? healthRaw.map((s: any) => ({
          name: String(s.name ?? ''),
          usageCount: Number(s.usage_count ?? s.usageCount ?? 0),
          lastUsed: s.last_used ?? s.lastUsed ?? null,
          grade: s.grade ?? null,
          status: s.status ?? 'active',
        }))
      : [];

    // Compute lastRun / nextRun from run history
    const lastRun = runs.length > 0 ? runs[runs.length - 1]!.timestamp : null;
    let nextRun: string | null = null;
    if (lastRun && curatorEnabled) {
      // Default 7-day cycle
      const cycleDaysMatch = configYaml?.match(/cycle_days:\s*(\d+)/);
      const cycleDays = cycleDaysMatch ? Number(cycleDaysMatch[1]) : 7;
      const next = new Date(new Date(lastRun).getTime() + cycleDays * 86_400_000);
      nextRun = next.toISOString();
    }

    return {
      enabled: curatorEnabled,
      lastRun,
      nextRun,
      runs,
      report,
      skillHealth,
    };
  });
```

- [ ] **Step 2: Add Models route**

Add directly after the Curator route:

```typescript
  // ---------- GET /api/agents/:name/models ----------
  app.get<{ Params: { name: string }; Querystring: { profile?: string } }>('/api/agents/:name/models', async (req, reply) => {
    const { name } = req.params;
    if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });
    const home = profileHome(req.query);

    // Read model config from the agent's config.yaml
    const configPath = home === HERMES_HOME ? '/etc/nixos/config.yaml' : `${home}/config.yaml`;
    const configYaml = await readRemoteFile(name, configPath);

    let configDefault = '';
    let configProvider = '';
    const configAuxiliary: Record<string, { model?: string; provider?: string }> = {};

    if (configYaml) {
      const defaultMatch = configYaml.match(/model:\s*\n\s+default:\s*(\S+)/);
      configDefault = defaultMatch?.[1] ?? '';
      const providerMatch = configYaml.match(/model:\s*\n(?:\s+\w+:.*\n)*?\s+provider:\s*(\S+)/);
      configProvider = providerMatch?.[1] ?? '';

      // Parse auxiliary section for model names
      const auxBlock = configYaml.match(/auxiliary:\s*\n((?:\s+\w[\s\S]*?)?)(?=\n\w|\n$|$)/);
      if (auxBlock?.[1]) {
        const auxLines = auxBlock[1].split('\n');
        let currentKey = '';
        for (const line of auxLines) {
          const keyMatch = line.match(/^\s{2}(\w+):\s*$/);
          if (keyMatch) {
            currentKey = keyMatch[1]!;
            configAuxiliary[currentKey] = {};
            continue;
          }
          if (currentKey) {
            const modelMatch = line.match(/^\s{4}model:\s*'?([^'\s]+)'?\s*$/);
            if (modelMatch && modelMatch[1]) configAuxiliary[currentKey]!.model = modelMatch[1];
            const provMatch = line.match(/^\s{4}provider:\s*'?([^'\s]+)'?\s*$/);
            if (provMatch && provMatch[1]) configAuxiliary[currentKey]!.provider = provMatch[1];
          }
        }
      }
    }

    // Query per-model stats from state.db
    const stats = await runSqliteJson<{
      model: string | null;
      total_sessions: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cost_usd: number;
      avg_latency_ms: number | null;
      last_used: string;
    }>(
      name,
      `SELECT
        model,
        COUNT(*) as total_sessions,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd, 0)), 0) as total_cost_usd,
        NULL as avg_latency_ms,
        MAX(started_at) as last_used
      FROM sessions
      WHERE model IS NOT NULL AND model != ''
      GROUP BY model
      ORDER BY total_sessions DESC`,
      home,
    );

    const fallbackModel = configDefault || await getConfiguredModel(name, configPath);

    return {
      config: {
        default: configDefault,
        provider: configProvider,
        auxiliary: configAuxiliary,
      },
      stats: stats.map((s) => ({
        model: s.model || fallbackModel,
        totalSessions: Number(s.total_sessions),
        totalTokensIn: Number(s.total_input_tokens),
        totalTokensOut: Number(s.total_output_tokens),
        totalCostUSD: Number(s.total_cost_usd),
        avgLatencyMs: s.avg_latency_ms != null ? Number(s.avg_latency_ms) : null,
        lastUsed: s.last_used ?? null,
      })),
    };
  });
```

- [ ] **Step 3: Verify server types compile**

```bash
npm run typecheck
```

Expected: pass (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/agent-data.ts
git commit -m "feat(api): add /curator and /models backend routes"
```

---

### Task 6: Create CuratorTab component

**Files:**
- Create: `web/src/features/agent/CuratorTab.tsx`

- [ ] **Step 1: Create CuratorTab.tsx**

```tsx
import { useState } from 'react';
import { useCurator } from '../../lib/agent-api';

interface CuratorTabProps {
  name: string;
  profile: string;
}

function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const gradeColors: Record<string, string> = {
  A: 'text-green-400',
  B: 'text-blue-400',
  C: 'text-amber-400',
  D: 'text-orange-400',
  F: 'text-red-400',
};

export function CuratorTab({ name, profile }: CuratorTabProps) {
  const curatorQ = useCurator(name, profile);
  const [showReport, setShowReport] = useState(false);

  if (curatorQ.isLoading) {
    return <div className="p-5 text-slate-500 text-sm">Loading curator data...</div>;
  }

  const data = curatorQ.data;

  if (!data || !data.enabled) {
    return (
      <div className="p-5 max-w-4xl">
        <div className="text-center py-10 bg-[#161822] border border-[#2a2d3a] rounded-lg">
          <i className="fa-solid fa-wand-magic-sparkles text-3xl mb-3 block text-slate-600" />
          <div className="text-slate-500 text-sm mb-1">Curator is not enabled</div>
          <div className="text-slate-600 text-[11px]">
            Enable it in config.yaml under <code className="text-slate-500">auxiliary.curator</code>
          </div>
        </div>
      </div>
    );
  }

  const runs = data.runs ?? [];
  const skillHealth = data.skillHealth ?? [];

  return (
    <div className="p-5 max-w-5xl">
      {/* Status bar */}
      <div className="flex items-center gap-4 mb-5 p-4 bg-[#161822] border border-[#2a2d3a] rounded-lg">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[12px] text-green-400 font-medium">Curator active</span>
        </div>
        <div className="h-4 border-l border-[#2a2d3a]" />
        <div className="text-[11px] text-slate-500">
          Last run: {data.lastRun ? (
            <span className="text-slate-300">{timeAgo(data.lastRun)}</span>
          ) : (
            <span className="text-slate-600">never</span>
          )}
        </div>
        {data.nextRun && (
          <>
            <div className="h-4 border-l border-[#2a2d3a]" />
            <div className="text-[11px] text-slate-500">
              Next run: <span className="text-slate-300">{timeAgo(data.nextRun)}</span>
            </div>
          </>
        )}
        <div className="ml-auto text-[11px] text-slate-500">
          {runs.length} run{runs.length !== 1 ? 's' : ''} recorded
        </div>
      </div>

      {/* Run history */}
      {runs.length > 0 && (
        <div className="mb-5">
          <div className="text-[13px] font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-clock-rotate-left text-indigo-500 mr-2" />
            Run History
          </div>
          <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[#2a2d3a] text-slate-500">
                  <th className="text-left px-4 py-2.5 font-medium">When</th>
                  <th className="text-right px-4 py-2.5 font-medium">Graded</th>
                  <th className="text-right px-4 py-2.5 font-medium">Pruned</th>
                  <th className="text-right px-4 py-2.5 font-medium">Consolidated</th>
                  <th className="text-right px-4 py-2.5 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {[...runs].reverse().map((run, i) => (
                  <tr key={i} className="border-b border-[#2a2d3a] last:border-0 hover:bg-[#1a1c2e]">
                    <td className="px-4 py-2.5 text-slate-300">{run.timestamp ? timeAgo(run.timestamp) : '—'}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{run.skillsGraded}</td>
                    <td className="px-4 py-2.5 text-right text-red-400">{run.skillsPruned}</td>
                    <td className="px-4 py-2.5 text-right text-amber-400">{run.skillsConsolidated}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{formatDuration(run.duration_s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Skill health */}
      {skillHealth.length > 0 && (
        <div className="mb-5">
          <div className="text-[13px] font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-heart-pulse text-indigo-500 mr-2" />
            Skill Health
          </div>
          <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[#2a2d3a] text-slate-500">
                  <th className="text-left px-4 py-2.5 font-medium">Skill</th>
                  <th className="text-right px-4 py-2.5 font-medium">Usage</th>
                  <th className="text-right px-4 py-2.5 font-medium">Last Used</th>
                  <th className="text-center px-4 py-2.5 font-medium">Grade</th>
                  <th className="text-center px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {skillHealth.map((s, i) => (
                  <tr key={i} className="border-b border-[#2a2d3a] last:border-0 hover:bg-[#1a1c2e]">
                    <td className="px-4 py-2.5 text-slate-300 font-mono">{s.name}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{s.usageCount}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{s.lastUsed ? timeAgo(s.lastUsed) : '—'}</td>
                    <td className={`px-4 py-2.5 text-center font-bold ${gradeColors[s.grade ?? ''] ?? 'text-slate-600'}`}>
                      {s.grade ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        s.status === 'active' ? 'bg-green-500/15 text-green-400' :
                        s.status === 'consolidated' ? 'bg-amber-500/15 text-amber-400' :
                        'bg-slate-500/15 text-slate-500'
                      }`}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Latest report */}
      {data.report && (
        <div>
          <button
            className="flex items-center gap-2 text-[13px] font-semibold text-slate-200 mb-3"
            onClick={() => setShowReport(!showReport)}
          >
            <i className="fa-solid fa-file-lines text-indigo-500" />
            Latest Report
            <i className={`fa-solid fa-chevron-${showReport ? 'up' : 'down'} text-slate-600 text-[10px] ml-1`} />
          </button>
          {showReport && (
            <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-5">
              <pre className="text-[11px] leading-[1.7] text-slate-400 whitespace-pre-wrap font-mono">
                {data.report}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd web && npx tsc --noEmit
```

Expected: pass for this file (may still have errors from types.ts changes not wired in AgentTabBar/Workspace yet).

- [ ] **Step 3: Commit**

```bash
git add web/src/features/agent/CuratorTab.tsx
git commit -m "feat(frontend): add CuratorTab component"
```

---

### Task 7: Create ModelsTab component

**Files:**
- Create: `web/src/features/agent/ModelsTab.tsx`

- [ ] **Step 1: Create ModelsTab.tsx**

```tsx
import { useModels } from '../../lib/agent-api';
import { ModelIcon } from '../../components/shared/ModelIcon';

interface ModelsTabProps {
  name: string;
  profile: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ModelsTab({ name, profile }: ModelsTabProps) {
  const modelsQ = useModels(name, profile);

  if (modelsQ.isLoading) {
    return <div className="p-5 text-slate-500 text-sm">Loading models data...</div>;
  }

  const data = modelsQ.data;
  const stats = data?.stats ?? [];
  const config = data?.config;
  const maxCost = Math.max(...stats.map(s => s.totalCostUSD), 0.01);

  // Auxiliary models that have a non-empty model configured
  const auxEntries = Object.entries(config?.auxiliary ?? {}).filter(
    ([, v]) => v.model && v.model !== '',
  );

  return (
    <div className="p-5 max-w-5xl">
      {/* Active models cards */}
      <div className="text-[13px] font-semibold text-slate-200 mb-3">
        <i className="fa-solid fa-microchip text-indigo-500 mr-2" />
        Active Models
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        {/* Default model */}
        {config?.default && (
          <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <ModelIcon model={config.default} size={16} />
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">default</span>
            </div>
            <div className="text-[13px] text-slate-200 font-mono">{config.default}</div>
            <div className="text-[10px] text-slate-500 mt-1">{config.provider}</div>
          </div>
        )}

        {/* Auxiliary models */}
        {auxEntries.map(([key, val]) => (
          <div key={key} className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <ModelIcon model={val.model ?? ''} size={16} />
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400">{key}</span>
            </div>
            <div className="text-[13px] text-slate-200 font-mono">{val.model}</div>
            {val.provider && <div className="text-[10px] text-slate-500 mt-1">{val.provider}</div>}
          </div>
        ))}

        {!config?.default && auxEntries.length === 0 && (
          <div className="col-span-full text-center py-6 bg-[#161822] border border-[#2a2d3a] rounded-lg">
            <div className="text-slate-500 text-[11px]">No model config found</div>
          </div>
        )}
      </div>

      {/* Usage stats table */}
      <div className="text-[13px] font-semibold text-slate-200 mb-3">
        <i className="fa-solid fa-chart-bar text-indigo-500 mr-2" />
        Usage Stats
      </div>

      {stats.length === 0 ? (
        <div className="text-center py-10 bg-[#161822] border border-[#2a2d3a] rounded-lg">
          <i className="fa-solid fa-chart-bar text-3xl mb-3 block text-slate-600" />
          <div className="text-slate-500 text-sm mb-1">No model usage data yet</div>
          <div className="text-slate-600 text-[11px]">Stats will appear after the agent processes sessions</div>
        </div>
      ) : (
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-[#2a2d3a] text-slate-500">
                <th className="text-left px-4 py-2.5 font-medium">Model</th>
                <th className="text-right px-4 py-2.5 font-medium">Sessions</th>
                <th className="text-right px-4 py-2.5 font-medium">Tokens In</th>
                <th className="text-right px-4 py-2.5 font-medium">Tokens Out</th>
                <th className="text-right px-4 py-2.5 font-medium">Cost</th>
                <th className="text-left px-4 py-2.5 font-medium w-32">Cost %</th>
                <th className="text-right px-4 py-2.5 font-medium">Last Used</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={i} className="border-b border-[#2a2d3a] last:border-0 hover:bg-[#1a1c2e]">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <ModelIcon model={s.model} size={14} />
                      <span className="text-slate-300 font-mono">{s.model}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-400">{s.totalSessions}</td>
                  <td className="px-4 py-2.5 text-right text-slate-400">{formatTokens(s.totalTokensIn)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-400">{formatTokens(s.totalTokensOut)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-300 font-medium">{formatCost(s.totalCostUSD)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-[#2a2d3a] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${Math.max((s.totalCostUSD / maxCost) * 100, 2)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-600 w-8 text-right">
                        {((s.totalCostUSD / Math.max(stats.reduce((a, b) => a + b.totalCostUSD, 0), 0.01)) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{s.lastUsed ? timeAgo(s.lastUsed) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/features/agent/ModelsTab.tsx
git commit -m "feat(frontend): add ModelsTab component"
```

---

### Task 8: Wire tabs into AgentTabBar and AgentWorkspace

**Files:**
- Modify: `web/src/features/agent/AgentTabBar.tsx`
- Modify: `web/src/features/agent/AgentWorkspace.tsx`

- [ ] **Step 1: Update AgentTabBar.tsx**

Change the `operationTabs` array (lines 8-17) from:

```typescript
const operationTabs: { id: AgentTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'skills', label: 'Skills' },
  { id: 'cron', label: 'Cron' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'plugins', label: 'Plugins' },
];
```

To:

```typescript
const operationTabs: { id: AgentTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'models', label: 'Models' },
  { id: 'curator', label: 'Curator' },
  { id: 'skills', label: 'Skills' },
  { id: 'cron', label: 'Cron' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'plugins', label: 'Plugins' },
];
```

- [ ] **Step 2: Update AgentWorkspace.tsx imports**

Add imports for the new tabs. After line 13 (`import { PluginsTab } from './PluginsTab';`), add:

```typescript
import { CuratorTab } from './CuratorTab';
import { ModelsTab } from './ModelsTab';
```

- [ ] **Step 3: Add switch cases in AgentWorkspace.tsx**

In the `renderTab()` function, add two cases after the `analytics` case (after line 51):

```typescript
      case 'models':    return <ModelsTab name={name} profile={activeProfile} />;
      case 'curator':   return <CuratorTab name={name} profile={activeProfile} />;
```

- [ ] **Step 4: Verify full web build compiles**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Verify server build compiles**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/agent/AgentTabBar.tsx web/src/features/agent/AgentWorkspace.tsx
git commit -m "feat(frontend): wire CuratorTab and ModelsTab into agent workspace"
```

---

### Task 9: Update agent configs to enable Curator

**Files:**
- Modify: `/Users/paulcailly/work/backresto/landing-jarvis/deploy/jarvis/config.yaml`
- Modify: `/Users/paulcailly/workforce/apps/alberto/config.yaml`

- [ ] **Step 1: Add Curator config to Jarvis**

In `/Users/paulcailly/work/backresto/landing-jarvis/deploy/jarvis/config.yaml`, add a new section before the `# ---------------------------------------------------------------------------` line for MCP servers (before line 119). Insert:

```yaml
# ---------------------------------------------------------------------------
# Auxiliary
# ---------------------------------------------------------------------------
auxiliary:
  curator:
    enabled: true
    cycle_days: 7
```

- [ ] **Step 2: Add Curator config to Alberto**

In `/Users/paulcailly/workforce/apps/alberto/config.yaml`, add `curator` to the existing `auxiliary:` block. After the `flush_memories` entry (after line 135), add:

```yaml
  curator:
    enabled: true
    cycle_days: 7
```

- [ ] **Step 3: Verify YAML syntax is valid for both files**

```bash
node -e "const yaml = require('yaml'); yaml.parse(require('fs').readFileSync('/Users/paulcailly/work/backresto/landing-jarvis/deploy/jarvis/config.yaml', 'utf8')); console.log('jarvis: OK')"
node -e "const yaml = require('yaml'); yaml.parse(require('fs').readFileSync('/Users/paulcailly/workforce/apps/alberto/config.yaml', 'utf8')); console.log('alberto: OK')"
```

Expected: both print "OK".

- [ ] **Step 4: Commit config changes in their respective repos**

Jarvis:
```bash
cd /Users/paulcailly/work/backresto/landing-jarvis && git add deploy/jarvis/config.yaml && git commit -m "feat(jarvis): enable autonomous curator (v0.12.0)"
```

Alberto:
```bash
cd /Users/paulcailly/workforce/apps/alberto && git add config.yaml SOUL.md && git commit -m "feat(alberto): enable curator, remove bernardo references"
```

---

### Task 10: Build and verify everything

**Files:** None (verification)

- [ ] **Step 1: Full build of hermes-deploy**

```bash
cd /Users/paulcailly/hermes-deploy && npm run build
```

Expected: server build + web build + web dist copy all succeed.

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run linter**

```bash
npm run lint
```

Expected: no lint errors.

---

### Task 11: Upgrade and deploy agents

**Files:** None (operational steps, run via CLI)

- [ ] **Step 1: Upgrade jarvis to v0.12.0**

```bash
cd /Users/paulcailly/hermes-deploy && node dist/cli.js upgrade jarvis
```

Expected: nix flake update to v0.12.0, nixos-rebuild succeeds, healthcheck passes.

- [ ] **Step 2: Upgrade alberto to v0.12.0**

```bash
node dist/cli.js upgrade alberto
```

Expected: same as jarvis.

- [ ] **Step 3: Update jarvis config (push curator-enabled config)**

```bash
node dist/cli.js update jarvis
```

Expected: config hash changed, upload + rebuild, healthcheck passes.

- [ ] **Step 4: Update alberto config (push curator config + cleaned SOUL.md)**

```bash
node dist/cli.js update alberto
```

Expected: config hash changed, upload + rebuild, healthcheck passes.

- [ ] **Step 5: Verify both agents healthy**

```bash
node dist/cli.js status jarvis
node dist/cli.js status alberto
```

Expected: both show `health: healthy` and hermes_agent_rev matches v0.12.0.
