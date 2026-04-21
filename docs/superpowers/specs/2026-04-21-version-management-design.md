# Version Management & Update System

**Date:** 2026-04-21
**Status:** Approved

## Overview

Surface current versions and available updates for both **hermes-deploy** (the CLI/dashboard) and **hermes-agent** (the NousResearch framework running on deployed instances). Provide one-click upgrades from the dashboard and informational notices in the CLI.

## Two Version Types

| Component | Source of truth | Upstream check | Versioning |
|-----------|----------------|----------------|------------|
| **hermes-deploy** | `HERMES_DEPLOY_VERSION` (build-time constant from package.json) | npm registry `@paulcailly/hermes-deploy/latest` | Semver (1.2.1) |
| **hermes-agent** | `/etc/nixos/flake.lock` on the remote box (locked git revision) | GitHub API `repos/NousResearch/hermes-agent/releases` | CalVer tags (v2026.4.16) + semver names (v0.10.0) |

## Data Model

### State schema change (v3 -> v4)

New fields on each deployment record in `state.toml`:

```toml
hermes_agent_rev = "abc1234..."   # git SHA from flake.lock, set after every nixos-rebuild
hermes_agent_tag = "v2026.4.16"   # matched release tag, or empty string if no match
```

Migration from v3: defaults existing deployments to `hermes_agent_rev = "unknown"`, `hermes_agent_tag = ""`.

### DTO additions

`StatusPayloadDto.stored` gains:

```typescript
hermes_agent_version?: {
  lockedRev: string;        // git SHA from flake.lock
  lockedDate: string;       // ISO 8601 from flake.lock lastModified
  lockedTag?: string;       // matched tag name if rev matches a release
};
```

New endpoint `GET /api/updates`:

```typescript
interface UpdateCheckResponse {
  hermesDeploy: {
    current: string;        // "1.2.1"
    latest: string;         // "1.3.0"
    updateAvailable: boolean;
  };
  hermesAgent: {
    latest: {
      tag: string;          // "v2026.4.16"
      name: string;         // "Hermes Agent v0.10.0 (2026.4.16)"
      publishedAt: string;  // ISO 8601
      body: string;         // release notes markdown
    };
  };
}
```

## Server-Side Architecture

### `src/updates/npm-check.ts`

- Fetches `https://registry.npmjs.org/@paulcailly/hermes-deploy/latest` for the `version` field
- In-memory cache, 1-hour TTL
- Compares against `HERMES_DEPLOY_VERSION` via semver
- Returns `{ current, latest, updateAvailable }`

### `src/updates/hermes-agent-check.ts`

- Fetches `https://api.github.com/repos/NousResearch/hermes-agent/releases?per_page=5`
- In-memory cache, 15-minute TTL
- Returns latest release: tag, name, publishedAt, body (markdown)
- Also resolves tag -> commit SHA for matching against locked revisions

### `src/server/routes/updates.ts`

- `GET /api/updates` — calls both checkers, serves from cache on subsequent hits

### Reading flake.lock from remote instances

- In `agent-data-source.ts`, new function `readHermesAgentVersion(name)`:
  - Runs `cat /etc/nixos/flake.lock` via cached SSH session
  - Parses JSON, extracts `nodes["hermes-agent"].locked.rev` and `nodes["hermes-agent"].locked.lastModified`
  - Cached per-agent in the session cache entry (refreshes with session at 30s TTL)
- Exposed via the existing `GET /api/deployments/:name` response (new `hermes_agent_version` field)

### Matching locked rev to a release tag

- The hermes-agent releases cache includes each release's `tag_name`
- Resolve tag -> SHA via GitHub API `git/refs/tags/{tag}` (cached alongside releases)
- If locked rev matches a tag's SHA, populate `lockedTag`
- If no match, show short SHA + date; "update available" based on `lockedDate < latest.publishedAt`

## Dashboard UI

### Global update banner (hermes-deploy)

- Location: `App.tsx`, directly below `ConnectionBanner`
- Style: indigo/blue tint (informational, not error), same structural pattern as `ConnectionBanner`
- Condition: only renders when `updateAvailable === true`
- Content: `hermes-deploy v{latest} is available (you have v{current})` + inline code snippet `npm install -g @paulcailly/hermes-deploy@latest`
- Dismissable via X button, dismiss state stored in `sessionStorage`
- Data: `GET /api/updates`, polled every 60s via React Query

### Per-agent update banner (hermes-agent)

- Location: top of `AgentWorkspace`, above tab content, below tab bar
- Style: same indigo pattern as global banner
- Condition: agent's `lockedDate` < latest release's `publishedAt`
- Content: `Hermes Agent {latest.name} available (deployed: {lockedTag or shortSha})` + "View changelog" link + "Update" button
- "View changelog": expands inline panel with rendered release notes markdown
- "Update" button: triggers `POST /api/deployments/:name/upgrade`, opens `JobDrawer`

### Infra tab additions

- New card in the existing grid: "Hermes Agent Version"
- Shows: current locked tag (or short SHA + date), latest available version, update status badge (up to date / update available)

### Settings page

- Existing "About" section: add a "Latest available" row showing npm latest version with an "up to date" or "update available" badge

## Update Action (hermes-agent upgrade)

### New job kind: `'upgrade'`

Added to `JobDtoSchema.kind` enum: `'up' | 'update' | 'destroy' | 'adopt' | 'upgrade'`.

### Orchestrator: `src/orchestrator/upgrade.ts`

Phases:
1. **`flake-update`** — SSH in, run `NIX_CONFIG="experimental-features = nix-command flakes" nix flake update hermes-agent --flake /etc/nixos` (updates only hermes-agent input, leaves nixpkgs and sops-nix pinned; uses same NIX_CONFIG prefix as the existing rebuild command)
2. **`bootstrap`** — `nixos-rebuild switch --flake /etc/nixos#default` via existing `runNixosRebuild()` (nohup+poll pattern that survives sshd restarts)
3. **`healthcheck`** — existing `waitForHealthy()` pattern

On success:
- Read updated `/etc/nixos/flake.lock` to extract new rev + match tag
- Update `hermes_agent_rev`, `hermes_agent_tag`, and `last_nix_hash` in `state.toml`

### API route

- `POST /api/deployments/:name/upgrade` — returns `{ jobId }`, same pattern as update/destroy
- Protected by existing `singleFlight` lock (no concurrent operations per agent)

### Phase IDs

New phase IDs added to `PhaseIdSchema`: `'flake-update'`.

## CLI Integration

### `hermes-deploy ls`

- New column `AGENT` showing the stored `hermes_agent_tag` (or short SHA from `hermes_agent_rev`)
- After the table, if hermes-deploy has an update available, print to stderr:
  ```
  Update available: @paulcailly/hermes-deploy@1.3.0 (current: 1.2.1)
  Run: npm install -g @paulcailly/hermes-deploy@latest
  ```
- npm check uses file-based cache at `~/.config/hermes-deploy/npm-update-check.json` with 24h TTL

### `hermes-deploy status`

- New section in output:
  ```
  Hermes Agent:  v0.10.0 (v2026.4.16) — up to date
  ```
  or:
  ```
  Hermes Agent:  v0.9.0 (abc1234, 2026-04-13) — update available (v0.10.0)
  ```
- Same hermes-deploy update notice at bottom as `ls`
- Reads flake.lock via SSH (already connects for status anyway)

### `hermes-deploy dashboard` startup

- On server start, if update available, print:
  ```
  Update available: hermes-deploy v1.3.0 — npm install -g @paulcailly/hermes-deploy@latest
  ```

## Caching Strategy

| Data | Cache location | TTL | Rationale |
|------|---------------|-----|-----------|
| npm latest version (server) | In-memory | 1 hour | npm publishes infrequently |
| npm latest version (CLI) | File (`~/.config/hermes-deploy/npm-update-check.json`) | 24 hours | Avoid slowing down CLI commands |
| hermes-agent releases (server) | In-memory | 15 minutes | NousResearch releases ~weekly |
| Remote flake.lock (server) | Per-agent in SSH session cache | 30 seconds (session TTL) | Piggybacks on existing cache |
| Remote flake.lock (CLI) | Stored in state.toml after rebuild | Persistent | `ls` reads from state, `status` reads live via SSH |

## State Migration: v3 -> v4

```typescript
// In src/state/migrations.ts
4: (v3: any) => ({
  ...v3,
  schema_version: 4,
  deployments: Object.fromEntries(
    Object.entries(v3.deployments).map(([name, dep]: [string, any]) => [
      name,
      { ...dep, hermes_agent_rev: 'unknown', hermes_agent_tag: '' },
    ]),
  ),
}),
```

After migration, first `update`/`deploy`/`upgrade` will populate the real values by reading flake.lock.

## Files to Create

- `src/updates/npm-check.ts`
- `src/updates/hermes-agent-check.ts`
- `src/server/routes/updates.ts`
- `src/orchestrator/upgrade.ts`
- `web/src/components/UpdateBanner.tsx`
- `web/src/features/agent/AgentUpdateBanner.tsx`

## Files to Modify

- `src/schema/dto.ts` — new DTOs, extend StatusPayloadDto, add 'upgrade' to job kind
- `src/schema/state-toml.ts` — add hermes_agent_rev + hermes_agent_tag fields, bump schema to v4
- `src/state/migrations.ts` — add v3->v4 migration, bump CURRENT_SCHEMA_VERSION
- `src/server/routes/deployments.ts` — add upgrade endpoint, extend GET :name response with agent version
- `src/server/routes/health.ts` — no change (existing /api/info stays as-is)
- `src/server/agent-data-source.ts` — add readHermesAgentVersion()
- `src/orchestrator/shared.ts` — read flake.lock + update state after nixos-rebuild (shared by deploy/update/upgrade)
- `src/commands/ls.ts` — add AGENT column + npm update notice
- `src/commands/status.ts` — add agent version section + npm update notice
- `src/commands/dashboard.ts` — print update notice on startup
- `src/cli.ts` — no change (no new CLI commands)
- `web/src/App.tsx` — add UpdateBanner below ConnectionBanner
- `web/src/features/agent/AgentWorkspace.tsx` — add AgentUpdateBanner
- `web/src/features/agent/InfraTab.tsx` — add agent version card
- `web/src/features/settings/SettingsPage.tsx` — add latest version row in About section
- `web/src/lib/api.ts` or new `web/src/lib/updates.ts` — React Query hooks for /api/updates
