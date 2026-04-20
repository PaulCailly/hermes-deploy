# Version Management & Update System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface hermes-deploy CLI and hermes-agent framework versions in the dashboard and CLI, with update checking and one-click upgrade for deployed instances.

**Architecture:** Two independent version checkers (npm registry for hermes-deploy, GitHub API for hermes-agent) behind server-side caching. Remote agent versions read from `/etc/nixos/flake.lock` via SSH, persisted in state.toml after each rebuild. Upgrade orchestrator runs `nix flake update` + `nixos-rebuild` as a new job kind.

**Tech Stack:** TypeScript, Fastify, React 19 + TanStack Query, Zod, ssh2, GitHub REST API, npm registry API.

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `src/updates/npm-check.ts` | Fetch latest hermes-deploy version from npm registry, in-memory 1h cache |
| `src/updates/hermes-agent-check.ts` | Fetch latest hermes-agent release from GitHub API, in-memory 15m cache |
| `src/updates/cli-update-check.ts` | File-based 24h cache for CLI npm check at `~/.config/hermes-deploy/npm-update-check.json` |
| `src/server/routes/updates.ts` | `GET /api/updates` route combining both checkers |
| `src/orchestrator/upgrade.ts` | Upgrade orchestrator: flake update + nixos-rebuild + healthcheck |
| `src/remote-ops/read-flake-lock.ts` | Parse `/etc/nixos/flake.lock` via SSH, extract hermes-agent revision |
| `web/src/components/UpdateBanner.tsx` | Global hermes-deploy update banner (indigo, dismissable) |
| `web/src/features/agent/AgentUpdateBanner.tsx` | Per-agent hermes-agent update banner with changelog + upgrade button |
| `tests/unit/updates/npm-check.test.ts` | Tests for npm version checker |
| `tests/unit/updates/hermes-agent-check.test.ts` | Tests for GitHub releases checker |
| `tests/unit/updates/cli-update-check.test.ts` | Tests for file-based CLI cache |
| `tests/unit/remote-ops/read-flake-lock.test.ts` | Tests for flake.lock parser |
| `tests/unit/orchestrator/upgrade.test.ts` | Tests for upgrade orchestrator |

### Modified files

| File | Change |
|------|--------|
| `src/schema/state-toml.ts` | Add `hermes_agent_rev` + `hermes_agent_tag` to `BaseDeploymentSchema`, bump to v4 |
| `src/state/migrations.ts` | Add v3->v4 migration, bump `CURRENT_SCHEMA_VERSION` to 4 |
| `src/schema/dto.ts` | Add `hermes_agent_version` to `StatusPayloadDto`, add `'upgrade'` to job kind, add `'flake-update'` phase, add `UpdateCheckResponseDto` |
| `src/orchestrator/reporter.ts` | Add `'flake-update'` to `PhaseId` union |
| `src/orchestrator/shared.ts` | After `uploadAndRebuild`, read flake.lock + persist `hermes_agent_rev`/`hermes_agent_tag` in state |
| `src/server/reporter-bus.ts` | Add `'upgrade'` to the `kind` type on `Job` interface |
| `src/server/index.ts` | Register `updateRoutes` |
| `src/server/routes/deployments.ts` | Add `POST /api/deployments/:name/upgrade` route, extend `GET :name` with `hermes_agent_version` |
| `src/commands/status.ts` | Add hermes-agent version section, npm update notice |
| `src/commands/ls.ts` | Add `AGENT` column, npm update notice after table |
| `src/commands/dashboard.ts` | Print npm update notice on startup |
| `web/src/App.tsx` | Add `UpdateBanner` below `ConnectionBanner` |
| `web/src/features/agent/AgentWorkspace.tsx` | Add `AgentUpdateBanner` above tab content |
| `web/src/features/agent/InfraTab.tsx` | Add "Hermes Agent Version" card |
| `web/src/features/settings/SettingsPage.tsx` | Add "Latest available" row in About section |
| `tests/unit/state/migrations.test.ts` | Add v3->v4 migration tests |

---

## Task 1: State schema v3 -> v4 migration

**Files:**
- Modify: `src/schema/state-toml.ts:21-42`
- Modify: `src/state/migrations.ts:1,65-77`
- Modify: `tests/unit/state/migrations.test.ts`

- [ ] **Step 1: Write the failing migration tests**

In `tests/unit/state/migrations.test.ts`, add these tests after the existing ones:

```typescript
it('exports CURRENT_SCHEMA_VERSION === 4', () => {
  expect(CURRENT_SCHEMA_VERSION).toBe(4);
});

it('migrates a v3 state to v4, adding hermes_agent_rev and hermes_agent_tag', () => {
  const v3 = {
    schema_version: 3,
    deployments: {
      'my-bot': {
        project_path: '/x',
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-09T00:00:00Z',
        last_deployed_at: '2026-04-09T00:00:00Z',
        last_config_hash: 'sha256:abc',
        last_nix_hash: 'sha256:def',
        ssh_key_path: '/x',
        age_key_path: '/x',
        health: 'healthy',
        instance_ip: '1.2.3.4',
        cloud_resources: {
          instance_id: 'i-1',
          security_group_id: 'sg-1',
          key_pair_name: 'kp-1',
          eip_allocation_id: 'eipalloc-1',
          region: 'eu-west-3',
        },
      },
    },
  };
  const migrated = runMigrations(v3) as any;
  expect(migrated.schema_version).toBe(4);
  expect(migrated.deployments['my-bot'].hermes_agent_rev).toBe('unknown');
  expect(migrated.deployments['my-bot'].hermes_agent_tag).toBe('');
  // Existing fields preserved
  expect(migrated.deployments['my-bot'].last_config_hash).toBe('sha256:abc');
  expect(migrated.deployments['my-bot'].last_nix_hash).toBe('sha256:def');
});

it('migrates v0 all the way to v4', () => {
  const v0 = {
    deployments: [
      {
        name: 'legacy',
        project_path: '/legacy',
        cloud: 'aws',
        region: 'eu-west-3',
        last_deployed: '2025-06-01T00:00:00Z',
        aws: {
          instance_id: 'i-old',
          security_group_id: 'sg-old',
          key_pair_name: 'kp-old',
          eip_allocation_id: 'eipalloc-old',
        },
      },
    ],
  };
  const migrated = runMigrations(v0) as any;
  expect(migrated.schema_version).toBe(4);
  expect(migrated.deployments.legacy.hermes_agent_rev).toBe('unknown');
  expect(migrated.deployments.legacy.hermes_agent_tag).toBe('');
});

it('is a no-op on already-current v4 state', () => {
  const v4 = {
    schema_version: 4,
    deployments: {
      bot: {
        hermes_agent_rev: 'abc123',
        hermes_agent_tag: 'v2026.4.16',
      },
    },
  };
  const migrated = runMigrations(v4);
  expect(migrated).toEqual(v4);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/state/migrations.test.ts`
Expected: FAIL — `CURRENT_SCHEMA_VERSION` is still 3, no v4 migration exists.

- [ ] **Step 3: Update existing tests that assert version === 3**

In `tests/unit/state/migrations.test.ts`, update the two existing assertions:

Change `expect(CURRENT_SCHEMA_VERSION).toBe(3)` to `expect(CURRENT_SCHEMA_VERSION).toBe(4)` (there are two of these — update both).

Change the `'is a no-op on already-current v3 state'` test to test v4 instead:

```typescript
it('is a no-op on already-current v4 state', () => {
  const v4 = { schema_version: 4, deployments: {} };
  const migrated = runMigrations(v4);
  expect(migrated).toEqual(v4);
});
```

- [ ] **Step 4: Add v4 migration to migrations.ts**

In `src/state/migrations.ts`, change line 1:

```typescript
export const CURRENT_SCHEMA_VERSION = 4;
```

Add the v4 migration after the v3 migration (after line 76):

```typescript
4: (input: unknown) => {
  // Version management: adds hermes_agent_rev and hermes_agent_tag
  // to each deployment so `ls` can show agent version without SSH.
  // Defaults to 'unknown'/'' — first deploy/update/upgrade populates
  // the real values by reading flake.lock after nixos-rebuild.
  const v3 = input as { schema_version: number; deployments: Record<string, unknown> };
  const deployments: Record<string, unknown> = {};
  for (const [name, dep] of Object.entries(v3.deployments)) {
    deployments[name] = { hermes_agent_rev: 'unknown', hermes_agent_tag: '', ...(dep as object) };
  }
  return { ...v3, schema_version: 4, deployments };
},
```

- [ ] **Step 5: Update state-toml.ts schema**

In `src/schema/state-toml.ts`, change the `schema_version` literal on line 56:

```typescript
schema_version: z.literal(4),
```

Add two new fields to `BaseDeploymentSchema` (after line 38, the `instance_ip` field):

```typescript
hermes_agent_rev: z.string().min(1).default('unknown'),
hermes_agent_tag: z.string().default(''),
```

- [ ] **Step 6: Run all migration tests**

Run: `npx vitest run tests/unit/state/migrations.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Run full test suite to check for regressions**

Run: `npx vitest run`
Expected: All tests PASS. (Some may need the v3->v4 update in fixtures.)

- [ ] **Step 8: Commit**

```bash
git add src/schema/state-toml.ts src/state/migrations.ts tests/unit/state/migrations.test.ts
git commit -m "feat(state): add v4 schema migration for hermes_agent_rev and hermes_agent_tag"
```

---

## Task 2: DTO and reporter type updates

**Files:**
- Modify: `src/schema/dto.ts:5-8,30-31,99-116`
- Modify: `src/orchestrator/reporter.ts:1-8`
- Modify: `src/server/reporter-bus.ts:10`

- [ ] **Step 1: Add 'flake-update' to PhaseId in reporter.ts**

In `src/orchestrator/reporter.ts`, add `'flake-update'` to the `PhaseId` union (after line 7):

```typescript
export type PhaseId =
  | 'validate'
  | 'ensure-keys'
  | 'provision'
  | 'dns'
  | 'wait-ssh'
  | 'bootstrap'
  | 'flake-update'
  | 'healthcheck';
```

- [ ] **Step 2: Add 'flake-update' to PhaseIdSchema in dto.ts**

In `src/schema/dto.ts`, update the `PhaseIdSchema` (line 5-8):

```typescript
export const PhaseIdSchema = z.enum([
  'validate',
  'ensure-keys',
  'provision',
  'dns',
  'wait-ssh',
  'bootstrap',
  'flake-update',
  'healthcheck',
]);
```

- [ ] **Step 3: Add 'upgrade' to JobDtoSchema kind**

In `src/schema/dto.ts`, update the `kind` field in `JobDtoSchema` (line 33):

```typescript
kind: z.enum(['up', 'update', 'destroy', 'adopt', 'upgrade']),
```

- [ ] **Step 4: Add hermes_agent_version to StatusPayloadDtoSchema**

In `src/schema/dto.ts`, add to `StatusPayloadDtoSchema.stored` (after `age_key_path` on line 111):

```typescript
hermes_agent_version: z.object({
  lockedRev: z.string(),
  lockedDate: z.string(),
  lockedTag: z.string().optional(),
}).optional(),
```

- [ ] **Step 5: Add UpdateCheckResponseDto**

In `src/schema/dto.ts`, add at the end of the file (before the request body schemas):

```typescript
// ---------- Update checks (GET /api/updates) ----------

export const UpdateCheckResponseDtoSchema = z.object({
  hermesDeploy: z.object({
    current: z.string(),
    latest: z.string(),
    updateAvailable: z.boolean(),
  }),
  hermesAgent: z.object({
    latest: z.object({
      tag: z.string(),
      name: z.string(),
      publishedAt: z.string(),
      body: z.string(),
    }).nullable(),
  }),
});
export type UpdateCheckResponseDto = z.infer<typeof UpdateCheckResponseDtoSchema>;
```

- [ ] **Step 6: Add 'upgrade' to reporter-bus Job kind**

In `src/server/reporter-bus.ts`, update the `kind` type on line 12:

```typescript
kind: 'up' | 'update' | 'destroy' | 'adopt' | 'upgrade';
```

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add src/schema/dto.ts src/orchestrator/reporter.ts src/server/reporter-bus.ts
git commit -m "feat(schema): add upgrade job kind, flake-update phase, and update check DTOs"
```

---

## Task 3: npm version checker

**Files:**
- Create: `src/updates/npm-check.ts`
- Create: `tests/unit/updates/npm-check.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/updates/npm-check.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkNpmUpdate, _resetCache } from '../../../src/updates/npm-check.js';

describe('checkNpmUpdate', () => {
  beforeEach(() => {
    _resetCache();
  });

  it('detects when an update is available', async () => {
    const fetcher = vi.fn().mockResolvedValue({ version: '2.0.0' });
    const result = await checkNpmUpdate('1.2.1', fetcher);
    expect(result.current).toBe('1.2.1');
    expect(result.latest).toBe('2.0.0');
    expect(result.updateAvailable).toBe(true);
  });

  it('reports up-to-date when versions match', async () => {
    const fetcher = vi.fn().mockResolvedValue({ version: '1.2.1' });
    const result = await checkNpmUpdate('1.2.1', fetcher);
    expect(result.updateAvailable).toBe(false);
  });

  it('reports up-to-date when current is newer', async () => {
    const fetcher = vi.fn().mockResolvedValue({ version: '1.2.0' });
    const result = await checkNpmUpdate('1.2.1', fetcher);
    expect(result.updateAvailable).toBe(false);
  });

  it('caches results and does not re-fetch within TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue({ version: '2.0.0' });
    await checkNpmUpdate('1.2.1', fetcher);
    await checkNpmUpdate('1.2.1', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns updateAvailable=false on fetch error', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network'));
    const result = await checkNpmUpdate('1.2.1', fetcher);
    expect(result.updateAvailable).toBe(false);
    expect(result.latest).toBe('1.2.1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/updates/npm-check.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement npm-check.ts**

Create `src/updates/npm-check.ts`:

```typescript
import { request } from 'node:https';

export interface NpmCheckResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

interface NpmVersionPayload {
  version: string;
}

export type NpmFetcher = () => Promise<NpmVersionPayload>;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cached: { result: NpmCheckResult; expiresAt: number } | null = null;

/** Visible for testing — resets the in-memory cache. */
export function _resetCache(): void {
  cached = null;
}

const defaultFetcher: NpmFetcher = () =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'registry.npmjs.org',
        path: '/@paulcailly%2fhermes-deploy/latest',
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('invalid JSON from npm registry'));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => {
      req.destroy(new Error('npm registry timeout'));
    });
    req.end();
  });

/**
 * Compare the current hermes-deploy version against the npm registry.
 * Results are cached in memory for 1 hour. On fetch failure, returns
 * updateAvailable=false so callers never need to handle errors.
 */
export async function checkNpmUpdate(
  currentVersion: string,
  fetcher: NpmFetcher = defaultFetcher,
): Promise<NpmCheckResult> {
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }

  try {
    const data = await fetcher();
    const latest = data.version;
    const updateAvailable = compareSemver(latest, currentVersion) > 0;
    const result: NpmCheckResult = { current: currentVersion, latest, updateAvailable };
    cached = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  } catch {
    const result: NpmCheckResult = {
      current: currentVersion,
      latest: currentVersion,
      updateAvailable: false,
    };
    return result;
  }
}

/**
 * Simple semver compare: returns >0 if a > b, 0 if equal, <0 if a < b.
 * Only handles numeric major.minor.patch — sufficient for our use case.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/updates/npm-check.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updates/npm-check.ts tests/unit/updates/npm-check.test.ts
git commit -m "feat(updates): add npm registry version checker with in-memory cache"
```

---

## Task 4: GitHub releases checker for hermes-agent

**Files:**
- Create: `src/updates/hermes-agent-check.ts`
- Create: `tests/unit/updates/hermes-agent-check.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/updates/hermes-agent-check.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkHermesAgentRelease,
  _resetCache,
  type GitHubRelease,
} from '../../../src/updates/hermes-agent-check.js';

const fakeRelease: GitHubRelease = {
  tag_name: 'v2026.4.16',
  name: 'Hermes Agent v0.10.0 (2026.4.16)',
  published_at: '2026-04-16T19:53:25Z',
  body: '# Release notes\n\nSome changes.',
};

describe('checkHermesAgentRelease', () => {
  beforeEach(() => {
    _resetCache();
  });

  it('returns the latest release', async () => {
    const fetcher = vi.fn().mockResolvedValue([fakeRelease]);
    const result = await checkHermesAgentRelease(fetcher);
    expect(result).not.toBeNull();
    expect(result!.tag).toBe('v2026.4.16');
    expect(result!.name).toBe('Hermes Agent v0.10.0 (2026.4.16)');
    expect(result!.publishedAt).toBe('2026-04-16T19:53:25Z');
    expect(result!.body).toContain('Release notes');
  });

  it('returns null when no releases exist', async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    const result = await checkHermesAgentRelease(fetcher);
    expect(result).toBeNull();
  });

  it('caches results within TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue([fakeRelease]);
    await checkHermesAgentRelease(fetcher);
    await checkHermesAgentRelease(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns null on fetch error', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network'));
    const result = await checkHermesAgentRelease(fetcher);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/updates/hermes-agent-check.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement hermes-agent-check.ts**

Create `src/updates/hermes-agent-check.ts`:

```typescript
import { request } from 'node:https';

export interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  body: string;
}

export interface LatestAgentRelease {
  tag: string;
  name: string;
  publishedAt: string;
  body: string;
}

export type ReleaseFetcher = () => Promise<GitHubRelease[]>;

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
let cached: { result: LatestAgentRelease | null; expiresAt: number } | null = null;

/** Visible for testing. */
export function _resetCache(): void {
  cached = null;
}

const defaultFetcher: ReleaseFetcher = () =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'api.github.com',
        path: '/repos/NousResearch/hermes-agent/releases?per_page=5',
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'hermes-deploy',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('invalid JSON from GitHub API'));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => {
      req.destroy(new Error('GitHub API timeout'));
    });
    req.end();
  });

/**
 * Fetch the latest hermes-agent release from GitHub. Returns null if
 * no releases exist or on network error. Cached for 15 minutes.
 */
export async function checkHermesAgentRelease(
  fetcher: ReleaseFetcher = defaultFetcher,
): Promise<LatestAgentRelease | null> {
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }

  try {
    const releases = await fetcher();
    if (!Array.isArray(releases) || releases.length === 0) {
      cached = { result: null, expiresAt: Date.now() + CACHE_TTL_MS };
      return null;
    }
    const latest = releases[0]!;
    const result: LatestAgentRelease = {
      tag: latest.tag_name,
      name: latest.name,
      publishedAt: latest.published_at,
      body: latest.body,
    };
    cached = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/updates/hermes-agent-check.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updates/hermes-agent-check.ts tests/unit/updates/hermes-agent-check.test.ts
git commit -m "feat(updates): add GitHub releases checker for hermes-agent with 15m cache"
```

---

## Task 5: CLI file-based update cache

**Files:**
- Create: `src/updates/cli-update-check.ts`
- Create: `tests/unit/updates/cli-update-check.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/updates/cli-update-check.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkCliUpdate } from '../../../src/updates/cli-update-check.js';

describe('checkCliUpdate', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hermes-update-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('fetches from npm and writes cache file', async () => {
    const fetcher = vi.fn().mockResolvedValue({ version: '2.0.0' });
    const cacheFile = join(tempDir, 'npm-update-check.json');
    const result = await checkCliUpdate('1.2.1', cacheFile, fetcher);
    expect(result.updateAvailable).toBe(true);
    expect(result.latest).toBe('2.0.0');
    expect(existsSync(cacheFile)).toBe(true);
  });

  it('reads from cache when within TTL', async () => {
    const cacheFile = join(tempDir, 'npm-update-check.json');
    const cacheData = {
      latest: '3.0.0',
      checkedAt: Date.now(),
    };
    writeFileSync(cacheFile, JSON.stringify(cacheData));

    const fetcher = vi.fn();
    const result = await checkCliUpdate('1.2.1', cacheFile, fetcher);
    expect(result.latest).toBe('3.0.0');
    expect(result.updateAvailable).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('re-fetches when cache is expired', async () => {
    const cacheFile = join(tempDir, 'npm-update-check.json');
    const cacheData = {
      latest: '1.0.0',
      checkedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
    };
    writeFileSync(cacheFile, JSON.stringify(cacheData));

    const fetcher = vi.fn().mockResolvedValue({ version: '2.0.0' });
    const result = await checkCliUpdate('1.2.1', cacheFile, fetcher);
    expect(result.latest).toBe('2.0.0');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns up-to-date on fetch failure with no cache', async () => {
    const cacheFile = join(tempDir, 'npm-update-check.json');
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await checkCliUpdate('1.2.1', cacheFile, fetcher);
    expect(result.updateAvailable).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/updates/cli-update-check.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement cli-update-check.ts**

Create `src/updates/cli-update-check.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NpmFetcher, NpmCheckResult } from './npm-check.js';

interface CacheEntry {
  latest: string;
  checkedAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * File-based npm update check for CLI commands. Reads/writes a JSON
 * cache file to avoid hitting the npm registry on every invocation.
 * Falls back to "up-to-date" on any error.
 */
export async function checkCliUpdate(
  currentVersion: string,
  cacheFile: string,
  fetcher?: NpmFetcher,
): Promise<NpmCheckResult> {
  // Try reading cache
  try {
    const raw = readFileSync(cacheFile, 'utf-8');
    const cache: CacheEntry = JSON.parse(raw);
    if (Date.now() - cache.checkedAt < CACHE_TTL_MS) {
      const updateAvailable = compareSemver(cache.latest, currentVersion) > 0;
      return { current: currentVersion, latest: cache.latest, updateAvailable };
    }
  } catch {
    // No cache or invalid — fetch fresh
  }

  // Fetch from npm
  if (!fetcher) {
    const { checkNpmUpdate } = await import('./npm-check.js');
    return checkNpmUpdate(currentVersion);
  }

  try {
    const data = await fetcher();
    const latest = data.version;
    const entry: CacheEntry = { latest, checkedAt: Date.now() };
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(entry));
    } catch {
      // Cache write failure is non-fatal
    }
    const updateAvailable = compareSemver(latest, currentVersion) > 0;
    return { current: currentVersion, latest, updateAvailable };
  } catch {
    return { current: currentVersion, latest: currentVersion, updateAvailable: false };
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/updates/cli-update-check.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updates/cli-update-check.ts tests/unit/updates/cli-update-check.test.ts
git commit -m "feat(updates): add file-based CLI update cache with 24h TTL"
```

---

## Task 6: Remote flake.lock reader

**Files:**
- Create: `src/remote-ops/read-flake-lock.ts`
- Create: `tests/unit/remote-ops/read-flake-lock.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/remote-ops/read-flake-lock.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { readHermesAgentVersion } from '../../../src/remote-ops/read-flake-lock.js';
import type { SshSession } from '../../../src/remote-ops/session.js';

function mockSession(stdout: string): SshSession {
  return {
    exec: vi.fn().mockResolvedValue({ stdout, stderr: '', exitCode: 0 }),
    execStream: vi.fn(),
    execStreamUntil: vi.fn(),
    uploadFile: vi.fn(),
    shell: vi.fn(),
    dispose: vi.fn(),
  } as unknown as SshSession;
}

const FAKE_FLAKE_LOCK = JSON.stringify({
  nodes: {
    'hermes-agent': {
      locked: {
        lastModified: 1713293605,
        rev: 'abc123def456789',
        type: 'github',
      },
    },
    root: {
      inputs: { 'hermes-agent': 'hermes-agent' },
    },
  },
  root: 'root',
  version: 7,
});

describe('readHermesAgentVersion', () => {
  it('extracts rev and date from flake.lock', async () => {
    const session = mockSession(FAKE_FLAKE_LOCK);
    const result = await readHermesAgentVersion(session);
    expect(result).not.toBeNull();
    expect(result!.lockedRev).toBe('abc123def456789');
    expect(result!.lockedDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns null on SSH error', async () => {
    const session = {
      exec: vi.fn().mockRejectedValue(new Error('connection lost')),
    } as unknown as SshSession;
    const result = await readHermesAgentVersion(session);
    expect(result).toBeNull();
  });

  it('returns null when flake.lock has no hermes-agent node', async () => {
    const session = mockSession(JSON.stringify({
      nodes: { root: {} },
      root: 'root',
      version: 7,
    }));
    const result = await readHermesAgentVersion(session);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/remote-ops/read-flake-lock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement read-flake-lock.ts**

Create `src/remote-ops/read-flake-lock.ts`:

```typescript
import type { SshSession } from './session.js';

export interface FlakeLockVersion {
  lockedRev: string;
  lockedDate: string;
}

/**
 * Read `/etc/nixos/flake.lock` on a remote box and extract the
 * hermes-agent flake input's locked revision and last-modified date.
 * Returns null on any error (SSH failure, missing file, parse error).
 */
export async function readHermesAgentVersion(
  session: SshSession,
): Promise<FlakeLockVersion | null> {
  try {
    const result = await session.exec('cat /etc/nixos/flake.lock 2>/dev/null');
    const lock = JSON.parse(result.stdout);
    const node = lock?.nodes?.['hermes-agent'];
    if (!node?.locked?.rev) return null;

    const rev: string = node.locked.rev;
    const lastModified: number = node.locked.lastModified;
    const lockedDate = new Date(lastModified * 1000).toISOString();

    return { lockedRev: rev, lockedDate };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/remote-ops/read-flake-lock.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote-ops/read-flake-lock.ts tests/unit/remote-ops/read-flake-lock.test.ts
git commit -m "feat(remote-ops): add flake.lock reader for hermes-agent version"
```

---

## Task 7: Upgrade orchestrator

**Files:**
- Create: `src/orchestrator/upgrade.ts`
- Create: `tests/unit/orchestrator/upgrade.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/orchestrator/upgrade.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runUpgrade } from '../../../src/orchestrator/upgrade.js';
import type { SshSession } from '../../../src/remote-ops/session.js';
import type { Reporter } from '../../../src/orchestrator/reporter.js';

function stubReporter(): Reporter {
  return {
    phaseStart: vi.fn(),
    phaseDone: vi.fn(),
    phaseFail: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  };
}

function stubSession(
  flakeLock: string = '{}',
  flakeUpdateOk: boolean = true,
): SshSession {
  return {
    exec: vi.fn().mockImplementation((cmd: string) => {
      if (cmd.includes('cat /etc/nixos/flake.lock')) {
        return Promise.resolve({ stdout: flakeLock, stderr: '', exitCode: 0 });
      }
      if (cmd.includes('nix flake update')) {
        if (!flakeUpdateOk) return Promise.resolve({ stdout: '', stderr: 'error', exitCode: 1 });
        return Promise.resolve({ stdout: 'Updated hermes-agent', stderr: '', exitCode: 0 });
      }
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
    }),
    dispose: vi.fn(),
  } as unknown as SshSession;
}

describe('runUpgrade', () => {
  it('throws when the nix flake update command fails', async () => {
    const session = stubSession('{}', false);
    const reporter = stubReporter();
    await expect(
      runUpgrade({
        deploymentName: 'test',
        sessionFactory: async () => session,
        nixosRebuildRunner: vi.fn().mockResolvedValue({ success: true, tail: [] }),
        healthchecker: vi.fn().mockResolvedValue({ health: 'healthy', journalTail: [] }),
        stateUpdater: vi.fn(),
        reporter,
      }),
    ).rejects.toThrow(/nix flake update failed/);
    expect(reporter.phaseFail).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/orchestrator/upgrade.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement upgrade.ts**

Create `src/orchestrator/upgrade.ts`:

```typescript
import { readHermesAgentVersion } from '../remote-ops/read-flake-lock.js';
import type { RebuildResult } from '../remote-ops/nixos-rebuild.js';
import type { SshSession } from '../remote-ops/session.js';
import type { Reporter } from './reporter.js';

export interface UpgradeOptions {
  deploymentName: string;
  sessionFactory: () => Promise<SshSession>;
  /** Injected for testability — defaults to runNixosRebuild. */
  nixosRebuildRunner: (
    sessionFactory: () => Promise<SshSession>,
    onLine: (stream: 'stdout' | 'stderr', line: string) => void,
  ) => Promise<RebuildResult>;
  /** Injected for testability — polls hermes-agent.service health. */
  healthchecker: (session: SshSession) => Promise<{ health: 'healthy' | 'unhealthy'; journalTail: string[] }>;
  /** Callback to persist the new rev+tag+nixHash in state.toml. */
  stateUpdater: (rev: string, tag: string) => Promise<void>;
  reporter: Reporter;
}

const NIX_CONFIG_PREFIX =
  'NIX_CONFIG="experimental-features = nix-command flakes"';

const FLAKE_UPDATE_COMMAND =
  `${NIX_CONFIG_PREFIX} nix flake update hermes-agent --flake /etc/nixos`;

/**
 * Upgrade the hermes-agent framework on a deployed instance:
 *   1. nix flake update hermes-agent (pin to latest upstream)
 *   2. nixos-rebuild switch (rebuild with the new closure)
 *   3. healthcheck
 *   4. persist new revision in state.toml
 */
export async function runUpgrade(opts: UpgradeOptions): Promise<void> {
  const { reporter } = opts;

  // Phase 1 — update the flake input
  reporter.phaseStart('flake-update', 'Updating hermes-agent flake input');
  const session = await opts.sessionFactory();
  try {
    const result = await session.exec(FLAKE_UPDATE_COMMAND);
    if (result.exitCode !== undefined && result.exitCode !== 0) {
      reporter.phaseFail('flake-update', 'nix flake update failed');
      throw new Error(`nix flake update failed:\n${result.stderr || result.stdout}`);
    }
    reporter.phaseDone('flake-update');
  } finally {
    await session.dispose();
  }

  // Phase 2 — nixos-rebuild switch
  reporter.phaseStart('bootstrap', 'Running nixos-rebuild switch');
  const rebuild = await opts.nixosRebuildRunner(
    opts.sessionFactory,
    (_stream, line) => reporter.log(line),
  );
  if (!rebuild.success) {
    reporter.phaseFail('bootstrap', 'nixos-rebuild failed');
    throw new Error(`nixos-rebuild failed:\n${rebuild.tail.join('\n')}`);
  }
  reporter.phaseDone('bootstrap');

  // Phase 3 — healthcheck
  reporter.phaseStart('healthcheck', 'Waiting for hermes-agent.service');
  const healthSession = await opts.sessionFactory();
  try {
    const health = await opts.healthchecker(healthSession);
    if (health.health === 'unhealthy') {
      reporter.phaseFail('healthcheck', 'service is not active after upgrade');
      for (const line of health.journalTail) reporter.log(line);
      throw new Error('hermes-agent unhealthy after upgrade');
    }
    reporter.phaseDone('healthcheck');

    // Phase 4 — read new version from flake.lock and persist
    const version = await readHermesAgentVersion(healthSession);
    const rev = version?.lockedRev ?? 'unknown';
    const tag = ''; // Tag matching is done server-side via the releases cache
    await opts.stateUpdater(rev, tag);

    reporter.success(`${opts.deploymentName} upgraded to ${rev.slice(0, 12)}`);
  } finally {
    await healthSession.dispose();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/orchestrator/upgrade.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/upgrade.ts tests/unit/orchestrator/upgrade.test.ts
git commit -m "feat(orchestrator): add upgrade flow for hermes-agent flake update"
```

---

## Task 8: Persist agent version after rebuild in shared.ts

**Files:**
- Modify: `src/orchestrator/shared.ts:73-117,142-194`

- [ ] **Step 1: Import readHermesAgentVersion in shared.ts**

At the top of `src/orchestrator/shared.ts`, add:

```typescript
import { readHermesAgentVersion } from '../remote-ops/read-flake-lock.js';
```

- [ ] **Step 2: Read flake.lock after successful rebuild in uploadAndRebuild**

In `src/orchestrator/shared.ts`, in `uploadAndRebuild()`, after `if (!rebuild.success)` block and before the closing `}` of the function (after line 116), add a return value:

Replace the function signature and body from line 73 to return the version:

Change the return type of `uploadAndRebuild` to `Promise<{ lockedRev?: string }>` and add at the end of the function (before the closing `}`):

```typescript
// Read the updated flake.lock to capture the hermes-agent revision.
// This runs after a successful rebuild — the session may have died
// during activation, so use sessionFactory for a fresh connection.
try {
  const freshSession = await args.sessionFactory();
  try {
    const version = await readHermesAgentVersion(freshSession);
    return { lockedRev: version?.lockedRev };
  } finally {
    await freshSession.dispose();
  }
} catch {
  return {};
}
```

- [ ] **Step 3: Persist hermes_agent_rev in recordConfigAndHealthcheck**

In `src/orchestrator/shared.ts`, update the `HealthcheckArgs` interface to accept the optional rev:

```typescript
export interface HealthcheckArgs {
  session: SshSession;
  store: StateStore;
  deploymentName: string;
  projectDir: string;
  tomlPath: string;
  config: HermesTomlConfig;
  healthcheckTimeoutMs?: number;
  hermesAgentRev?: string;
}
```

In `recordConfigAndHealthcheck`, in the first `store.update` call (around line 182-187), add:

```typescript
if (args.hermesAgentRev) {
  d.hermes_agent_rev = args.hermesAgentRev;
}
```

- [ ] **Step 4: Update callers to pass the rev through**

In `src/orchestrator/update.ts`, the `uploadAndRebuild` call (around line 192-200) now returns a result. Capture it:

```typescript
const rebuildResult = await uploadAndRebuild({
  // ... existing args
});
```

Then pass `hermesAgentRev` to `recordConfigAndHealthcheck`:

```typescript
const health = await recordConfigAndHealthcheck({
  // ... existing args
  hermesAgentRev: rebuildResult.lockedRev,
});
```

Do the same in `src/orchestrator/deploy.ts` — find the `uploadAndRebuild` and `recordConfigAndHealthcheck` calls and thread the rev through.

- [ ] **Step 5: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/shared.ts src/orchestrator/update.ts src/orchestrator/deploy.ts
git commit -m "feat(orchestrator): persist hermes_agent_rev in state after each rebuild"
```

---

## Task 9: Server-side /api/updates route

**Files:**
- Create: `src/server/routes/updates.ts`
- Modify: `src/server/index.ts:19,61`

- [ ] **Step 1: Create the updates route**

Create `src/server/routes/updates.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { checkNpmUpdate } from '../../updates/npm-check.js';
import { checkHermesAgentRelease } from '../../updates/hermes-agent-check.js';

declare const HERMES_DEPLOY_VERSION: string;

export async function updateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/updates', async () => {
    const [npmResult, agentRelease] = await Promise.all([
      checkNpmUpdate(HERMES_DEPLOY_VERSION),
      checkHermesAgentRelease(),
    ]);

    return {
      hermesDeploy: npmResult,
      hermesAgent: {
        latest: agentRelease,
      },
    };
  });
}
```

- [ ] **Step 2: Register the route in server/index.ts**

In `src/server/index.ts`, add the import (after line 19):

```typescript
import { updateRoutes } from './routes/updates.js';
```

Add route registration (after the `orgRoutes` registration, around line 61):

```typescript
await app.register(async (instance) => updateRoutes(instance));
```

- [ ] **Step 3: Add HERMES_DEPLOY_VERSION to the server build**

The `updateRoutes` file uses `HERMES_DEPLOY_VERSION`. This constant is already injected by tsup for the CLI entry point (`src/cli.ts`), but the server code is bundled through the same CLI entry, so it will be available. Verify by checking that `tsup.config.ts` defines it in the CLI build config — it does (line 26). No change needed.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/updates.ts src/server/index.ts
git commit -m "feat(server): add GET /api/updates route for version checking"
```

---

## Task 10: Extend GET /api/deployments/:name with agent version

**Files:**
- Modify: `src/server/routes/deployments.ts:32-83`

- [ ] **Step 1: Import readHermesAgentVersion**

At the top of `src/server/routes/deployments.ts`, add:

```typescript
import { readHermesAgentVersion } from '../../remote-ops/read-flake-lock.js';
import { createSshSession } from '../../remote-ops/session.js';
import { readFileSync } from 'node:fs';
```

- [ ] **Step 2: Add agent version to the GET :name response**

In the `GET /api/deployments/:name` handler, after the `domain` check and before the `return` statement (around line 63-82), add:

```typescript
// Read hermes-agent version from remote flake.lock (best-effort)
let hermesAgentVersion: { lockedRev: string; lockedDate: string; lockedTag?: string } | undefined;
if (live.state === 'running') {
  try {
    const privateKey = readFileSync(deployment.ssh_key_path, 'utf-8');
    const session = await createSshSession({
      host: deployment.instance_ip,
      username: 'root',
      privateKey,
    });
    try {
      const version = await readHermesAgentVersion(session);
      if (version) {
        hermesAgentVersion = {
          lockedRev: version.lockedRev,
          lockedDate: version.lockedDate,
        };
      }
    } finally {
      await session.dispose();
    }
  } catch {
    // SSH failed — fall back to stored rev if available
  }
}

// Fall back to stored rev from state.toml
if (!hermesAgentVersion && deployment.hermes_agent_rev !== 'unknown') {
  hermesAgentVersion = {
    lockedRev: deployment.hermes_agent_rev,
    lockedDate: deployment.last_deployed_at,
    lockedTag: deployment.hermes_agent_tag || undefined,
  };
}
```

Then add `hermes_agent_version: hermesAgentVersion` to the `stored` object in the return statement.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/deployments.ts
git commit -m "feat(server): expose hermes_agent_version in deployment status endpoint"
```

---

## Task 11: Add POST /api/deployments/:name/upgrade route

**Files:**
- Modify: `src/server/routes/deployments.ts`

- [ ] **Step 1: Import upgrade orchestrator**

At the top of `src/server/routes/deployments.ts`, add:

```typescript
import { runUpgrade } from '../../orchestrator/upgrade.js';
import { runNixosRebuild } from '../../remote-ops/nixos-rebuild.js';
import { pollHermesHealth } from '../../remote-ops/healthcheck.js';
```

- [ ] **Step 2: Add the upgrade route**

After the `POST /api/deployments/:name/destroy` handler (before the adopt handler), add:

```typescript
// POST /api/deployments/:name/upgrade
app.post<{ Params: { name: string } }>(
  '/api/deployments/:name/upgrade',
  async (request, reply) => {
    const { name } = request.params;

    const existingJob = singleFlight.isRunning(name);
    if (existingJob) {
      reply.code(409).send({ error: 'busy', currentJobId: existingJob });
      return;
    }

    const paths = getStatePaths();
    const store = new StateStore(paths);
    const state = await store.read();
    const deployment = state.deployments[name];
    if (!deployment) {
      reply.code(404).send({ error: `deployment "${name}" not found` });
      return;
    }

    const { jobId, reporter } = bus.createJob(name, 'upgrade');
    if (!singleFlight.acquire(name, jobId)) {
      reply.code(409).send({ error: 'busy', currentJobId: singleFlight.isRunning(name) });
      return;
    }

    const privateKeyContent = readFileSync(deployment.ssh_key_path, 'utf-8');

    runUpgrade({
      deploymentName: name,
      sessionFactory: () =>
        createSshSession({
          host: deployment.instance_ip,
          username: 'root',
          privateKey: privateKeyContent,
        }),
      nixosRebuildRunner: runNixosRebuild,
      healthchecker: (session) => pollHermesHealth(session),
      stateUpdater: async (rev, tag) => {
        await store.update((s) => {
          const d = s.deployments[name]!;
          d.hermes_agent_rev = rev;
          d.hermes_agent_tag = tag;
          d.last_deployed_at = new Date().toISOString();
        });
      },
      reporter,
    }).then(
      () => { bus.finish(jobId); singleFlight.release(name, jobId); },
      (err) => { bus.fail(jobId, (err as Error).message); singleFlight.release(name, jobId); },
    );

    reply.code(202).send({ jobId });
  },
);
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/deployments.ts
git commit -m "feat(server): add POST /api/deployments/:name/upgrade endpoint"
```

---

## Task 12: CLI — status command agent version + update notice

**Files:**
- Modify: `src/commands/status.ts`

- [ ] **Step 1: Add agent version to status output**

In `src/commands/status.ts`, add import at top:

```typescript
import { readHermesAgentVersion } from '../remote-ops/read-flake-lock.js';
import { createSshSession } from '../remote-ops/session.js';
import { readFileSync } from 'node:fs';
import { checkCliUpdate } from '../updates/cli-update-check.js';
import { join } from 'node:path';
```

After the human-formatted output block (after line 108 `console.log(\`  SSH key:     ${deployment.ssh_key_path}\`)`), add:

```typescript
// Hermes Agent version (read from remote flake.lock)
if (live.state === 'running') {
  try {
    const privateKey = readFileSync(deployment.ssh_key_path, 'utf-8');
    const sshSession = await createSshSession({
      host: deployment.instance_ip,
      username: 'root',
      privateKey,
    });
    try {
      const version = await readHermesAgentVersion(sshSession);
      if (version) {
        const shortRev = version.lockedRev.slice(0, 12);
        const date = version.lockedDate.slice(0, 10);
        console.log(`  Agent:       ${shortRev} (${date})`);
      }
    } finally {
      await sshSession.dispose();
    }
  } catch {
    // SSH failed — skip agent version
  }
}
```

Also add the `hermes_agent_version` to the JSON payload in `StatusPayload` interface and the return object when live.

- [ ] **Step 2: Add npm update notice at end of command**

After all output (after the domain section, at the very end of `statusCommand`), add:

```typescript
// npm update notice (non-blocking, best-effort)
try {
  const paths = getStatePaths();
  const cacheFile = join(paths.configDir, 'npm-update-check.json');
  const check = await checkCliUpdate(HERMES_DEPLOY_VERSION, cacheFile);
  if (check.updateAvailable) {
    console.error(
      `\nUpdate available: @paulcailly/hermes-deploy@${check.latest} (current: ${check.current})` +
      `\nRun: npm install -g @paulcailly/hermes-deploy@latest`,
    );
  }
} catch {
  // Non-fatal
}
```

Add the `HERMES_DEPLOY_VERSION` declare at the top of the file:

```typescript
declare const HERMES_DEPLOY_VERSION: string;
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/commands/status.ts
git commit -m "feat(cli): show hermes-agent version and npm update notice in status"
```

---

## Task 13: CLI — ls command agent column + update notice

**Files:**
- Modify: `src/commands/ls.ts`

- [ ] **Step 1: Add AGENT column to ls table**

In `src/commands/ls.ts`, update the `DeploymentSummary` interface to include the stored agent tag/rev. Since `collectDeploymentSummaries` reads from state.toml, add:

```typescript
hermesAgentTag?: string;
hermesAgentRev?: string;
```

In `collectDeploymentSummaries`, populate them from the deployment record:

```typescript
summary.hermesAgentTag = (d as any).hermes_agent_tag || '';
summary.hermesAgentRev = (d as any).hermes_agent_rev || 'unknown';
```

Update the table header to add `AGENT`:

```typescript
const header = ['NAME', 'CLOUD', 'REGION', 'IP', 'AGENT', 'STORED', 'LIVE', 'LAST DEPLOYED'];
```

Update the row mapping to include the agent version:

```typescript
const agentLabel = s.hermesAgentTag || (s.hermesAgentRev && s.hermesAgentRev !== 'unknown' ? s.hermesAgentRev.slice(0, 10) : '-');
```

Add `agentLabel` to the row array in the correct position (after IP).

- [ ] **Step 2: Add npm update notice after table**

After the table output loop (after line 129), add:

```typescript
// npm update notice
try {
  const { checkCliUpdate } = await import('../updates/cli-update-check.js');
  const { getStatePaths } = await import('../state/paths.js');
  const { join } = await import('node:path');
  const paths = getStatePaths();
  const cacheFile = join(paths.configDir, 'npm-update-check.json');

  declare const HERMES_DEPLOY_VERSION: string;
  const check = await checkCliUpdate(HERMES_DEPLOY_VERSION, cacheFile);
  if (check.updateAvailable) {
    console.error(
      `\nUpdate available: @paulcailly/hermes-deploy@${check.latest} (current: ${check.current})` +
      `\nRun: npm install -g @paulcailly/hermes-deploy@latest`,
    );
  }
} catch {
  // Non-fatal
}
```

Note: Move the `declare const HERMES_DEPLOY_VERSION: string;` to the top of the file instead.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/commands/ls.ts
git commit -m "feat(cli): add AGENT column to ls and npm update notice"
```

---

## Task 14: CLI — dashboard startup update notice

**Files:**
- Modify: `src/commands/dashboard.ts`

- [ ] **Step 1: Add update check on dashboard startup**

In `src/commands/dashboard.ts`, add imports:

```typescript
import { checkCliUpdate } from '../updates/cli-update-check.js';
import { getStatePaths } from '../state/paths.js';
import { join } from 'node:path';

declare const HERMES_DEPLOY_VERSION: string;
```

After the `console.log(\`  ${publicUrl}\n\`)` line (line 32), add:

```typescript
// Best-effort npm update check
try {
  const paths = getStatePaths();
  const cacheFile = join(paths.configDir, 'npm-update-check.json');
  const check = await checkCliUpdate(HERMES_DEPLOY_VERSION, cacheFile);
  if (check.updateAvailable) {
    console.log(
      `  Update available: hermes-deploy v${check.latest} — npm install -g @paulcailly/hermes-deploy@latest\n`,
    );
  }
} catch {
  // Non-fatal
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/dashboard.ts
git commit -m "feat(cli): show update notice on dashboard startup"
```

---

## Task 15: Dashboard — global UpdateBanner component

**Files:**
- Create: `web/src/components/UpdateBanner.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Create UpdateBanner component**

Create `web/src/components/UpdateBanner.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';

interface UpdateCheckResponse {
  hermesDeploy: {
    current: string;
    latest: string;
    updateAvailable: boolean;
  };
}

export function UpdateBanner() {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('hermes-deploy-update-dismissed') === 'true',
  );

  const { data } = useQuery({
    queryKey: ['update-check'],
    queryFn: () => apiFetch<UpdateCheckResponse>('/api/updates'),
    refetchInterval: 60_000,
    retry: false,
  });

  if (dismissed || !data?.hermesDeploy.updateAvailable) return null;

  function dismiss() {
    sessionStorage.setItem('hermes-deploy-update-dismissed', 'true');
    setDismissed(true);
  }

  return (
    <div className="px-4 py-3 flex items-start gap-3 border-b bg-indigo-500/10 border-indigo-500/30 text-sm">
      <i className="fa-solid fa-arrow-up-right-dots text-indigo-400 text-base mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-indigo-300">
          hermes-deploy v{data.hermesDeploy.latest} is available
        </div>
        <div className="text-[12px] text-slate-400 mt-0.5 leading-relaxed">
          You have v{data.hermesDeploy.current}. Run{' '}
          <code className="bg-black/30 px-1 rounded font-mono text-slate-300">
            npm install -g @paulcailly/hermes-deploy@latest
          </code>
        </div>
      </div>
      <button
        className="text-[12px] text-slate-500 hover:text-slate-200 px-2 py-1 rounded transition-colors flex-shrink-0"
        onClick={dismiss}
        title="Dismiss"
      >
        <i className="fa-solid fa-xmark" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add UpdateBanner to App.tsx**

In `web/src/App.tsx`, add the import:

```typescript
import { UpdateBanner } from './components/UpdateBanner';
```

In the `return` block, add `<UpdateBanner />` right after `<ConnectionBanner ... />`:

```tsx
<ConnectionBanner
  error={agentsError}
  onRetry={() => qc.invalidateQueries({ queryKey: ['agents'] })}
/>
<UpdateBanner />
```

- [ ] **Step 3: Run web typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/UpdateBanner.tsx web/src/App.tsx
git commit -m "feat(web): add global hermes-deploy update banner"
```

---

## Task 16: Dashboard — per-agent AgentUpdateBanner

**Files:**
- Create: `web/src/features/agent/AgentUpdateBanner.tsx`
- Modify: `web/src/features/agent/AgentWorkspace.tsx`

- [ ] **Step 1: Create AgentUpdateBanner component**

Create `web/src/features/agent/AgentUpdateBanner.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { JobDrawer } from '../jobs/JobDrawer';
import type { Navigate } from '../../lib/types';

interface UpdateCheckResponse {
  hermesAgent: {
    latest: {
      tag: string;
      name: string;
      publishedAt: string;
      body: string;
    } | null;
  };
}

interface AgentUpdateBannerProps {
  name: string;
  lockedRev?: string;
  lockedDate?: string;
  lockedTag?: string;
  navigate: Navigate;
}

export function AgentUpdateBanner({
  name,
  lockedRev,
  lockedDate,
  lockedTag,
  navigate,
}: AgentUpdateBannerProps) {
  const [showChangelog, setShowChangelog] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['update-check'],
    queryFn: () => apiFetch<UpdateCheckResponse>('/api/updates'),
    refetchInterval: 60_000,
    retry: false,
  });

  const latest = data?.hermesAgent.latest;
  if (!latest) return null;
  if (!lockedDate) return null;

  // Compare: update available if locked date is before latest release date
  const lockedTime = new Date(lockedDate).getTime();
  const latestTime = new Date(latest.publishedAt).getTime();
  if (lockedTime >= latestTime) return null;

  const deployedLabel = lockedTag || (lockedRev ? lockedRev.slice(0, 10) : 'unknown');

  async function triggerUpgrade() {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiFetch<{ jobId: string }>(
        `/api/deployments/${encodeURIComponent(name)}/upgrade`,
        { method: 'POST' },
      );
      setJobId(res.jobId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upgrade failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="px-4 py-3 flex items-start gap-3 border-b bg-indigo-500/10 border-indigo-500/30 text-sm">
        <i className="fa-solid fa-arrow-up-right-dots text-indigo-400 text-base mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-indigo-300">
            {latest.name} available
          </div>
          <div className="text-[12px] text-slate-400 mt-0.5 leading-relaxed">
            Deployed: {deployedLabel}
            <button
              className="ml-3 text-indigo-400 hover:text-indigo-300 underline"
              onClick={() => setShowChangelog((v) => !v)}
            >
              {showChangelog ? 'Hide changelog' : 'View changelog'}
            </button>
          </div>
          {showChangelog && (
            <div className="mt-3 p-3 bg-black/20 rounded text-[12px] text-slate-300 leading-relaxed max-h-64 overflow-auto whitespace-pre-wrap">
              {latest.body}
            </div>
          )}
          {error && (
            <div className="mt-2 text-red-400 text-[12px]">{error}</div>
          )}
        </div>
        <button
          className="text-[12px] bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded transition-colors flex-shrink-0"
          onClick={triggerUpgrade}
          disabled={submitting || !!jobId}
        >
          {submitting ? (
            <><i className="fa-solid fa-spinner fa-spin mr-1" />Upgrading...</>
          ) : (
            <><i className="fa-solid fa-download mr-1" />Upgrade</>
          )}
        </button>
      </div>
      {jobId && (
        <div className="px-4 py-2">
          <JobDrawer
            jobId={jobId}
            onClose={() => setJobId(null)}
            onFullScreen={() => navigate({ page: 'job', jobId })}
          />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Add AgentUpdateBanner to AgentWorkspace**

In `web/src/features/agent/AgentWorkspace.tsx`, add the import:

```typescript
import { AgentUpdateBanner } from './AgentUpdateBanner';
```

In the return JSX, add the banner between `<AgentTabBar>` and the tab content div:

```tsx
<AgentHeader name={name} status={status} />
<AgentTabBar active={tab} onSelect={onTabSelect} />
<AgentUpdateBanner
  name={name}
  lockedRev={status?.stored?.hermes_agent_version?.lockedRev}
  lockedDate={status?.stored?.hermes_agent_version?.lockedDate}
  lockedTag={status?.stored?.hermes_agent_version?.lockedTag}
  navigate={navigate}
/>
<div className="flex-1 overflow-auto bg-[#0f1117]">
  {renderTab()}
</div>
```

- [ ] **Step 3: Run web typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/features/agent/AgentUpdateBanner.tsx web/src/features/agent/AgentWorkspace.tsx
git commit -m "feat(web): add per-agent hermes-agent update banner with changelog and upgrade"
```

---

## Task 17: Dashboard — InfraTab agent version card

**Files:**
- Modify: `web/src/features/agent/InfraTab.tsx`

- [ ] **Step 1: Add agent version card**

In `web/src/features/agent/InfraTab.tsx`, in the component body after extracting `stored`, `live`, and `domain`, add:

```typescript
const agentVersion = status?.stored?.hermes_agent_version;
```

In the JSX, add a new card in the first grid (after the "Live State" card, inside the `grid-cols-2` div), or add a new grid row before the Paths section. Add after the domain card section:

```tsx
<div className="grid grid-cols-2 gap-4 mb-6">
  <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
    <h3 className="text-sm font-semibold text-slate-200 mb-3">
      <i className="fa-solid fa-code-branch mr-2 text-indigo-500" />Hermes Agent Version
    </h3>
    {agentVersion ? (
      <>
        <InfoRow
          label="Revision"
          value={agentVersion.lockedTag || agentVersion.lockedRev.slice(0, 12)}
        />
        <InfoRow
          label="Lock Date"
          value={new Date(agentVersion.lockedDate).toLocaleDateString()}
        />
      </>
    ) : (
      <>
        <InfoRow
          label="Revision"
          value={stored?.hermes_agent_rev !== 'unknown' ? (stored?.hermes_agent_rev?.slice(0, 12) ?? '\u2014') : '\u2014'}
        />
      </>
    )}
  </div>
</div>
```

Note: The `stored` object here is from `status?.stored` which has the old fields. The `hermes_agent_version` is the new optional field on the DTO. Also reference `hermes_agent_rev` from the stored data for the fallback case. Since the DTO type may not include `hermes_agent_rev` directly (it's in the state schema, not necessarily the DTO), use the `hermes_agent_version` object from the DTO.

- [ ] **Step 2: Run web typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/features/agent/InfraTab.tsx
git commit -m "feat(web): add Hermes Agent Version card to InfraTab"
```

---

## Task 18: Dashboard — Settings page latest version row

**Files:**
- Modify: `web/src/features/settings/SettingsPage.tsx`

- [ ] **Step 1: Add update check query and latest version row**

In `web/src/features/settings/SettingsPage.tsx`, add a query for `/api/updates` alongside the existing `/api/info` query:

```typescript
const updatesQ = useQuery({
  queryKey: ['update-check'],
  queryFn: () => apiFetch<{ hermesDeploy: { current: string; latest: string; updateAvailable: boolean } }>('/api/updates'),
  refetchInterval: 60_000,
  retry: false,
});
```

In the "About" section, after the existing "Version" row (around line 170), add:

```tsx
<Row
  label="Latest"
  value={
    updatesQ.isLoading ? (
      <span className="text-slate-500 text-sm">Loading...</span>
    ) : updatesQ.data?.hermesDeploy.updateAvailable ? (
      <span className="text-sm">
        <code className="text-indigo-400 font-mono">{updatesQ.data.hermesDeploy.latest}</code>
        <span className="ml-2 text-xs px-2 py-0.5 rounded bg-indigo-900/30 text-indigo-400">update available</span>
      </span>
    ) : (
      <span className="text-sm text-emerald-400">
        <i className="fa-solid fa-check mr-1" />up to date
      </span>
    )
  }
/>
```

- [ ] **Step 2: Run web typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/features/settings/SettingsPage.tsx
git commit -m "feat(web): show latest hermes-deploy version in Settings > About"
```

---

## Task 19: Final integration — typecheck, lint, test, build

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run linter**

Run: `npx eslint src tests`
Expected: No errors (or only pre-existing ones).

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Run full build**

Run: `npm run build`
Expected: Build succeeds (server + web).

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: fix lint/type issues from version management integration"
```

---

## Task 20: Manual smoke test

- [ ] **Step 1: Start dashboard and verify update banner**

Run: `npm run start` (or `hermes-deploy dashboard`)
Check: If there's a newer npm version, the indigo banner appears at the top. If not, no banner.

- [ ] **Step 2: Navigate to Settings and verify latest version**

Check: Settings > About shows "Latest" row with either "up to date" badge or the new version.

- [ ] **Step 3: Navigate to an agent and verify agent update banner**

Check: If the deployed hermes-agent is behind the latest NousResearch release, the indigo per-agent banner appears with changelog link and Upgrade button.

- [ ] **Step 4: Check InfraTab version card**

Check: Agent > Infra tab shows "Hermes Agent Version" card with revision and lock date.

- [ ] **Step 5: Test upgrade action (if a test agent is available)**

Click "Upgrade" on the agent banner. Verify the JobDrawer opens and shows flake-update -> bootstrap -> healthcheck phases.

- [ ] **Step 6: Test CLI**

Run: `hermes-deploy ls` — verify AGENT column appears.
Run: `hermes-deploy status <name>` — verify Agent line with revision appears.
