# Profiles Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Hermes profile support so a single deployed VM can run multiple independent agents, each with its own config, sessions, gateway, and state — managed through the dashboard with a profile switcher.

**Architecture:** Profiles are a thin layer on top of existing SSH-based data fetching. The backend resolves a profile name to a different `HERMES_HOME` path on the remote VM (`/var/lib/hermes/.hermes` for default, `/var/lib/hermes/.hermes/profiles/<name>` for named profiles). The frontend adds a profile switcher pill bar within the agent workspace. Deploy config (`hermes.toml`) gets optional `[[hermes.profiles]]` blocks; the flat `[hermes]` section remains the default profile for full backwards compatibility.

**Tech Stack:** TypeScript, Zod, Fastify, React, TanStack Query, Vite

**Spec:** `docs/superpowers/specs/2026-04-24-profiles-support-design.md`

---

## File Structure

### Backend changes
- `src/schema/hermes-toml.ts` — Add `ProfileSchema`, add `profiles` array to `HermesSchema`
- `src/schema/state-toml.ts` — Add optional `profile_hashes` to `BaseDeploymentSchema`
- `src/server/agent-data-source.ts` — Add `resolveHermesHome()`, parameterize all path-dependent functions
- `src/server/routes/agent-data.ts` — Extract `?profile=` query param, pass to data source functions
- `src/server/routes/config.ts` — Support `?profile=` for profile-specific file lists
- `src/server/routes/org.ts` — Iterate profiles per agent for per-profile stats
- `src/orchestrator/shared.ts` — Add `uploadProfileFiles()`, update `validateProjectFiles()`
- `src/orchestrator/deploy.ts` — Call profile upload after bootstrap
- `src/orchestrator/update.ts` — Call profile upload with hash-based change detection

### Frontend changes
- `web/src/lib/types.ts` — Add `profile?: string` to agent route
- `web/src/lib/agent-api.ts` — Add `profile` param to all hooks, add `useAgentProfiles`
- `web/src/features/agent/ProfileSwitcher.tsx` — New component (pill bar)
- `web/src/features/agent/AgentWorkspace.tsx` — Wire profile from route, render ProfileSwitcher
- `web/src/features/agent/OverviewTab.tsx` — Accept and pass `profile`
- `web/src/features/agent/SessionsTab.tsx` — Accept and pass `profile`
- `web/src/features/agent/AnalyticsTab.tsx` — Accept and pass `profile`
- `web/src/features/agent/SkillsTab.tsx` — Accept and pass `profile`
- `web/src/features/agent/CronTab.tsx` — Accept and pass `profile`
- `web/src/features/agent/GatewayTab.tsx` — Accept and pass `profile`
- `web/src/features/agent/WebhooksTab.tsx` — Accept and pass `profile`
- `web/src/features/agent/PluginsTab.tsx` — Accept and pass `profile`
- `web/src/features/config/ConfigTab.tsx` — Accept and pass `profile`
- `web/src/features/dashboard/OrgDashboard.tsx` — Show per-profile cost breakdown
- `web/src/App.tsx` — Pass `profile` from route to AgentWorkspace

### Test fixtures
- `tests/fixtures/hermes-toml/m3-profiles.toml` — New fixture with profiles
- `tests/unit/schema/hermes-toml.test.ts` — Add profile validation tests
- `tests/unit/schema/state-toml.test.ts` — Add profile_hashes test

---

### Task 1: Schema — Add ProfileSchema to hermes-toml.ts

**Files:**
- Modify: `src/schema/hermes-toml.ts:53-81`
- Create: `tests/fixtures/hermes-toml/m3-profiles.toml`
- Modify: `tests/unit/schema/hermes-toml.test.ts`

- [ ] **Step 1: Write test fixtures**

Create `tests/fixtures/hermes-toml/m3-profiles.toml`:

```toml
name = "test-m3-profiles"

[cloud]
provider = "aws"
profile = "acme"
region = "eu-west-3"
size = "small"

[hermes]
config_file = "./config.yaml"
secrets_file = "./secrets.env.enc"

[hermes.documents]
"SOUL.md" = "./SOUL.md"

[[hermes.profiles]]
name = "coder"
config_file = "./profiles/coder/config.yaml"
secrets_file = "./profiles/coder/secrets.env.enc"

[hermes.profiles.documents]
"SOUL.md" = "./profiles/coder/SOUL.md"

[[hermes.profiles]]
name = "assistant"
config_file = "./profiles/assistant/config.yaml"
secrets_file = "./profiles/assistant/secrets.env.enc"
```

- [ ] **Step 2: Write failing tests**

Add to `tests/unit/schema/hermes-toml.test.ts`:

```typescript
it('accepts a config with [[hermes.profiles]]', () => {
  const raw = loadFixture('m3-profiles.toml');
  const result = HermesTomlSchema.safeParse(raw);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.hermes.profiles).toHaveLength(2);
    expect(result.data.hermes.profiles[0]!.name).toBe('coder');
    expect(result.data.hermes.profiles[0]!.config_file).toBe('./profiles/coder/config.yaml');
    expect(result.data.hermes.profiles[0]!.documents).toEqual({ 'SOUL.md': './profiles/coder/SOUL.md' });
    expect(result.data.hermes.profiles[1]!.name).toBe('assistant');
    expect(result.data.hermes.profiles[1]!.documents).toEqual({});
  }
});

it('defaults hermes.profiles to empty array when not present', () => {
  const raw = loadFixture('m3-minimal.toml');
  const result = HermesTomlSchema.safeParse(raw);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.hermes.profiles).toEqual([]);
  }
});

it('rejects profile named "default"', () => {
  const result = HermesTomlSchema.safeParse({
    name: 'profile-default',
    cloud: { provider: 'aws', profile: 'd', region: 'eu-west-3', size: 'small' },
    hermes: {
      config_file: './c.yaml',
      secrets_file: './s.env.enc',
      profiles: [{ name: 'default', config_file: './c.yaml', secrets_file: './s.env.enc' }],
    },
  });
  expect(result.success).toBe(false);
});

it('rejects duplicate profile names', () => {
  const result = HermesTomlSchema.safeParse({
    name: 'profile-dup',
    cloud: { provider: 'aws', profile: 'd', region: 'eu-west-3', size: 'small' },
    hermes: {
      config_file: './c.yaml',
      secrets_file: './s.env.enc',
      profiles: [
        { name: 'coder', config_file: './c1.yaml', secrets_file: './s1.env.enc' },
        { name: 'coder', config_file: './c2.yaml', secrets_file: './s2.env.enc' },
      ],
    },
  });
  expect(result.success).toBe(false);
});

it('rejects profile with invalid name format', () => {
  const result = HermesTomlSchema.safeParse({
    name: 'profile-bad-name',
    cloud: { provider: 'aws', profile: 'd', region: 'eu-west-3', size: 'small' },
    hermes: {
      config_file: './c.yaml',
      secrets_file: './s.env.enc',
      profiles: [{ name: 'My Bot!', config_file: './c.yaml', secrets_file: './s.env.enc' }],
    },
  });
  expect(result.success).toBe(false);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/paulcailly/hermes-deploy && npx vitest run tests/unit/schema/hermes-toml.test.ts`
Expected: FAIL — `profiles` property not recognized on HermesSchema

- [ ] **Step 4: Implement ProfileSchema and update HermesSchema**

In `src/schema/hermes-toml.ts`, add the `ProfileSchema` before `HermesSchema` and update `HermesSchema`:

```typescript
const ProfileSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]{0,62}$/, {
    message: 'profile name must be lowercase alphanumeric with hyphens, 1-63 chars',
  }).refine(n => n !== 'default', {
    message: '"default" is reserved — the flat [hermes] section is the default profile',
  }),
  config_file: z.string().min(1),
  secrets_file: z.string().min(1),
  documents: z.record(z.string().min(1), z.string().min(1)).default({}),
});

export type ProfileConfig = z.infer<typeof ProfileSchema>;
```

Update `HermesSchema` to include `profiles` and a duplicate-name refinement:

```typescript
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
}, { message: 'Duplicate profile names are not allowed' });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/paulcailly/hermes-deploy && npx vitest run tests/unit/schema/hermes-toml.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/schema/hermes-toml.ts tests/fixtures/hermes-toml/m3-profiles.toml tests/unit/schema/hermes-toml.test.ts
git commit -m "feat(schema): add profiles support to hermes-toml schema"
```

---

### Task 2: Schema — Add profile_hashes to state-toml.ts

**Files:**
- Modify: `src/schema/state-toml.ts:21-44`
- Modify: `tests/unit/schema/state-toml.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/unit/schema/state-toml.test.ts`:

```typescript
it('accepts a deployment with profile_hashes', () => {
  const state: StateToml = {
    schema_version: 4,
    deployments: {
      'multi-profile': {
        project_path: '/Users/paul/agents/multi',
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-24T10:00:00Z',
        last_deployed_at: '2026-04-24T10:05:00Z',
        last_config_hash: 'sha256:abc123',
        last_nix_hash: 'sha256:abc123',
        hermes_agent_rev: 'abc1234567890',
        hermes_agent_tag: '',
        ssh_key_path: '/Users/paul/.config/hermes-deploy/ssh_keys/multi-profile',
        age_key_path: '/Users/paul/.config/hermes-deploy/age_keys/multi-profile',
        health: 'healthy',
        instance_ip: '203.0.113.50',
        profile_hashes: {
          coder: 'sha256:def456',
          assistant: 'sha256:ghi789',
        },
        cloud_resources: {
          instance_id: 'i-0abc',
          security_group_id: 'sg-0def',
          key_pair_name: 'hermes-deploy-multi-profile',
          eip_allocation_id: 'eipalloc-0ghi',
          region: 'eu-west-3',
        },
      },
    },
  };
  const result = StateTomlSchema.safeParse(state);
  expect(result.success).toBe(true);
  if (result.success) {
    const dep = result.data.deployments['multi-profile']!;
    expect(dep.profile_hashes).toEqual({
      coder: 'sha256:def456',
      assistant: 'sha256:ghi789',
    });
  }
});

it('accepts a deployment without profile_hashes (backward compat)', () => {
  const state: StateToml = {
    schema_version: 4,
    deployments: {
      'no-profiles': {
        project_path: '/Users/paul/agents/single',
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-24T10:00:00Z',
        last_deployed_at: '2026-04-24T10:05:00Z',
        last_config_hash: 'sha256:abc123',
        last_nix_hash: 'sha256:abc123',
        hermes_agent_rev: 'unknown',
        hermes_agent_tag: '',
        ssh_key_path: '/x',
        age_key_path: '/x',
        health: 'healthy',
        instance_ip: '203.0.113.51',
        cloud_resources: {
          instance_id: 'i-0abc',
          security_group_id: 'sg-0def',
          key_pair_name: 'hermes-deploy-no-profiles',
          eip_allocation_id: 'eipalloc-0ghi',
          region: 'eu-west-3',
        },
      },
    },
  };
  const result = StateTomlSchema.safeParse(state);
  expect(result.success).toBe(true);
  if (result.success) {
    const dep = result.data.deployments['no-profiles']!;
    expect(dep.profile_hashes).toBeUndefined();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/paulcailly/hermes-deploy && npx vitest run tests/unit/schema/state-toml.test.ts`
Expected: FAIL — `profile_hashes` not in schema type

- [ ] **Step 3: Add profile_hashes to BaseDeploymentSchema**

In `src/schema/state-toml.ts`, add to `BaseDeploymentSchema` after line 43 (`dns_record_id`):

```typescript
profile_hashes: z.record(z.string(), z.string()).optional(),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/paulcailly/hermes-deploy && npx vitest run tests/unit/schema/state-toml.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite to check nothing broke**

Run: `cd /Users/paulcailly/hermes-deploy && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/schema/state-toml.ts tests/unit/schema/state-toml.test.ts
git commit -m "feat(schema): add optional profile_hashes to state-toml deployments"
```

---

### Task 3: Backend — Parameterize HERMES_HOME in agent-data-source.ts

**Files:**
- Modify: `src/server/agent-data-source.ts`

- [ ] **Step 1: Add resolveHermesHome helper**

Add this exported function near the top of `src/server/agent-data-source.ts`, after the `HERMES_HOME` constant:

```typescript
/**
 * Resolve a profile name to an absolute HERMES_HOME path on the remote VM.
 * "default" or undefined → the standard HERMES_HOME.
 * Named profiles → HERMES_HOME/profiles/<name>.
 */
export function resolveHermesHome(profile?: string): string {
  if (!profile || profile === 'default') return HERMES_HOME;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(profile)) {
    throw new Error(`invalid profile name: ${profile}`);
  }
  return `${HERMES_HOME}/profiles/${profile}`;
}
```

- [ ] **Step 2: Update runSqliteJson to accept hermesHome**

Change the `QUERY_SCRIPT` constant so the db path is parameterized. Update `runSqliteJson` signature:

```typescript
export async function runSqliteJson<T>(name: string, sql: string, hermesHome?: string): Promise<T[]> {
  try {
    const pyPath = await resolvePython3(name);
    if (!pyPath) return [];
    const entry = await getOrCreateCacheEntry(name);
    const dbPath = `${hermesHome ?? HERMES_HOME}/state.db`;
    const script = `import sqlite3,sys,json,datetime,base64
try:
    sql = base64.b64decode(sys.argv[1]).decode('utf-8')
    con = sqlite3.connect(sys.argv[2])
    con.row_factory = sqlite3.Row
    cur = con.execute(sql)
    out = []
    for row in cur:
        d = dict(row)
        for k, v in list(d.items()):
            if isinstance(v, (int, float)) and (k.endswith('_at') or k == 'timestamp'):
                try:
                    d[k] = datetime.datetime.fromtimestamp(v, datetime.timezone.utc).isoformat().replace('+00:00','Z')
                except Exception:
                    pass
            elif isinstance(v, int) and k == 'id':
                d[k] = str(v)
        out.append(d)
    print(json.dumps(out, default=str))
except Exception:
    print('[]')
`;
    const sqlB64 = Buffer.from(sql, 'utf-8').toString('base64');
    const cmd = `${shEscape(pyPath)} -c ${shEscape(script)} ${shEscape(sqlB64)} ${shEscape(dbPath)} 2>/dev/null || echo '[]'`;
    const res = await entry.session.exec(cmd);
    const out = res.stdout.trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
```

Note: The key change is using `sys.argv[2]` for the db path instead of hardcoding it, and passing `dbPath` as a third shell argument.

- [ ] **Step 3: Verify build compiles**

Run: `cd /Users/paulcailly/hermes-deploy && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/server/agent-data-source.ts
git commit -m "feat(backend): parameterize HERMES_HOME in agent-data-source"
```

---

### Task 4: Backend — Profile discovery endpoint and profile-aware agent-data routes

**Files:**
- Modify: `src/server/routes/agent-data.ts`

- [ ] **Step 1: Add profile discovery endpoint**

Add at the beginning of `agentDataRoutes` function in `src/server/routes/agent-data.ts`:

```typescript
// ---------- GET /api/agents/:name/profiles ----------
app.get<{ Params: { name: string } }>('/api/agents/:name/profiles', async (req, reply) => {
  const { name } = req.params;
  if (!(await agentExists(name))) return reply.code(404).send({ error: 'agent not found' });

  const profiles: Array<{ name: string; path: string }> = [
    { name: 'default', path: HERMES_HOME },
  ];

  const dirs = await listRemoteDir(name, `${HERMES_HOME}/profiles`);
  for (const dir of dirs) {
    if (/^[a-z0-9][a-z0-9-]*$/.test(dir)) {
      profiles.push({ name: dir, path: `${HERMES_HOME}/profiles/${dir}` });
    }
  }

  return profiles;
});
```

- [ ] **Step 2: Add profile query param extraction helper**

Add a helper at the top of the file (after imports):

```typescript
import { resolveHermesHome } from '../agent-data-source.js';

/** Extract and validate the ?profile= query param, return resolved HERMES_HOME path. */
function profileHome(query: { profile?: string }): string {
  return resolveHermesHome(query.profile);
}
```

- [ ] **Step 3: Update stats endpoint to be profile-aware**

Update the `GET /api/agents/:name/stats` handler — add `Querystring` type and use `profileHome`:

Change the route type to:
```typescript
app.get<{ Params: { name: string }; Querystring: { profile?: string } }>('/api/agents/:name/stats', async (req, reply) => {
```

And update the `runSqliteJson` call to pass the hermesHome:
```typescript
const home = profileHome(req.query);
// ... in the Promise.all:
runSqliteJson<...>(name, `...`, home),
```

Also update `getConfiguredModel` calls — for non-default profiles, read config from the profile's directory:
```typescript
const cfgPath = home === HERMES_HOME ? '/etc/nixos/config.yaml' : `${home}/config.yaml`;
```

- [ ] **Step 4: Update all remaining agent-data endpoints to be profile-aware**

Apply the same pattern to every endpoint in `agent-data-source.ts`:

For each route handler:
1. Add `Querystring: { profile?: string }` to the route type params
2. Call `const home = profileHome(req.query);` at the top
3. Replace hardcoded `HERMES_HOME` paths with `home`-based paths:
   - `${HERMES_HOME}/state.db` → pass `home` to `runSqliteJson`
   - `${HERMES_HOME}/skills` → `${home}/skills`
   - `${HERMES_HOME}/cron/jobs.json` → `${home}/cron/jobs.json`
   - `${HERMES_HOME}/gateway_state.json` → `${home}/gateway_state.json`
   - `${HERMES_HOME}/config.yaml` → `${home}/config.yaml`
   - `${HERMES_HOME}/webhook_subscriptions.json` → `${home}/webhook_subscriptions.json`

The `CRON_JOBS_PATH` constant at the top of the file should become a function:
```typescript
function cronJobsPath(home: string): string {
  return `${home}/cron/jobs.json`;
}
```

For gateway action (start/stop/restart), the remote command needs the `-p` flag for non-default profiles:
```typescript
const profileFlag = req.query.profile && req.query.profile !== 'default'
  ? `-p ${req.query.profile} `
  : '';
const res = await runRemoteCommand(name, `hermes ${profileFlag}gateway ${action} 2>&1`);
```

For WebSocket endpoints, extract profile from the query string of the upgrade request:
```typescript
app.get<{ Params: { name: string; sid: string }; Querystring: { profile?: string } }>(
  '/ws/agents/:name/sessions/:sid/messages',
  { websocket: true },
  async (socket, request) => {
    const home = profileHome(request.query);
    // ... use home in runSqliteJson calls
  },
);
```

- [ ] **Step 5: Verify build compiles**

Run: `cd /Users/paulcailly/hermes-deploy && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/agent-data.ts
git commit -m "feat(backend): profile-aware agent-data routes with discovery endpoint"
```

---

### Task 5: Backend — Profile-aware config routes

**Files:**
- Modify: `src/server/routes/config.ts`

- [ ] **Step 1: Update config routes to support profile query param**

The config routes need to resolve which files to show based on the profile. For the default profile, behavior is unchanged. For named profiles, we need to read the `hermes.toml` to find that profile's file paths.

Update `src/server/routes/config.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { resolveProjectPath } from '../project-resolver.js';
import { loadHermesToml } from '../../schema/load.js';

type ConfigFile = 'hermes-toml' | 'config-yaml' | 'soul-md';

const DEFAULT_FILE_MAP: Record<ConfigFile, { name: string; ext: string }> = {
  'hermes-toml': { name: 'hermes.toml', ext: 'toml' },
  'config-yaml': { name: 'config.yaml', ext: 'yaml' },
  'soul-md': { name: 'SOUL.md', ext: 'markdown' },
};

/** Build the file map for a given profile. Default profile uses the flat [hermes] paths. Named profiles use their [[hermes.profiles]] paths. */
function buildFileMap(projectPath: string, profile?: string): Record<string, { name: string; ext: string; resolvedPath: string }> {
  const map: Record<string, { name: string; ext: string; resolvedPath: string }> = {
    'hermes-toml': { name: 'hermes.toml', ext: 'toml', resolvedPath: join(projectPath, 'hermes.toml') },
  };

  if (!profile || profile === 'default') {
    map['config-yaml'] = { name: 'config.yaml', ext: 'yaml', resolvedPath: join(projectPath, 'config.yaml') };
    map['soul-md'] = { name: 'SOUL.md', ext: 'markdown', resolvedPath: join(projectPath, 'SOUL.md') };
  } else {
    // Load hermes.toml to find the profile's file paths
    try {
      const config = loadHermesToml(join(projectPath, 'hermes.toml'));
      const profileCfg = config.hermes.profiles.find(p => p.name === profile);
      if (profileCfg) {
        map['config-yaml'] = { name: profileCfg.config_file, ext: 'yaml', resolvedPath: join(projectPath, profileCfg.config_file) };
        // Add profile documents
        for (const [docName, docPath] of Object.entries(profileCfg.documents)) {
          const ext = docName.endsWith('.md') ? 'markdown' : docName.endsWith('.yaml') || docName.endsWith('.yml') ? 'yaml' : 'plaintext';
          const key = `doc-${docName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
          map[key] = { name: docName, ext, resolvedPath: join(projectPath, docPath) };
        }
      }
    } catch {
      // Fall back to default if hermes.toml can't be loaded
      map['config-yaml'] = { name: 'config.yaml', ext: 'yaml', resolvedPath: join(projectPath, 'config.yaml') };
    }
  }

  return map;
}

export async function configRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/deployments/:name/config/files
  app.get<{ Params: { name: string }; Querystring: { profile?: string } }>(
    '/api/deployments/:name/config/files',
    async (request, reply) => {
      try {
        const projectPath = await resolveProjectPath(request.params.name);
        const fileMap = buildFileMap(projectPath, request.query.profile);
        const files = Object.entries(fileMap).map(([key, { name, resolvedPath }]) => ({
          key,
          name,
          exists: existsSync(resolvedPath),
        }));
        return { projectPath, files };
      } catch (err) {
        reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // GET /api/deployments/:name/config/:file
  app.get<{ Params: { name: string; file: string }; Querystring: { profile?: string } }>(
    '/api/deployments/:name/config/:file',
    async (request, reply) => {
      try {
        const projectPath = await resolveProjectPath(request.params.name);
        const fileMap = buildFileMap(projectPath, request.query.profile);
        const fileInfo = fileMap[request.params.file];
        if (!fileInfo) {
          reply.code(400).send({ error: `unknown config file: ${request.params.file}` });
          return;
        }
        if (!existsSync(fileInfo.resolvedPath)) {
          reply.code(404).send({ error: `${fileInfo.name} not found` });
          return;
        }
        const content = readFileSync(fileInfo.resolvedPath, 'utf-8');
        return { file: request.params.file, name: fileInfo.name, language: fileInfo.ext, content };
      } catch (err) {
        reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  // PUT /api/deployments/:name/config/:file
  app.put<{ Params: { name: string; file: string }; Querystring: { profile?: string }; Body: { content: string } }>(
    '/api/deployments/:name/config/:file',
    async (request, reply) => {
      try {
        const projectPath = await resolveProjectPath(request.params.name);
        const fileMap = buildFileMap(projectPath, request.query.profile);
        const fileInfo = fileMap[request.params.file];
        if (!fileInfo) {
          reply.code(400).send({ error: `unknown config file: ${request.params.file}` });
          return;
        }

        const { content } = request.body ?? {};
        if (typeof content !== 'string') {
          reply.code(400).send({ error: 'content is required' });
          return;
        }

        // Validate hermes.toml before writing
        if (request.params.file === 'hermes-toml') {
          try {
            const { parse } = await import('smol-toml');
            const { HermesTomlSchema } = await import('../../schema/hermes-toml.js');
            const parsed = parse(content);
            HermesTomlSchema.parse(parsed);
          } catch (err) {
            reply.code(422).send({ error: `invalid hermes.toml: ${(err as Error).message}` });
            return;
          }
        }

        // Validate YAML syntax before writing
        if (fileInfo.ext === 'yaml') {
          try {
            const { parse } = await import('yaml');
            parse(content);
          } catch (err) {
            reply.code(422).send({ error: `invalid YAML: ${(err as Error).message}` });
            return;
          }
        }

        writeFileSync(fileInfo.resolvedPath, content);
        return { ok: true };
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
    },
  );
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd /Users/paulcailly/hermes-deploy && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/server/routes/config.ts
git commit -m "feat(backend): profile-aware config routes"
```

---

### Task 6: Backend — Profile-aware org routes

**Files:**
- Modify: `src/server/routes/org.ts`

- [ ] **Step 1: Update org stats to break down per profile**

In `src/server/routes/org.ts`, update the `GET /api/org/stats` handler to iterate profiles for each agent and return per-profile stats:

After `const names = await listAgents();`, add profile discovery:

```typescript
// Discover profiles for each agent
const agentProfiles = await Promise.allSettled(
  names.map(async (name) => {
    const dirs = await listRemoteDir(name, `${HERMES_HOME}/profiles`);
    const profiles = ['default', ...dirs.filter(d => /^[a-z0-9][a-z0-9-]*$/.test(d))];
    return { name, profiles };
  }),
);
```

Then compute stats per profile instead of per agent:

```typescript
const results = await Promise.allSettled(
  names.flatMap((name) => {
    const agentEntry = agentProfiles.find(r => r.status === 'fulfilled' && r.value.name === name);
    const profiles = agentEntry?.status === 'fulfilled' ? agentEntry.value.profiles : ['default'];
    return profiles.map(async (profile) => {
      const home = profile === 'default' ? HERMES_HOME : `${HERMES_HOME}/profiles/${profile}`;
      const rows = await runSqliteJson<AgentSessionRow>(name, SESSIONS_SQL, home);
      return { name, profile, stats: computeAgentStats(rows) };
    });
  }),
);
```

Update the `perAgent` array type to include `profile`:

```typescript
const perAgent: Array<{
  name: string;
  profile: string;
  totalSessions: number;
  totalCostUSD: number;
  activeSessions: number;
  todayCostUSD: number;
}> = [];
```

And update the loop to push `profile`:

```typescript
for (const r of results) {
  if (r.status !== 'fulfilled') continue;
  const s = r.value.stats;
  // ... existing aggregation ...
  perAgent.push({
    name: r.value.name,
    profile: r.value.profile,
    totalSessions: s.total_sessions ?? 0,
    totalCostUSD: s.total_cost_usd ?? 0,
    activeSessions: s.active_sessions ?? 0,
    todayCostUSD: s.today_cost_usd ?? 0,
  });
}
```

Add the `HERMES_HOME` import:

```typescript
import { runSqliteJson, readRemoteJson, listRemoteDir, HERMES_HOME } from '../agent-data-source.js';
```

- [ ] **Step 2: Update org activity to include profile info**

In the `GET /api/org/activity` handler, similarly discover profiles and query sessions per profile. The `agent` field in the response becomes `name` and a new `profile` field is added:

```typescript
// In the flat array items:
flat.push({
  id: `${r.value.name}/${r.value.profile}/${row.id}`,
  agent: r.value.name,
  profile: r.value.profile,
  // ... rest unchanged
});
```

- [ ] **Step 3: Verify build compiles**

Run: `cd /Users/paulcailly/hermes-deploy && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/org.ts
git commit -m "feat(backend): profile-aware org stats and activity"
```

---

### Task 7: Frontend — Route model and hook changes

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/agent-api.ts`

- [ ] **Step 1: Update Route type**

In `web/src/lib/types.ts`, add `profile?: string` to the agent route:

```typescript
export type Route =
  | { page: 'dashboard' }
  | { page: 'agents' }
  | { page: 'agent'; name: string; tab: AgentTab; profile?: string }
  | { page: 'library' }
  | { page: 'teams' }
  | { page: 'settings' }
  | { page: 'new' }
  | { page: 'job'; jobId: string };
```

- [ ] **Step 2: Add useAgentProfiles hook**

Add to `web/src/lib/agent-api.ts`:

```typescript
export function useAgentProfiles(name: string) {
  return useQuery({
    queryKey: ['agent-profiles', name],
    queryFn: () => apiFetch<{ name: string; path: string }[]>(`/api/agents/${encodeURIComponent(name)}/profiles`),
    staleTime: 60_000,
    retry: false,
  });
}
```

- [ ] **Step 3: Add profile query param helper**

Add a helper function in `web/src/lib/agent-api.ts`:

```typescript
/** Build query string suffix for profile-scoped API calls. */
function profileQs(profile?: string, existingParams?: string): string {
  if (!profile || profile === 'default') return existingParams ? `?${existingParams}` : '';
  const sep = existingParams ? `${existingParams}&` : '';
  return `?${sep}profile=${encodeURIComponent(profile)}`;
}
```

- [ ] **Step 4: Update all per-agent hooks to accept profile**

Update every hook to include `profile` in the query key and append the profile query param. Example for `useAgentStats`:

```typescript
export function useAgentStats(name: string, profile?: string) {
  return useQuery({
    queryKey: ['agent-stats', name, profile ?? 'default'],
    queryFn: () => apiFetch<AgentStats>(`/api/agents/${encodeURIComponent(name)}/stats${profileQs(profile)}`),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}
```

Apply the same pattern to: `useAgentSessions`, `useAgentMessages`, `useAgentSkills`, `useAgentSkillFile`, `useAgentCron`, `useAgentGateway`, `useAgentWebhooks`, `useAgentPlugins`.

For `useAgentSessions`, which already builds a query string:

```typescript
export function useAgentSessions(name: string, opts?: { platform?: string; limit?: number; q?: string; profile?: string }) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.platform && opts.platform !== 'all') params.set('platform', opts.platform);
  if (opts?.q) params.set('q', opts.q);
  if (opts?.profile && opts.profile !== 'default') params.set('profile', opts.profile);
  const qs = params.toString() ? `?${params.toString()}` : '';

  return useQuery({
    queryKey: ['agent-sessions', name, opts?.platform ?? 'all', opts?.limit ?? 50, opts?.q ?? '', opts?.profile ?? 'default'],
    queryFn: () => apiFetch<AgentSession[]>(`/api/agents/${encodeURIComponent(name)}/sessions${qs}`),
    refetchInterval: REFETCH_MS,
    retry: false,
  });
}
```

Update mutation hooks (`useGatewayAction`, `useCronToggle`, `useCronCreate`, `useCronUpdate`, `useCronDelete`, `useSkillFileWrite`) to also accept and pass `profile`.

Update WebSocket hooks (`useLiveAgentMessages`, `useLiveAgentStats`) to include `profile` in the WS URL:

```typescript
export function useLiveAgentMessages(
  name: string,
  sessionId: string | null | undefined,
  enabled: boolean,
  profile?: string,
): { messages: AgentMessage[]; connected: boolean } {
  // ... in connect():
  const qs = profile && profile !== 'default' ? `?profile=${encodeURIComponent(profile)}` : '';
  const ws = createWs(`/ws/agents/${encodeURIComponent(name)}/sessions/${encodeURIComponent(sessionId)}/messages${qs}`);
  // ...
}
```

- [ ] **Step 5: Update OrgStats type**

Update the `OrgStats` interface `perAgent` to include `profile`:

```typescript
perAgent: Array<{
  name: string;
  profile: string;
  totalSessions: number;
  totalCostUSD: number;
  activeSessions: number;
  todayCostUSD: number;
}>;
```

And `OrgActivityItem`:

```typescript
export interface OrgActivityItem {
  id: string;
  agent: string;
  profile: string;
  title: string;
  source: string;
  startedAt: string;
  active: boolean;
  estimatedCostUSD: number;
  model: string;
}
```

- [ ] **Step 6: Verify web build compiles**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: Errors expected — tab components don't accept `profile` yet. That's Task 9.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/agent-api.ts
git commit -m "feat(frontend): profile-aware route model and API hooks"
```

---

### Task 8: Frontend — ProfileSwitcher component

**Files:**
- Create: `web/src/features/agent/ProfileSwitcher.tsx`

- [ ] **Step 1: Create ProfileSwitcher component**

Create `web/src/features/agent/ProfileSwitcher.tsx`:

```tsx
import { useAgentProfiles } from '../../lib/agent-api';
import type { AgentTab } from '../../lib/types';

const VM_SCOPED_TABS: AgentTab[] = ['infra', 'logs', 'ssh', 'secrets'];

interface ProfileSwitcherProps {
  name: string;
  activeProfile: string;
  activeTab: AgentTab;
  onSelect: (profile: string) => void;
}

export function ProfileSwitcher({ name, activeProfile, activeTab, onSelect }: ProfileSwitcherProps) {
  const { data: profiles } = useAgentProfiles(name);

  // Don't render if there's only one profile (or still loading)
  if (!profiles || profiles.length <= 1) return null;

  const isVmScoped = VM_SCOPED_TABS.includes(activeTab);

  return (
    <div className={`px-5 py-2 border-b border-[#2a2d3a] bg-[#13141f] flex items-center gap-2 ${isVmScoped ? 'opacity-50' : ''}`}>
      <span className="text-[11px] text-slate-500 mr-1">Profile:</span>
      <div className="flex gap-1">
        {profiles.map((p) => (
          <button
            key={p.name}
            onClick={() => onSelect(p.name)}
            disabled={isVmScoped}
            className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
              activeProfile === p.name
                ? 'bg-indigo-600 text-white font-medium'
                : isVmScoped
                  ? 'bg-gray-900 text-gray-600 cursor-not-allowed'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>
      {isVmScoped && (
        <span className="text-[10px] text-slate-600 ml-2">VM-scoped — applies to all profiles</span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/features/agent/ProfileSwitcher.tsx
git commit -m "feat(frontend): add ProfileSwitcher pill bar component"
```

---

### Task 9: Frontend — Wire profile through AgentWorkspace and all tabs

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/features/agent/AgentWorkspace.tsx`
- Modify: `web/src/features/agent/OverviewTab.tsx`
- Modify: `web/src/features/agent/SessionsTab.tsx`
- Modify: `web/src/features/agent/AnalyticsTab.tsx`
- Modify: `web/src/features/agent/SkillsTab.tsx`
- Modify: `web/src/features/agent/CronTab.tsx`
- Modify: `web/src/features/agent/GatewayTab.tsx`
- Modify: `web/src/features/agent/WebhooksTab.tsx`
- Modify: `web/src/features/agent/PluginsTab.tsx`
- Modify: `web/src/features/config/ConfigTab.tsx`

- [ ] **Step 1: Update App.tsx to pass profile**

In `web/src/App.tsx`, update the agent case in `renderPage()`:

```tsx
case 'agent':
  return (
    <AgentWorkspace
      name={route.name}
      tab={route.tab}
      profile={route.profile}
      navigate={navigate}
    />
  );
```

- [ ] **Step 2: Update AgentWorkspace to wire profile**

In `web/src/features/agent/AgentWorkspace.tsx`:

Add import:
```typescript
import { ProfileSwitcher } from './ProfileSwitcher';
```

Update props interface:
```typescript
interface AgentWorkspaceProps {
  name: string;
  tab: AgentTab;
  profile?: string;
  navigate: Navigate;
}
```

Update component to use profile:
```typescript
export function AgentWorkspace({ name, tab, profile, navigate }: AgentWorkspaceProps) {
  const activeProfile = profile ?? 'default';

  // ... existing status query ...

  function onTabSelect(t: AgentTab) {
    navigate({ page: 'agent', name, tab: t, profile: activeProfile });
  }

  function onProfileSelect(p: string) {
    navigate({ page: 'agent', name, tab, profile: p });
  }

  function renderTab() {
    switch (tab) {
      case 'overview':  return <OverviewTab name={name} profile={activeProfile} status={status} navigate={navigate} />;
      case 'sessions':  return <SessionsTab name={name} profile={activeProfile} />;
      case 'analytics': return <AnalyticsTab name={name} profile={activeProfile} />;
      case 'skills':    return <SkillsTab name={name} profile={activeProfile} />;
      case 'cron':      return <CronTab name={name} profile={activeProfile} />;
      case 'gateway':   return <GatewayTab name={name} profile={activeProfile} />;
      case 'webhooks':  return <WebhooksTab name={name} profile={activeProfile} />;
      case 'plugins':   return <PluginsTab name={name} profile={activeProfile} />;
      case 'infra':     return <InfraTab name={name} status={status} navigate={navigate} />;
      case 'config':    return <ConfigTab name={name} profile={activeProfile} />;
      case 'logs':      return <LogsTab name={name} />;
      case 'ssh':       return <SshTab name={name} />;
      case 'secrets':   return <SecretsTab name={name} />;
      default:          return null;
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <AgentHeader name={name} status={status} />
      <ProfileSwitcher
        name={name}
        activeProfile={activeProfile}
        activeTab={tab}
        onSelect={onProfileSelect}
      />
      <AgentTabBar active={tab} onSelect={onTabSelect} />
      <AgentUpdateBanner ... />
      <div className="flex-1 overflow-auto bg-[#0f1117]">
        {renderTab()}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update all profile-scoped tab components**

For each profile-scoped tab, add `profile` to props and pass it to the hooks.

**OverviewTab.tsx:**
Add `profile: string` to `OverviewTabProps`. Update hook calls:
```typescript
const statsQ = useAgentStats(name, profile);
const sessionsQ = useAgentSessions(name, { limit: 4, profile });
const gatewayQ = useAgentGateway(name, profile);
```

**SessionsTab.tsx:**
Add `profile: string` to props. Pass `profile` in the `useAgentSessions` opts and to `useAgentMessages` / `useLiveAgentMessages`.

**AnalyticsTab.tsx:**
Add `profile: string` to props. Pass `profile` to `useAgentStats` and `useAgentSessions`.

**SkillsTab.tsx:**
Add `profile: string` to props. Pass `profile` to `useAgentSkills`, `useAgentSkillFile`, and `useSkillFileWrite`.

**CronTab.tsx:**
Add `profile: string` to props. Pass `profile` to `useAgentCron`, `useCronToggle`, `useCronCreate`, `useCronUpdate`, `useCronDelete`.

**GatewayTab.tsx:**
Add `profile: string` to props. Pass `profile` to `useAgentGateway` and `useGatewayAction`.

**WebhooksTab.tsx:**
Add `profile: string` to props. Pass `profile` to `useAgentWebhooks`.

**PluginsTab.tsx:**
Add `profile: string` to props. Pass `profile` to `useAgentPlugins`.

**ConfigTab.tsx:**
Add `profile: string` to props. Append `?profile=<name>` to the config file API calls:
```typescript
const profileQs = profile && profile !== 'default' ? `?profile=${encodeURIComponent(profile)}` : '';
// In queries:
queryFn: () => apiFetch<{ files: ConfigFile[] }>(`/api/deployments/${encodeURIComponent(name)}/config/files${profileQs}`),
// and
queryFn: () => apiFetch<ConfigContent>(`/api/deployments/${encodeURIComponent(name)}/config/${activeFile}${profileQs}`),
// and save mutation:
return apiFetch(`/api/deployments/${encodeURIComponent(name)}/config/${activeFile}${profileQs}`, { ... });
```

- [ ] **Step 4: Verify web build compiles**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Run web tests**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx web/src/features/agent/ web/src/features/config/ConfigTab.tsx
git commit -m "feat(frontend): wire profile through AgentWorkspace and all tabs"
```

---

### Task 10: Frontend — OrgDashboard per-profile display

**Files:**
- Modify: `web/src/features/dashboard/OrgDashboard.tsx`

- [ ] **Step 1: Update OrgDashboard to show per-profile info**

In `web/src/features/dashboard/OrgDashboard.tsx`:

Update the `agentStatsMap` to group by agent, then list profiles within:

```typescript
// Group per-agent stats by agent name
const agentProfileStats = new Map<string, Array<{ profile: string; totalSessions: number; totalCostUSD: number }>>();
for (const s of org?.perAgent ?? []) {
  if (!agentProfileStats.has(s.name)) agentProfileStats.set(s.name, []);
  agentProfileStats.get(s.name)!.push({
    profile: s.profile,
    totalSessions: s.totalSessions,
    totalCostUSD: s.totalCostUSD,
  });
}

// Aggregate per-agent totals for display
const perAgentDisplay = agents.map((a) => {
  const profileStats = agentProfileStats.get(a.name) ?? [];
  const totalSessions = profileStats.reduce((sum, p) => sum + p.totalSessions, 0);
  const totalCostUSD = profileStats.reduce((sum, p) => sum + p.totalCostUSD, 0);
  return {
    agent: a,
    profileCount: profileStats.length,
    totalSessions,
    totalCostUSD,
    pct: totalCostUSD / maxCost * 100,
  };
}).sort((a, b) => b.totalCostUSD - a.totalCostUSD);
```

In the Agent Fleet list, add profile count badge when > 1:

```tsx
<div className="text-[11px] text-slate-500">
  <CloudIcon cloud={agent.cloud} className="text-[11px] mr-1" />
  {agent.cloud.toUpperCase()} {agent.region}
  {profileCount > 1 && (
    <span className="ml-1.5 text-indigo-400">{profileCount} profiles</span>
  )}
</div>
```

- [ ] **Step 2: Verify web build compiles**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/features/dashboard/OrgDashboard.tsx
git commit -m "feat(frontend): show per-profile stats in OrgDashboard"
```

---

### Task 11: Orchestrator — Profile upload in deploy and update

**Files:**
- Modify: `src/orchestrator/shared.ts`
- Modify: `src/orchestrator/deploy.ts`
- Modify: `src/orchestrator/update.ts`

- [ ] **Step 1: Add validateProfileFiles to shared.ts**

In `src/orchestrator/shared.ts`, update `validateProjectFiles` to also validate profile files:

```typescript
export function validateProjectFiles(projectDir: string, config: HermesTomlConfig): void {
  // ... existing checks ...

  // Validate profile files
  for (const profile of config.hermes.profiles) {
    checks.push(
      { field: `profiles.${profile.name}.config_file`, path: pathResolve(projectDir, profile.config_file) },
      { field: `profiles.${profile.name}.secrets_file`, path: pathResolve(projectDir, profile.secrets_file) },
    );
    for (const [docName, relPath] of Object.entries(profile.documents)) {
      checks.push({
        field: `profiles.${profile.name}.documents."${docName}"`,
        path: pathResolve(projectDir, relPath),
      });
    }
  }

  for (const check of checks) {
    if (!existsSync(check.path)) {
      throw new HermesTomlError(`${check.field} not found: ${check.path}`);
    }
  }
}
```

- [ ] **Step 2: Add uploadProfileFiles function to shared.ts**

Add to `src/orchestrator/shared.ts`:

```typescript
import type { ProfileConfig } from '../schema/hermes-toml.js';

/**
 * Upload files for a single named profile. Creates the profile on the VM
 * if it doesn't exist, then uploads config.yaml, decrypted secrets (.env),
 * and documents to the profile's HERMES_HOME directory.
 */
export async function uploadProfileFiles(args: {
  session: SshSession;
  projectDir: string;
  profile: ProfileConfig;
  ageKeyPath: string;
  reporter: Reporter;
}): Promise<void> {
  const { session, projectDir, profile, ageKeyPath, reporter } = args;
  const profileHome = `/var/lib/hermes/.hermes/profiles/${profile.name}`;

  // Check if profile exists, create if not
  const checkResult = await session.exec(`test -d ${profileHome} && echo exists || echo missing`);
  if (checkResult.stdout.trim() === 'missing') {
    reporter.log(`  Creating profile "${profile.name}"...`);
    // Run as hermes user
    const createResult = await session.exec(
      `su - hermes -s /bin/sh -c "hermes profile create ${profile.name}" 2>&1`,
    );
    if (createResult.exitCode !== 0) {
      throw new Error(`Failed to create profile "${profile.name}": ${createResult.stdout} ${createResult.stderr}`);
    }
  }

  // Upload config.yaml
  const configContent = readFileSync(pathResolve(projectDir, profile.config_file));
  await session.uploadFile(`${profileHome}/config.yaml`, configContent);

  // Decrypt and upload secrets as .env
  // Use sops to decrypt the secrets file, then upload
  const secretsPath = pathResolve(projectDir, profile.secrets_file);
  const secretsContent = readFileSync(secretsPath);
  // Upload encrypted file, then decrypt on-box using the age key
  await session.uploadFile(`${profileHome}/secrets.env.enc`, secretsContent);
  const decryptResult = await session.exec(
    `SOPS_AGE_KEY_FILE=/var/lib/sops-nix/age.key sops -d ${profileHome}/secrets.env.enc > ${profileHome}/.env 2>&1`,
  );
  if (decryptResult.exitCode !== 0) {
    reporter.log(`  Warning: could not decrypt secrets for profile "${profile.name}": ${decryptResult.stdout}`);
  }

  // Upload documents
  for (const [docName, relPath] of Object.entries(profile.documents)) {
    const docContent = readFileSync(pathResolve(projectDir, relPath));
    await session.uploadFile(`${profileHome}/${docName}`, docContent);
  }

  // Fix ownership — uploads as root, hermes user needs access
  await session.exec(`chown -R hermes:hermes ${profileHome}`);
}
```

- [ ] **Step 3: Add computeProfileHash function to shared.ts**

```typescript
import { computeConfigHash } from '../state/hash.js';

/** Compute a hash of a profile's files for change detection. */
export function computeProfileHash(projectDir: string, profile: ProfileConfig): string {
  const paths = [
    pathResolve(projectDir, profile.config_file),
    pathResolve(projectDir, profile.secrets_file),
    ...Object.values(profile.documents).map(p => pathResolve(projectDir, p)),
  ];
  return computeConfigHash(paths, true);
}
```

- [ ] **Step 4: Update deploy.ts to upload profiles after bootstrap**

In `src/orchestrator/deploy.ts`, after the healthcheck phase (around line 243), add profile upload:

```typescript
// === Phase 5.5 — upload profile files ===
if (config.hermes.profiles.length > 0) {
  reporter.log(`Uploading ${config.hermes.profiles.length} profile(s)...`);
  const profileSession = await opts.sessionFactory(instance.publicIp, readFileSync(sshKeyPath, 'utf-8'));
  try {
    for (const profile of config.hermes.profiles) {
      reporter.log(`  Profile: ${profile.name}`);
      await uploadProfileFiles({
        session: profileSession,
        projectDir: opts.projectDir,
        profile,
        ageKeyPath,
        reporter,
      });
    }
    // Store profile hashes
    await store.update(state => {
      const d = state.deployments[config.name]!;
      d.profile_hashes = {};
      for (const profile of config.hermes.profiles) {
        d.profile_hashes[profile.name] = computeProfileHash(opts.projectDir, profile);
      }
    });
  } finally {
    await profileSession.dispose();
  }
}
```

Add imports at top of `deploy.ts`:
```typescript
import { uploadAndRebuild, recordConfigAndHealthcheck, validateProjectFiles, uploadProfileFiles, computeProfileHash } from './shared.js';
```

- [ ] **Step 5: Update update.ts to upload changed profiles**

In `src/orchestrator/update.ts`, after the healthcheck phase, add profile upload with hash-based change detection:

```typescript
// === Phase 5.5 — upload changed profile files ===
if (config.hermes.profiles.length > 0) {
  const storedHashes = deployment.profile_hashes ?? {};
  const changedProfiles = config.hermes.profiles.filter(p => {
    const newHash = computeProfileHash(deployment.project_path, p);
    return newHash !== storedHashes[p.name];
  });

  if (changedProfiles.length > 0) {
    reporter.log(`Uploading ${changedProfiles.length} changed profile(s)...`);
    const profileSession = await opts.sessionFactory(deployment.instance_ip, readFileSync(deployment.ssh_key_path, 'utf-8'));
    try {
      for (const profile of changedProfiles) {
        reporter.log(`  Profile: ${profile.name}`);
        await uploadProfileFiles({
          session: profileSession,
          projectDir: deployment.project_path,
          profile,
          ageKeyPath: deployment.age_key_path,
          reporter,
        });
        // Restart gateway for this profile if it was running
        await profileSession.exec(
          `su - hermes -s /bin/sh -c "hermes -p ${profile.name} gateway restart" 2>&1 || true`,
        );
      }
      // Update stored hashes
      await store.update(state => {
        const d = state.deployments[opts.deploymentName]!;
        if (!d.profile_hashes) d.profile_hashes = {};
        for (const profile of config.hermes.profiles) {
          d.profile_hashes[profile.name] = computeProfileHash(deployment.project_path, profile);
        }
      });
    } finally {
      await profileSession.dispose();
    }
  }
}
```

Add imports at top of `update.ts`:
```typescript
import { uploadAndRebuild, recordConfigAndHealthcheck, validateProjectFiles, uploadProfileFiles, computeProfileHash } from './shared.js';
```

- [ ] **Step 6: Verify build compiles**

Run: `cd /Users/paulcailly/hermes-deploy && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Run full test suite**

Run: `cd /Users/paulcailly/hermes-deploy && npx vitest run`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/orchestrator/shared.ts src/orchestrator/deploy.ts src/orchestrator/update.ts
git commit -m "feat(orchestrator): profile file upload in deploy and update flows"
```

---

### Task 12: Build and manual verification

**Files:** None (verification only)

- [ ] **Step 1: Full backend build**

Run: `cd /Users/paulcailly/hermes-deploy && npx tsc --noEmit && npm run build`
Expected: Clean build, no errors

- [ ] **Step 2: Full web build**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit && npx vite build`
Expected: Clean build, no errors

- [ ] **Step 3: Run all tests**

Run: `cd /Users/paulcailly/hermes-deploy && npx vitest run`
Expected: ALL PASS

Run: `cd /Users/paulcailly/hermes-deploy/web && npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Start dev server and verify dashboard**

Run: `cd /Users/paulcailly/hermes-deploy && npm run dev` (or the dev startup script)

Verify in browser:
1. Dashboard loads without errors
2. Agent list shows agents as before
3. Clicking an agent shows the workspace — if the agent has no profiles, no ProfileSwitcher appears (same as before)
4. Config tab works as before for single-profile agents
5. No console errors

- [ ] **Step 5: Final commit if any remaining changes**

```bash
git add -A
git commit -m "chore: build verification for profiles support"
```
