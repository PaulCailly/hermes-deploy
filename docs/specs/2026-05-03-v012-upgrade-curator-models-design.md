# v0.12.0 Upgrade, Curator Dashboard & Models Dashboard

**Date:** 2026-05-03
**Status:** Approved
**Scope:** Upgrade hermes-agent to v0.12.0, update agent configs, add Curator and Models dashboard tabs

---

## Context

hermes-deploy v1.3.0 manages two deployed agents:

- **Jarvis** (AWS eu-west-3) -- backresto knowledge assistant, Discord-only, read-only toolset
- **Alberto** (GCP europe-west1) -- Workforce CPTO, full toolset (terminal, browser, code, cron)

Both agents run an older hermes-agent revision. The latest release is **v0.12.0 (v2026.4.30)**, which introduces the Autonomous Curator, upgraded self-improvement loop, new inference providers, pluggable gateway platforms, and more.

The `feat/profiles-support` branch has been merged to main, providing multi-profile support as a foundation.

## Goals

1. Upgrade both agents to hermes-agent v0.12.0 via `hermes-deploy upgrade`
2. Update agent configs to enable the Curator on both jarvis and alberto
3. Clean up Alberto's SOUL.md (remove defunct Bernardo sub-agent references)
4. Add a Curator dashboard tab to the web frontend
5. Add a Models dashboard tab to the web frontend

## Non-Goals

- Changing the default model (stays on `gemini-3.1-pro-preview` / `google-ai-studio`)
- Expanding Jarvis's toolset (deferred)
- Deploying Bernardo/Hugo as a profile (deferred, will reimplement later)
- Adding fallback providers

---

## 1. Agent Config Updates

### Jarvis (`config.yaml`)

Add an `auxiliary` block to enable the Curator:

```yaml
auxiliary:
  curator:
    enabled: true
    cycle_days: 7
```

No other config changes. Model, toolsets, platform config, and MCP servers remain unchanged.

### Alberto (`config.yaml`)

Add the same `auxiliary` block:

```yaml
auxiliary:
  curator:
    enabled: true
    cycle_days: 7
```

No other config changes. Model, terminal, browser, agent, and platform config remain unchanged.

### Alberto (`SOUL.md`)

Remove references to Bernardo (Customer Success Manager). The teammate descriptions and boundary about not handling customer communications directly are removed. Alberto's SOUL.md now describes only Alberto's own role and human partners (founders).

## 2. Operational Steps

These are runtime operations, not code changes to hermes-deploy:

1. `hermes-deploy upgrade jarvis` -- nix flake update to v0.12.0, nixos-rebuild, healthcheck
2. `hermes-deploy upgrade alberto` -- same
3. `hermes-deploy update jarvis` -- push updated config.yaml with Curator enabled
4. `hermes-deploy update alberto` -- push updated config.yaml + cleaned SOUL.md

Order: upgrade first (get the new binary), then update (push configs that reference new features).

## 3. Curator Dashboard Tab

### Data Source

The Curator writes its state to the hermes home directory:
- `logs/curator/run.json` -- structured run history (timestamps, skills graded/pruned/consolidated)
- `logs/curator/REPORT.md` -- human-readable latest report

Read via SSH using the existing `readRemoteFile` / `readRemoteJson` helpers in `agent-data-source.ts`.

### Backend Route

`GET /api/agents/:name/curator?profile=<name>`

Response shape:
```typescript
interface CuratorResponse {
  enabled: boolean;
  lastRun: string | null;        // ISO timestamp
  nextRun: string | null;        // ISO timestamp (estimated from cycle_days)
  runs: CuratorRun[];            // recent run history
  report: string | null;         // raw markdown of REPORT.md
  skillHealth: SkillHealthEntry[]; // skills ranked by usage
}

interface CuratorRun {
  timestamp: string;
  skillsGraded: number;
  skillsPruned: number;
  skillsConsolidated: number;
  duration_s: number;
}

interface SkillHealthEntry {
  name: string;
  usageCount: number;
  lastUsed: string | null;
  grade: string | null;          // e.g. "A", "B", "C", "F"
  status: 'active' | 'archived' | 'consolidated';
}
```

Profile-aware: uses `resolveHermesHome(profile)` to find the correct curator logs directory.

Graceful degradation: if curator files don't exist, return `{ enabled: false, runs: [], report: null, skillHealth: [] }`.

### Frontend Component

`web/src/features/agent/CuratorTab.tsx`

Sections:
- **Status bar** -- enabled/disabled indicator, last run timestamp, next scheduled run
- **Run history** -- table of past runs with counts (graded, pruned, consolidated) and duration
- **Skill health** -- sortable table: skill name, usage count, last used, grade, status
- **Latest report** -- rendered markdown of REPORT.md in a scrollable container

Empty state: "Curator is not enabled for this agent. Enable it in config.yaml under `auxiliary.curator`."

### API Hook

```typescript
function useCurator(name: string, profile?: string)
```

Added to `agent-api.ts`, follows existing patterns (react-query, 30s refetch).

## 4. Models Dashboard Tab

### Data Source

- **Model config**: already available via `GET /api/agents/:name/config` (reads config.yaml)
- **Per-model stats**: query state.db for token usage, cost, and latency grouped by model name

### Backend Route

`GET /api/agents/:name/models?profile=<name>`

Response shape:
```typescript
interface ModelsResponse {
  config: {
    default: string;           // e.g. "gemini-3.1-pro-preview"
    provider: string;          // e.g. "google-ai-studio"
    auxiliary: Record<string, { model?: string; provider?: string }>;
  };
  stats: ModelStats[];
}

interface ModelStats {
  model: string;
  totalSessions: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUSD: number;
  avgLatencyMs: number | null;
  lastUsed: string | null;
}
```

The stats query aggregates from the sessions/turns tables in state.db, grouped by model. Uses the existing `runSqliteJson` helper.

Profile-aware: uses `resolveHermesHome(profile)` for the correct state.db.

Graceful degradation: if state.db doesn't exist or has no model data, return `{ config: {...}, stats: [] }`.

### Frontend Component

`web/src/features/agent/ModelsTab.tsx`

Sections:
- **Active models** -- cards showing default model + provider, plus auxiliary models (curator, self-improvement) if configured
- **Usage stats** -- table of models with columns: model name, sessions, tokens in/out, cost, avg latency, last used
- **Cost breakdown** -- simple bar visualization of cost per model (reuse the bar pattern from OrgDashboard)

Empty state: "No model usage data available yet."

### API Hook

```typescript
function useModels(name: string, profile?: string)
```

Added to `agent-api.ts`, follows existing patterns.

## 5. Tab Registration

- Add `'curator'` and `'models'` to the tab union type in `AgentTabBar.tsx`
- Add routing cases in `AgentWorkspace.tsx`
- Both tabs receive `profile` prop (profile-aware, consistent with all other tabs)
- Tab order: Overview, Analytics, Sessions, Models, Curator, Cron, Gateway, Plugins, Webhooks, Skills, Config, SSH, Infra, Logs

## 6. File Changes Summary

### hermes-deploy codebase (new branch off main)

| File | Change |
|------|--------|
| `src/server/routes/agent-data.ts` | Add `/curator` and `/models` routes |
| `web/src/lib/agent-api.ts` | Add `useCurator` and `useModels` hooks |
| `web/src/lib/agent-types.ts` | Add Curator and Models response types |
| `web/src/features/agent/CuratorTab.tsx` | New component |
| `web/src/features/agent/ModelsTab.tsx` | New component |
| `web/src/features/agent/AgentTabBar.tsx` | Add curator and models tabs |
| `web/src/features/agent/AgentWorkspace.tsx` | Add routing for new tabs |

### Agent deploy configs (external repos, pushed via `hermes-deploy update`)

| File | Change |
|------|--------|
| `jarvis/config.yaml` | Add `auxiliary.curator` block |
| `alberto/config.yaml` | Add `auxiliary.curator` block |
| `alberto/SOUL.md` | Remove Bernardo references (already done) |
