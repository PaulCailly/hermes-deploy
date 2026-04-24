# Profiles Support Design

**Date:** 2026-04-24
**Status:** Approved

## Overview

Add Hermes profile support to hermes-deploy, enabling multiple independent agents on a single deployed VM. Each profile gets its own config, API keys, personality (SOUL.md), sessions, memory, skills, cron jobs, gateway, and state database. The dashboard surfaces profiles via a switcher within each agent view.

Reference: https://hermes-agent.nousresearch.com/docs/user-guide/profiles

## Design Decisions

- **Profile as sub-level of agent (not first-class entity):** The sidebar shows one entry per deployed VM. A profile switcher pill bar within the agent view lets you toggle between profiles. VM-scoped state (infra, SSH, logs, secrets) is shared; Hermes-layer state (sessions, config, gateway, etc.) is per-profile.
- **Approach: SSH path parameter:** Profiles are implemented as a thin layer — the backend resolves the profile name to a different `HERMES_HOME` path on the remote VM. No agent-data-source abstraction refactor.
- **Backwards compatible config:** The flat `[hermes]` section in `hermes.toml` defines the default profile. Additional `[[hermes.profiles]]` blocks add named profiles. Existing configs work without changes.
- **Tab stays on profile switch:** Switching profiles keeps the current tab. VM-scoped tabs show a dimmed note.
- **Per-profile documents, no sharing:** Each profile declares its own documents independently. No merge/inheritance logic.
- **Gateway is profile-scoped:** The Gateway tab shows the current profile's gateway only.

## 1. Deploy Config (`hermes.toml` Schema)

The `[hermes]` section keeps its current fields — they define the **default profile**. An optional `[[hermes.profiles]]` array adds named profiles.

```toml
# hermes.toml — existing fields (= default profile)
[hermes]
config_file = "config.yaml"
secrets_file = "secrets.env.enc"
documents = { "SOUL.md" = "SOUL.md" }
nix_extra = "hermes.extra.nix"
environment = { SOME_VAR = "value" }

# Additional profiles
[[hermes.profiles]]
name = "coder"
config_file = "profiles/coder/config.yaml"
secrets_file = "profiles/coder/secrets.env.enc"
documents = { "SOUL.md" = "profiles/coder/SOUL.md" }

[[hermes.profiles]]
name = "assistant"
config_file = "profiles/assistant/config.yaml"
secrets_file = "profiles/assistant/secrets.env.enc"
documents = { "SOUL.md" = "profiles/assistant/SOUL.md" }
```

### Schema Rules

- `name` is required, must match `^[a-z0-9][a-z0-9-]{0,62}$`
- `name` cannot be `"default"` (reserved for the implicit flat `[hermes]` profile)
- `config_file` and `secrets_file` are required per profile
- `documents` is optional (defaults to `{}`)
- `environment` and `nix_extra` are NOT per-profile — they are VM-level (Nix config, systemd env)
- No duplicate profile names

### Zod Schema Change (`src/schema/hermes-toml.ts`)

Add an optional `profiles` array to `HermesSchema`:

```typescript
const ProfileSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]{0,62}$/).refine(n => n !== 'default', {
    message: '"default" is reserved — the flat [hermes] section is the default profile',
  }),
  config_file: z.string().min(1),
  secrets_file: z.string().min(1),
  documents: z.record(z.string().min(1), z.string().min(1)).default({}),
});

const HermesSchema = z.object({
  config_file: z.string().min(1),
  secrets_file: z.string().min(1),
  nix_extra: z.string().min(1).optional(),
  documents: z.record(z.string().min(1), z.string().min(1)).default({}),
  environment: z.record(z.string().min(1), z.string()).default({}),
  cachix: CachixSchema.optional(),
  profiles: z.array(ProfileSchema).default([]),
}).refine(h => {
  const names = h.profiles.map(p => p.name);
  return new Set(names).size === names.length;
}, { message: 'Duplicate profile names' });
```

## 2. Provisioning & Upload

### During `up` (first deploy)

1. Upload default profile files as today (config.yaml, secrets, documents)
2. For each declared profile:
   - Run `hermes profile create <name>` on the VM (as the `hermes` user)
   - Upload `config.yaml` to `/var/lib/hermes/.hermes/profiles/<name>/config.yaml`
   - Decrypt and upload `secrets.env.enc` to `/var/lib/hermes/.hermes/profiles/<name>/.env`
   - Upload each document to `/var/lib/hermes/.hermes/profiles/<name>/<doc_name>`

### During `update`

1. Compute a hash per profile (config + secrets + documents) to detect changes
2. Only re-upload profiles whose hash changed
3. If a profile exists in `hermes.toml` but not on the VM, create it
4. Profiles removed from `hermes.toml` are left on the VM (no auto-delete)
5. After uploading, restart the profile's gateway if its config changed: `hermes -p <name> gateway restart`

### State Tracking (`state.toml`)

```toml
[deployments.jarvis]
# ... existing fields ...

[deployments.jarvis.profile_hashes]
coder = "sha256:def..."
assistant = "sha256:ghi..."
```

Lightweight optional record on each deployment. The `DeploymentSchema` in `state-toml.ts` gets an optional `profile_hashes` field (`z.record(z.string(), z.string()).optional()`). Since it's optional with no default, existing state files pass validation without a migration — the schema version stays at 4.

### What We Don't Do

- No per-profile Nix config — all profiles share the same NixOS system config
- No per-profile systemd services from hermes-deploy — `hermes profile create` + `hermes gateway install` on the VM handles that natively
- No auto-deletion of profiles removed from config

## 3. Backend API Changes

### New Endpoint: Profile Discovery

```
GET /api/agents/:name/profiles
```

Lists profiles by reading `/var/lib/hermes/.hermes/profiles/` via SSH, prepending `"default"`.

Response:
```json
[
  { "name": "default", "path": "/var/lib/hermes/.hermes" },
  { "name": "coder", "path": "/var/lib/hermes/.hermes/profiles/coder" },
  { "name": "assistant", "path": "/var/lib/hermes/.hermes/profiles/assistant" }
]
```

### Profile Query Parameter

All agent-data endpoints gain an optional `?profile=<name>` query parameter:

**Profile-scoped (gains `?profile=`):**
- `GET /api/agents/:name/stats`
- `GET /api/agents/:name/sessions` (and `/:sid/messages`)
- `GET /api/agents/:name/skills` (and file read/write)
- `GET /api/agents/:name/cron` (and CRUD/toggle)
- `GET /api/agents/:name/gateway` (and start/stop/restart)
- `GET /api/agents/:name/webhooks`
- `GET /api/agents/:name/plugins`
- `GET /api/deployments/:name/config/files` and `GET /api/deployments/:name/config/:key`
- WebSocket: `/ws/agents/:name/sessions/:sid/messages`, `/ws/agents/:name/stats`

**VM-scoped (no profile parameter, unchanged):**
- `GET /api/deployments/:name` (status/infra)
- `GET /api/deployments/:name/logs`
- SSH endpoints
- Secrets endpoints

### Implementation: `agent-data-source.ts`

Add a helper to resolve the profile to a path:

```typescript
function resolveHermesHome(profile?: string): string {
  if (!profile || profile === 'default') return HERMES_HOME;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(profile)) throw new Error('invalid profile name');
  return `${HERMES_HOME}/profiles/${profile}`;
}
```

All functions that currently hardcode `HERMES_HOME` gain an optional `hermesHome` parameter: `runSqliteJson`, `readRemoteFile`, `readRemoteJson`, and the hardcoded paths for cron (`/var/lib/hermes/.hermes/cron/jobs.json`), gateway state, skills, webhooks, plugins.

Route handlers extract `?profile=` from the query and pass the resolved path down.

### Org-Level Stats Update

`GET /api/org/stats` `perAgent` array gets an optional `profile` field:

```json
{
  "perAgent": [
    { "name": "jarvis", "profile": "default", "totalSessions": 50, "totalCostUSD": 2.40 },
    { "name": "jarvis", "profile": "coder", "totalSessions": 30, "totalCostUSD": 1.10 }
  ]
}
```

Top-level aggregates still sum everything.

## 4. Frontend — Profile Switcher & State

### Route Model

Add optional `profile` to the agent route:

```typescript
type Route =
  | { page: 'dashboard' }
  | { page: 'agents' }
  | { page: 'agent'; name: string; tab: AgentTab; profile?: string }
  | { page: 'library' }
  | { page: 'teams' }
  | { page: 'settings' }
  | { page: 'new' }
  | { page: 'job'; jobId: string };
```

When `profile` is undefined, defaults to `"default"`.

### ProfileSwitcher Component

New component placed between `AgentHeader` and `AgentTabBar` in `AgentWorkspace`:

1. Fetches `GET /api/agents/:name/profiles`
2. Renders a horizontal pill bar: `default | coder | assistant`
3. Clicking a pill navigates: `navigate({ page: 'agent', name, tab, profile: selectedProfile })`
4. Only renders when the agent has more than one profile (single-profile agents look exactly as today — no UI change)
5. On VM-scoped tabs (infra, ssh, logs, secrets), the switcher is visible but dimmed with a label: "VM-scoped — applies to all profiles"

### Hook Changes (`agent-api.ts`)

All per-agent hooks gain an optional `profile` parameter appended as a query param:

```typescript
export function useAgentStats(name: string, profile?: string) {
  const qs = profile && profile !== 'default' ? `?profile=${profile}` : '';
  return useQuery({
    queryKey: ['agent-stats', name, profile ?? 'default'],
    queryFn: () => apiFetch<AgentStats>(`/api/agents/${encodeURIComponent(name)}/stats${qs}`),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}
```

Same pattern for all hooks. Profile is included in `queryKey` for separate per-profile caching.

New hook:

```typescript
export function useAgentProfiles(name: string) {
  return useQuery({
    queryKey: ['agent-profiles', name],
    queryFn: () => apiFetch<{ name: string; path: string }[]>(`/api/agents/${encodeURIComponent(name)}/profiles`),
    staleTime: 60_000, // profiles don't change often
    retry: false,
  });
}
```

### AgentWorkspace Changes

Receives `profile` from the route and passes it to all profile-scoped tab components:

```typescript
interface AgentWorkspaceProps {
  name: string;
  tab: AgentTab;
  profile?: string;
  navigate: Navigate;
}
```

VM-scoped tabs (infra, ssh, logs, secrets) ignore the profile prop.

### Org Dashboard

Per-agent rows in `OrgDashboard` show profile count as a sub-label (e.g., "jarvis — 3 profiles"). Per-profile cost breakdown is available in the expanded stats.

## 5. Config Tab — Profile-Aware

### Behavior

- **Default profile / single-profile agent:** Config tab works as today — shows files from the flat `[hermes]` section
- **Named profile:** Config tab shows that profile's files (its `config_file`, `secrets_file`, and documents from the `[[hermes.profiles]]` block)
- `GET /api/deployments/:name/config/files?profile=<name>` returns the file list for that profile
- `hermes.toml` itself is always shown (it's the deploy manifest, VM-scoped) — accessible from the default profile view or always visible as a tab

### Tab Categorization

```
VM-scoped tabs (ignore profile):  infra, logs, ssh, secrets
Profile-scoped tabs (use profile): overview, sessions, analytics, skills, cron,
                                    gateway, webhooks, plugins, config
```

## Summary of File Changes

### Backend (`src/`)
- `src/schema/hermes-toml.ts` — Add `ProfileSchema` and `profiles` array to `HermesSchema`
- `src/schema/state-toml.ts` — Add optional `profile_hashes` record to deployment schema
- `src/server/agent-data-source.ts` — Add `resolveHermesHome()`, parameterize `HERMES_HOME` in all functions
- `src/server/routes/agent-data.ts` — Extract `?profile=` in all routes, pass resolved home path
- `src/server/routes/org.ts` — Iterate profiles per agent for stats/activity
- `src/server/routes/config.ts` — Support `?profile=` for profile-specific file lists
- `src/orchestrator/` — Add profile upload logic to up/update flows

### Frontend (`web/src/`)
- `web/src/lib/types.ts` — Add `profile?: string` to agent route
- `web/src/lib/agent-api.ts` — Add `profile` param to all hooks, add `useAgentProfiles`
- `web/src/lib/agent-types.ts` — No changes needed
- `web/src/features/agent/AgentWorkspace.tsx` — Accept `profile`, render `ProfileSwitcher`, pass profile to tabs
- `web/src/features/agent/ProfileSwitcher.tsx` — New component
- `web/src/features/agent/*.tsx` — All profile-scoped tabs accept and use `profile` prop
- `web/src/features/config/ConfigTab.tsx` — Accept `profile`, pass to API calls
- `web/src/features/dashboard/OrgDashboard.tsx` — Show per-profile breakdown
- `web/src/App.tsx` — Pass `profile` from route to `AgentWorkspace`
