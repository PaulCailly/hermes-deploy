# hermes-deploy M3 — Schema Redesign Implementation Plan

> **For agentic workers:** Use the `subagent-driven-development` skill (recommended) or the `executing-plans` skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the M1/M2 `hermes.toml` schema with one that maps cleanly to upstream's actual `services.hermes-agent.*` option surface, so every field in `hermes.toml` reaches the running agent and `update` becomes genuinely useful.

**Architecture:** hermes-deploy stops modeling the agent's config schema. `config.yaml` (user-provided, sibling of `hermes.toml`) is uploaded verbatim and pointed at via `services.hermes-agent.configFile`. Secrets live in a sops-encrypted dotenv file (`secrets.env.enc`) decrypted by sops-nix at activation, merged into `$HERMES_HOME/.env`, and resolved via `${VAR}` substitution inside `config.yaml` at agent startup. `[hermes.documents]` and `[hermes.environment]` give first-class TOML access to the upstream module's `documents` and `environment` options. Everything else still goes through `nix_extra` as the escape hatch.

**Tech Stack:** No new dependencies. Reuses M2's stack: TypeScript, Vitest, Zod, smol-toml, ssh2, @aws-sdk/client-ec2, sops-nix, age, ink (unchanged).

---

## M3 Scope

### In M3

| Capability | Notes |
|---|---|
| New `hermes.toml` schema | Drops `model`/`soul`/`platforms.*`/`mcp_servers`/`secrets_file`/`nix_extra` table form. Adds `config_file`, `secrets_file` (renamed/repointed), `[hermes.documents]`, `[hermes.environment]`. Keeps `name`/`[cloud]`/`[network]`/`[hermes.cachix]` unchanged. |
| `config.yaml` upload | hermes-deploy SCPs the user's `config.yaml` to `/etc/nixos/config.yaml` and points `services.hermes-agent.configFile` at it. |
| `secrets.env.enc` dotenv pipeline | sops-nix decrypts with `format = "dotenv"`, exposes at `/run/secrets/hermes-env`, hermes-agent's activation script merges into `$HERMES_HOME/.env`, agent loads via `load_hermes_dotenv()`, `${VAR}` references in `config.yaml` resolve at startup. |
| `[hermes.documents]` first-class | Attrset of `<filename>` → `<relative-path>`. Generator translates to `services.hermes-agent.documents = { ... }` and uploads each file. |
| `[hermes.environment]` first-class | Attrset of `KEY` → `string`. Generator translates to `services.hermes-agent.environment = { ... }` for non-secret env vars. |
| State migration v1→v2 | One-line bump (state shape unchanged). |
| `init` scaffolds new file set | Writes `hermes.toml` + `config.yaml` + `SOUL.md` + `secrets.env.enc` + `.sops.yaml` + `.gitignore` in one go. |
| `secret set/get/rm/list` work on dotenv | Direct `KEY=value` mutation instead of YAML parsing. |
| Migration doc | `docs/migrating-from-m2.md` with the 5-line manual procedure. |

### Out of M3 (deferred to M4+)

- GCP provider implementation
- Cachix population workflow
- Pre-baked AMI pipeline
- `ls --watch` live Ink dashboard
- The "skip rebuild on network-only updates" optimization
- E2E test suite, npm publishing, release tooling

### What M3 proves

After M3 ships, this works end-to-end on AWS without any manual SSH-and-edit-files-on-the-box steps:

```bash
hermes-deploy init
# edit ./config.yaml (or copy from ~/.hermes/config.yaml)
hermes-deploy secret set ANTHROPIC_API_KEY sk-...
hermes-deploy secret set DISCORD_BOT_TOKEN MTI...
hermes-deploy up
# agent is running, has the API key, connects to Discord
hermes-deploy update   # iterate
```

---

## File Structure

### New files in M3

```
src/init-templates/config-yaml.ts        # starter config.yaml template (string literal)
docs/plans/2026-04-09-hermes-deploy-M3-schema-redesign.md   # this plan
docs/migrating-from-m2.md                 # manual M1/M2 → M3 migration
tests/fixtures/hermes-toml/m3-minimal.toml      # new schema fixture
tests/fixtures/hermes-toml/m3-full.toml         # new schema fixture (everything optional set)
tests/fixtures/hermes-toml/m3-invalid.toml      # rejection fixture
tests/fixtures/nix-snapshots/m3-minimal.hermes.nix     # regenerated snapshot
tests/fixtures/nix-snapshots/m3-full.hermes.nix        # regenerated snapshot
```

### Modified files (from M2)

```
src/schema/hermes-toml.ts                # complete schema rewrite
src/state/migrations.ts                  # add migrations[2], bump CURRENT_SCHEMA_VERSION
src/sops/bootstrap.ts                    # creates secrets.env.enc as dotenv-format sops file
src/commands/secret.ts                   # operates on dotenv instead of YAML
src/nix-gen/templates.ts                 # configuration.nix dotenv sops block, drop placeholder
src/nix-gen/generate.ts                  # generateHermesNix rewritten for new schema fields
src/orchestrator/shared.ts               # uploadAndRebuild uploads new file set + computes new hash
src/init-templates/hermes-toml.ts        # template for new schema
src/init-templates/gitignore.ts          # filename change to secrets.env.enc
src/commands/init.ts                     # scaffold new file set including config.yaml
README.md                                 # M3 status banner, smoke-test workflow update
docs/getting-started.md                  # update walkthrough for new file set
docs/schema-reference.md                 # rewrite for new schema
tests/unit/schema/hermes-toml.test.ts    # rewrite for new schema
tests/unit/state/migrations.test.ts      # add v1→v2 migration test
tests/unit/sops/bootstrap.test.ts        # rewrite for dotenv format
tests/unit/commands/secret.test.ts       # rewrite for dotenv format
tests/unit/commands/init.test.ts         # rewrite for new file set
tests/unit/nix-gen/generate.test.ts      # rewrite for new generator output
tests/unit/orchestrator/deploy.test.ts   # update fixtures for new schema fields
tests/unit/orchestrator/update.test.ts   # update fixtures for new schema fields
```

### Files NOT changed (from M2)

- All `src/cloud/**` (provider abstraction, AWS impl, factory) — schema redesign doesn't touch the cloud layer
- All `src/remote-ops/**` (ssh session, wait-ssh, nixos-rebuild, healthcheck) — unchanged
- `src/orchestrator/deploy.ts` — calls `shared.uploadAndRebuild`; no body changes
- `src/orchestrator/update.ts` — same
- `src/orchestrator/destroy.ts` — small tweak only: change the cleanup file list from `secrets.enc.yaml` to `secrets.env.enc`
- `src/commands/up.ts`, `update.ts`, `destroy.ts`, `status.ts`, `ssh.ts`, `logs.ts`, `ls.ts`, `key.ts`, `resolve.ts` — unchanged
- `src/state/store.ts`, `paths.ts`, `hash.ts` — unchanged (the hash function is generic; the caller in `shared.ts` decides the file list)
- `src/ui/**` — unchanged
- `src/utils/public-ip.ts` — unchanged

---

## Tasks

### Phase A — Schema and state migration

#### Task A1: Rewrite the `hermes.toml` schema for M3

**Files:**
- Modify: `src/schema/hermes-toml.ts`
- Modify: `tests/unit/schema/hermes-toml.test.ts`
- Create: `tests/fixtures/hermes-toml/m3-minimal.toml`
- Create: `tests/fixtures/hermes-toml/m3-full.toml`
- Create: `tests/fixtures/hermes-toml/m3-invalid.toml`
- Delete (via `git rm`): `tests/fixtures/hermes-toml/minimal.toml`, `tests/fixtures/hermes-toml/full.toml`, `tests/fixtures/hermes-toml/invalid.toml`

- [ ] **Step 1: Write the new minimal fixture**

```toml
# tests/fixtures/hermes-toml/m3-minimal.toml
name = "test-m3-minimal"

[cloud]
provider = "aws"
profile = "default"
region = "eu-west-3"
size = "small"

[hermes]
config_file = "./config.yaml"
secrets_file = "./secrets.env.enc"
```

- [ ] **Step 2: Write the new full fixture**

```toml
# tests/fixtures/hermes-toml/m3-full.toml
name = "test-m3-full"

[cloud]
provider = "aws"
profile = "acme"
region = "eu-west-3"
size = "large"
disk_gb = 50

[network]
ssh_allowed_from = "auto"
inbound_ports = [443, 8080]

[hermes]
config_file = "./config.yaml"
secrets_file = "./secrets.env.enc"
nix_extra = "./hermes.extra.nix"

[hermes.documents]
"SOUL.md" = "./SOUL.md"
"persona.md" = "./behaviors/persona.md"

[hermes.environment]
LOG_LEVEL = "debug"
RUST_BACKTRACE = "1"

[hermes.cachix]
name = "acme-deploys"
public_key = "acme-deploys.cachix.org-1:dGhpc2lzYWZha2VrZXlmb3JzbW9rZXRlc3Rpbmdvbmx5UU9PMA=="
```

- [ ] **Step 3: Write the invalid fixture (missing required hermes fields, unknown provider)**

```toml
# tests/fixtures/hermes-toml/m3-invalid.toml
name = "test-m3-invalid"

[cloud]
provider = "azure"
profile = "default"
region = "eu-west-3"
size = "huge"

[hermes]
# missing required config_file and secrets_file
```

- [ ] **Step 4: Rewrite the schema test**

Replace the entire content of `tests/unit/schema/hermes-toml.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { HermesTomlSchema } from '../../../src/schema/hermes-toml.js';

const fixturesDir = join(__dirname, '../../fixtures/hermes-toml');
const loadFixture = (name: string) =>
  parseToml(readFileSync(join(fixturesDir, name), 'utf-8'));

describe('HermesTomlSchema (M3)', () => {
  it('accepts the minimal valid M3 config', () => {
    const raw = loadFixture('m3-minimal.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('test-m3-minimal');
      expect(result.data.cloud.provider).toBe('aws');
      expect(result.data.cloud.disk_gb).toBe(30); // default
      expect(result.data.network.ssh_allowed_from).toBe('auto'); // default
      expect(result.data.network.inbound_ports).toEqual([]); // default
      expect(result.data.hermes.config_file).toBe('./config.yaml');
      expect(result.data.hermes.secrets_file).toBe('./secrets.env.enc');
      expect(result.data.hermes.nix_extra).toBeUndefined();
      expect(result.data.hermes.documents).toEqual({});
      expect(result.data.hermes.environment).toEqual({});
      expect(result.data.hermes.cachix).toBeUndefined();
    }
  });

  it('accepts the full M3 config with all optional fields', () => {
    const raw = loadFixture('m3-full.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cloud.disk_gb).toBe(50);
      expect(result.data.network.inbound_ports).toEqual([443, 8080]);
      expect(result.data.hermes.nix_extra).toBe('./hermes.extra.nix');
      expect(result.data.hermes.documents).toEqual({
        'SOUL.md': './SOUL.md',
        'persona.md': './behaviors/persona.md',
      });
      expect(result.data.hermes.environment).toEqual({
        LOG_LEVEL: 'debug',
        RUST_BACKTRACE: '1',
      });
      expect(result.data.hermes.cachix?.name).toBe('acme-deploys');
    }
  });

  it('rejects an invalid config (bad enum + missing required hermes fields)', () => {
    const raw = loadFixture('m3-invalid.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map(i => i.path.join('.'));
      expect(issues).toContain('cloud.provider');
      expect(issues).toContain('cloud.size');
      expect(issues).toContain('hermes.config_file');
      expect(issues).toContain('hermes.secrets_file');
    }
  });

  it('requires gcp configs to specify zone', () => {
    const result = HermesTomlSchema.safeParse({
      name: 'gcp-no-zone',
      cloud: { provider: 'gcp', profile: 'p', region: 'europe-west1', size: 'small' },
      hermes: { config_file: './config.yaml', secrets_file: './secrets.env.enc' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown extra field at the top level (no silent drops)', () => {
    const result = HermesTomlSchema.safeParse({
      name: 'extra-field',
      cloud: { provider: 'aws', profile: 'd', region: 'eu-west-3', size: 'small' },
      hermes: { config_file: './c.yaml', secrets_file: './s.env.enc' },
      bogus_field: 'oops',
    });
    // We use .strip() (default) so unknown top-level keys are dropped
    // silently. This test documents the choice — if M4 wants strict
    // validation, change this assertion.
    expect(result.success).toBe(true);
  });

  it('validates cachix.public_key format', () => {
    const result = HermesTomlSchema.safeParse({
      name: 'cachix-bad',
      cloud: { provider: 'aws', profile: 'd', region: 'eu-west-3', size: 'small' },
      hermes: {
        config_file: './c.yaml',
        secrets_file: './s.env.enc',
        cachix: { name: 'mycache', public_key: 'not-a-valid-key' },
      },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run tests/unit/schema/hermes-toml.test.ts`
Expected: FAIL — the M2 schema doesn't have `config_file`, `secrets_file` (required), `documents`, `environment`, etc., and still has the deleted fields.

- [ ] **Step 6: Rewrite the schema**

Replace the entire content of `src/schema/hermes-toml.ts` with:

```typescript
import { z } from 'zod';

const SizeSchema = z.enum(['small', 'medium', 'large']);
const ProviderSchema = z.enum(['aws', 'gcp']);

const CloudSchema = z
  .object({
    provider: ProviderSchema,
    profile: z.string().min(1),
    region: z.string().min(1),
    zone: z.string().min(1).optional(),
    size: SizeSchema,
    // Root disk size in GB. NixOS community AMIs default to ~5 GB,
    // which is too small to build the hermes-agent Python closure
    // from source. 30 GB is a safe floor; raise for heavier deployments.
    disk_gb: z.number().int().min(8).max(500).default(30),
  })
  .refine(c => c.provider !== 'gcp' || !!c.zone, {
    message: 'cloud.zone is required when cloud.provider = "gcp"',
    path: ['zone'],
  });

const NetworkSchema = z.object({
  ssh_allowed_from: z.string().min(1).default('auto'),
  inbound_ports: z.array(z.number().int().min(1).max(65535)).default([]),
});

// [hermes.cachix] — optional binary substituter for the hermes-agent
// closure. Unchanged from M2.
const CachixSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, {
      message: 'cachix.name must be lowercase alphanumeric with hyphens',
    }),
  public_key: z.string().regex(/^[a-z0-9-]+\.cachix\.org-1:[A-Za-z0-9+/=]+$/, {
    message:
      'cachix.public_key must look like "<name>.cachix.org-1:<base64>" — copy it from your cache settings page',
  }),
});

// [hermes] — pure infrastructure pointers + escape hatch.
// hermes-deploy intentionally does NOT model the agent's config.yaml
// schema. The user provides config.yaml directly; we upload it and
// point services.hermes-agent.configFile at it.
const HermesSchema = z.object({
  config_file: z.string().min(1),
  secrets_file: z.string().min(1),
  nix_extra: z.string().min(1).optional(),
  documents: z.record(z.string().min(1), z.string().min(1)).default({}),
  environment: z.record(z.string().min(1), z.string()).default({}),
  cachix: CachixSchema.optional(),
});

export const HermesTomlSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]{0,62}$/, {
    message: 'name must be lowercase alphanumeric with hyphens, 1-63 chars',
  }),
  cloud: CloudSchema,
  network: NetworkSchema.default({ ssh_allowed_from: 'auto', inbound_ports: [] }),
  hermes: HermesSchema,
});

export type HermesTomlConfig = z.infer<typeof HermesTomlSchema>;
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/unit/schema/hermes-toml.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 8: Delete the old M1/M2 fixtures**

Run:
```bash
git rm tests/fixtures/hermes-toml/minimal.toml tests/fixtures/hermes-toml/full.toml tests/fixtures/hermes-toml/invalid.toml
```

- [ ] **Step 9: Run the full suite to surface downstream breakage**

Run: `npx vitest run`
Expected: many tests fail because they reference the old fixtures, the old schema fields, and the old generator output. **This is expected — the rest of the plan fixes them in order.** Note the failing tests for tracking.

- [ ] **Step 10: Commit (acknowledging downstream breakage)**

```bash
git add src/schema/hermes-toml.ts \
        tests/unit/schema/hermes-toml.test.ts \
        tests/fixtures/hermes-toml/m3-minimal.toml \
        tests/fixtures/hermes-toml/m3-full.toml \
        tests/fixtures/hermes-toml/m3-invalid.toml
git commit -m "feat(schema): rewrite hermes.toml for M3 (drops model/soul/platforms, adds documents/environment)"
```

The full suite is intentionally red after this commit. Subsequent tasks restore green.

#### Task A2: State migration v1 → v2 (no-op bump)

**Files:**
- Modify: `src/state/migrations.ts`
- Modify: `tests/unit/state/migrations.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/state/migrations.test.ts` inside the existing `describe('runMigrations', ...)` block:

```typescript
  it('exposes CURRENT_SCHEMA_VERSION === 2 after the M3 bump', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
  });

  it('migrates a v1 state file to v2 by bumping the version field', () => {
    const v1 = {
      schema_version: 1,
      deployments: {
        'm2-leftover': {
          project_path: '/x',
          cloud: 'aws',
          region: 'eu-west-3',
          created_at: '2026-04-09T00:00:00Z',
          last_deployed_at: '2026-04-09T00:00:00Z',
          last_config_hash: 'sha256:m2',
          ssh_key_path: '/x',
          age_key_path: '/x',
          health: 'healthy',
          instance_ip: '203.0.113.42',
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
    const migrated = runMigrations(v1) as any;
    expect(migrated.schema_version).toBe(2);
    // Deployment shape is unchanged from v1 → v2
    expect(migrated.deployments['m2-leftover'].cloud_resources.instance_id).toBe('i-1');
  });

  it('is a no-op on already-current v2 state', () => {
    const v2 = { schema_version: 2, deployments: {} };
    const migrated = runMigrations(v2);
    expect(migrated).toEqual(v2);
  });
```

Also update the existing test that asserts `CURRENT_SCHEMA_VERSION === 1` — change `1` to `2`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/state/migrations.test.ts`
Expected: FAIL — `CURRENT_SCHEMA_VERSION` is still 1, no `migrations[2]`.

- [ ] **Step 3: Update `src/state/migrations.ts`**

Change line 1 from:
```typescript
export const CURRENT_SCHEMA_VERSION = 1;
```
to:
```typescript
export const CURRENT_SCHEMA_VERSION = 2;
```

Add inside the `migrations` object literal (after the existing `1: ...` entry, before the closing brace):

```typescript
  2: (input: unknown) => {
    // M3 schema migration: the state file shape itself is unchanged
    // between v1 and v2. Only the user-facing hermes.toml shape changed.
    // The deployment metadata (cloud_resources, ssh_key_path, etc.) is
    // identical, so this migration just bumps the schema_version field.
    // User-file migration (hermes.toml v1 → v2) is manual; see
    // docs/migrating-from-m2.md.
    const v1 = input as { schema_version: number; deployments: Record<string, unknown> };
    return { ...v1, schema_version: 2 };
  },
```

Also update the StateTomlSchema validation: it currently requires `schema_version: z.literal(1)`. Bump it to `z.literal(2)`.

In `src/schema/state-toml.ts`, change:
```typescript
  schema_version: z.literal(1),
```
to:
```typescript
  schema_version: z.literal(2),
```

Also update `src/state/store.ts` — its `read()` method writes a stub state file when missing:
```typescript
return { schema_version: 1, deployments: {} };
```
becomes:
```typescript
return { schema_version: 2, deployments: {} };
```

And the lockfile-init bootstrap inside `update()`:
```typescript
writeFileSync(this.paths.stateFile, 'schema_version = 1\n[deployments]\n');
```
becomes:
```typescript
writeFileSync(this.paths.stateFile, 'schema_version = 2\n[deployments]\n');
```

- [ ] **Step 4: Run the migration test to verify it passes**

Run: `npx vitest run tests/unit/state/migrations.test.ts`
Expected: 7/7 PASS (the existing 4 + the 3 new ones).

- [ ] **Step 5: Run all state-related tests**

Run: `npx vitest run tests/unit/state/ tests/unit/schema/state-toml.test.ts`
Expected: all PASS. The store and schema tests use whatever literal value `CURRENT_SCHEMA_VERSION` and `StateTomlSchema` declare, so bumping both keeps them consistent.

- [ ] **Step 6: Commit**

```bash
git add src/state/migrations.ts src/state/store.ts src/schema/state-toml.ts tests/unit/state/migrations.test.ts
git commit -m "feat(state): bump schema_version to 2 for M3 (no-op deployment shape migration)"
```

---

### Phase B — Sops bootstrap and secret commands

#### Task B1: SOPS bootstrap creates `secrets.env.enc` (dotenv format)

**Files:**
- Modify: `src/sops/bootstrap.ts`
- Modify: `tests/unit/sops/bootstrap.test.ts`

- [ ] **Step 1: Rewrite the test**

Replace the entire content of `tests/unit/sops/bootstrap.test.ts` with:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { ensureSopsBootstrap } from '../../../src/sops/bootstrap.js';

const sopsAvailable = (() => {
  try {
    execSync('which sops', { stdio: 'ignore' });
    execSync('which age-keygen', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!sopsAvailable)('ensureSopsBootstrap (M3 dotenv)', () => {
  let dir: string;
  let publicKey: string;
  let ageKeyFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hermes-sops-m3-'));
    // Generate a real age key so sops can encrypt and we can decrypt
    const ageOutput = execSync('age-keygen', { encoding: 'utf-8' });
    const m = ageOutput.match(/^# public key: (age1[a-z0-9]+)$/m);
    if (!m || !m[1]) throw new Error('age-keygen output missing public key');
    publicKey = m[1];
    ageKeyFile = join(dir, 'age.key');
    writeFileSync(ageKeyFile, ageOutput);
    process.env['SOPS_AGE_KEY_FILE'] = ageKeyFile;
  });

  it('creates .sops.yaml with the age recipient and the dotenv path regex', () => {
    ensureSopsBootstrap(dir, publicKey);
    const sopsYaml = readFileSync(join(dir, '.sops.yaml'), 'utf-8');
    expect(sopsYaml).toContain('age1');
    expect(sopsYaml).toContain('secrets\\.env\\.enc$');
    rmSync(dir, { recursive: true });
  });

  it('creates secrets.env.enc as a dotenv-format sops file', () => {
    ensureSopsBootstrap(dir, publicKey);
    expect(existsSync(join(dir, 'secrets.env.enc'))).toBe(true);
    // Decrypt with sops and verify the result is dotenv-format
    const decrypted = execSync(`sops --decrypt ${join(dir, 'secrets.env.enc')}`, {
      encoding: 'utf-8',
      env: { ...process.env, SOPS_AGE_KEY_FILE: ageKeyFile },
    });
    // The placeholder line keeps the file non-empty so sops accepts it.
    // After M3 init, real users immediately overwrite this via secret set.
    expect(decrypted).toMatch(/^_HERMES_DEPLOY_PLACEHOLDER=/m);
    rmSync(dir, { recursive: true });
  });

  it('is idempotent: re-running does not overwrite existing files', () => {
    ensureSopsBootstrap(dir, publicKey);
    const sopsBefore = readFileSync(join(dir, '.sops.yaml'), 'utf-8');
    const secretsBefore = readFileSync(join(dir, 'secrets.env.enc'), 'utf-8');
    ensureSopsBootstrap(dir, publicKey);
    expect(readFileSync(join(dir, '.sops.yaml'), 'utf-8')).toBe(sopsBefore);
    expect(readFileSync(join(dir, 'secrets.env.enc'), 'utf-8')).toBe(secretsBefore);
    rmSync(dir, { recursive: true });
  });

  it('does not create a v1-shape secrets.enc.yaml file', () => {
    ensureSopsBootstrap(dir, publicKey);
    expect(existsSync(join(dir, 'secrets.enc.yaml'))).toBe(false);
    rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/sops/bootstrap.test.ts`
Expected: FAIL — current bootstrap creates `secrets.enc.yaml` (YAML), not `secrets.env.enc` (dotenv).

- [ ] **Step 3: Rewrite `src/sops/bootstrap.ts`**

Replace the entire content with:

```typescript
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Initialize the project's sops setup if missing:
 *   - .sops.yaml records the per-deployment age public key as a recipient
 *     for any file matching `secrets.env.enc$`
 *   - secrets.env.enc is a sops-encrypted dotenv file with one placeholder
 *     line (`_HERMES_DEPLOY_PLACEHOLDER=initialized`). The placeholder
 *     keeps the file non-empty so sops accepts it; users immediately
 *     overwrite it via `hermes-deploy secret set`.
 *
 * Idempotent — both files are created only if missing.
 */
export function ensureSopsBootstrap(projectDir: string, agePublicKey: string): void {
  const sopsYamlPath = join(projectDir, '.sops.yaml');
  if (!existsSync(sopsYamlPath)) {
    const content = `creation_rules:
  - path_regex: secrets\\.env\\.enc$
    age: ${agePublicKey}
`;
    writeFileSync(sopsYamlPath, content);
  }

  const secretsPath = join(projectDir, 'secrets.env.enc');
  if (!existsSync(secretsPath)) {
    // Plaintext placeholder content. sops --encrypt will rewrite this
    // file in place with the encrypted version.
    const placeholder = '_HERMES_DEPLOY_PLACEHOLDER=initialized\n';
    writeFileSync(secretsPath, placeholder);
    try {
      execFileSync(
        'sops',
        ['--encrypt', '--input-type', 'dotenv', '--output-type', 'dotenv', '--in-place', secretsPath],
        { cwd: projectDir, stdio: 'pipe' },
      );
    } catch (e) {
      throw new Error(
        `sops encryption failed: ${(e as Error).message}. ` +
        `Ensure 'sops' is installed and your age recipient is valid.`,
      );
    }
  }
}
```

The key changes from M2:

- Filename: `secrets.enc.yaml` → `secrets.env.enc`
- `.sops.yaml` `path_regex` updated to match the new filename
- Placeholder content: dotenv-format `KEY=VALUE` line instead of YAML
- `sops --encrypt` invocation now passes `--input-type dotenv --output-type dotenv` so sops doesn't try to autodetect from the file extension

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/sops/bootstrap.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sops/bootstrap.ts tests/unit/sops/bootstrap.test.ts
git commit -m "feat(sops): bootstrap secrets.env.enc as dotenv-format sops file"
```

#### Task B2: Secret commands operate on dotenv format

**Files:**
- Modify: `src/commands/secret.ts`
- Modify: `tests/unit/commands/secret.test.ts`

- [ ] **Step 1: Rewrite the secret commands to use dotenv parsing/serialization**

Replace `src/commands/secret.ts` with:

```typescript
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDeployment } from './resolve.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';

interface SecretContext {
  projectDir: string;
  secretsPath: string;
  ageKeyPath: string;
}

async function getContext(name?: string, projectPath?: string): Promise<SecretContext> {
  const { name: resolvedName, projectPath: resolvedProject } = await resolveDeployment({
    name,
    projectPath,
    cwd: process.cwd(),
  });

  const store = new StateStore(getStatePaths());
  const state = await store.read();
  const deployment = state.deployments[resolvedName];
  if (!deployment) {
    throw new Error(
      `deployment "${resolvedName}" not found in state — run \`hermes-deploy up\` first`,
    );
  }
  const secretsPath = join(resolvedProject, 'secrets.env.enc');
  return {
    projectDir: resolvedProject,
    secretsPath,
    ageKeyPath: deployment.age_key_path,
  };
}

function runSops(args: string[], ageKeyFile: string): string {
  const result = spawnSync('sops', args, {
    encoding: 'utf-8',
    env: { ...process.env, SOPS_AGE_KEY_FILE: ageKeyFile },
  });
  if (result.status !== 0) {
    throw new Error(`sops ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Parse a dotenv-format string into a Record. Tolerates blank lines and
 * `#`-prefixed comments. Does NOT handle quoted values or multi-line
 * values — hermes-deploy is opinionated about secrets being single-line
 * KEY=value (no spaces around =, no surrounding quotes). If a real
 * user need for quoted values shows up, switch to a real dotenv parser.
 */
function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (key) out[key] = value;
  }
  return out;
}

function stringifyDotenv(data: Record<string, string>): string {
  const lines = Object.entries(data).map(([k, v]) => `${k}=${v}`);
  return lines.join('\n') + '\n';
}

async function readSecrets(ctx: SecretContext): Promise<Record<string, string>> {
  const decrypted = runSops(
    ['--decrypt', '--input-type', 'dotenv', '--output-type', 'dotenv', ctx.secretsPath],
    ctx.ageKeyPath,
  );
  return parseDotenv(decrypted);
}

function writeSecrets(ctx: SecretContext, data: Record<string, string>): void {
  const plain = stringifyDotenv(data);
  writeFileSync(ctx.secretsPath, plain);
  runSops(
    ['--encrypt', '--input-type', 'dotenv', '--output-type', 'dotenv', '--in-place', ctx.secretsPath],
    ctx.ageKeyPath,
  );
}

export interface SecretRefOptions {
  name?: string;
  projectPath?: string;
}

export async function secretSet(
  opts: SecretRefOptions & { key: string; value: string },
): Promise<void> {
  const ctx = await getContext(opts.name, opts.projectPath);
  const data = await readSecrets(ctx);
  data[opts.key] = opts.value;
  writeSecrets(ctx, data);
}

export async function secretGet(
  opts: SecretRefOptions & { key: string },
): Promise<string | undefined> {
  const ctx = await getContext(opts.name, opts.projectPath);
  const data = await readSecrets(ctx);
  return data[opts.key];
}

export async function secretRemove(
  opts: SecretRefOptions & { key: string },
): Promise<void> {
  const ctx = await getContext(opts.name, opts.projectPath);
  const data = await readSecrets(ctx);
  delete data[opts.key];
  writeSecrets(ctx, data);
}

export async function secretList(opts: SecretRefOptions): Promise<string[]> {
  const ctx = await getContext(opts.name, opts.projectPath);
  const data = await readSecrets(ctx);
  return Object.keys(data);
}

export async function secretEdit(opts: SecretRefOptions): Promise<void> {
  if (!process.stdout.isTTY) {
    throw new Error(
      'secret edit requires an interactive terminal. Use `secret set <key> <value>` from non-TTY contexts.',
    );
  }

  const ctx = await getContext(opts.name, opts.projectPath);
  // sops detects the .env extension OK on direct edit, but be explicit
  execFileSync('sops', ['--input-type', 'dotenv', '--output-type', 'dotenv', ctx.secretsPath], {
    stdio: 'inherit',
    env: { ...process.env, SOPS_AGE_KEY_FILE: ctx.ageKeyPath },
  });
}
```

- [ ] **Step 2: Update the secret test fixtures**

The existing `tests/unit/commands/secret.test.ts` references `secrets.enc.yaml` everywhere. Find-and-replace within that file: change every `secrets.enc.yaml` to `secrets.env.enc`. The test bodies otherwise stay the same — `secret set/get/rm/list` semantics are identical from the user's perspective.

The `ensureSopsBootstrap(projectDir, publicKey)` call in the test's `beforeEach` already produces the right file shape after Task B1 — no test logic changes needed.

Also: M2 had a test that asserted the placeholder key was named `placeholder`. M3 names it `_HERMES_DEPLOY_PLACEHOLDER`. Update any test that asserts on this string.

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/unit/commands/secret.test.ts`
Expected: 3/3 PASS (the same 3 tests as M2: set+get round-trip, list after multiple sets, rm).

- [ ] **Step 4: Run the full sops + secret + bootstrap suite**

Run: `npx vitest run tests/unit/sops/ tests/unit/commands/secret.test.ts`
Expected: 7/7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/secret.ts tests/unit/commands/secret.test.ts
git commit -m "feat(cli): secret commands operate on dotenv-format secrets.env.enc"
```

---

### Phase C — Nix templates and generator

#### Task C1: `configuration.nix` template — dotenv sops secret, drop placeholder

**Files:**
- Modify: `src/nix-gen/templates.ts`
- Modify: `tests/unit/nix-gen/generate.test.ts`

- [ ] **Step 1: Update the configuration.nix template's sops block**

In `src/nix-gen/templates.ts`, find the `sops = { ... }` block inside `configurationNix(...)`'s template string and replace it with:

```nix
  sops = {
    defaultSopsFile = ./secrets.env.enc;
    age.keyFile = "/var/lib/sops-nix/age.key";
    # M3 declares a real secret (the dotenv-encoded environment file)
    # instead of M1.1's placeholder workaround. The real secret satisfies
    # hermes-agent's hardcoded `setupSecrets` activation dep AND wires
    # the decrypted file into services.hermes-agent.environmentFiles via
    # config.sops.secrets."hermes-env".path (referenced from hermes.nix).
    secrets."hermes-env" = {
      format = "dotenv";
      owner = config.services.hermes-agent.user;
      group = config.services.hermes-agent.group;
    };
  };
```

The literal string change inside `templates.ts` is:

OLD:
```typescript
  sops = {
    defaultSopsFile = ./secrets.enc.yaml;
    age.keyFile = "/var/lib/sops-nix/age.key";
    # Placeholder secret: hermes-agent's nixosModule hardcodes an activation
    # dep on "setupSecrets", which sops-nix only registers when at least one
    # ...
    secrets."placeholder" = { };
  };
```

NEW (replace just the body of `sops = {...}`):

```typescript
  sops = {
    defaultSopsFile = ./secrets.env.enc;
    age.keyFile = "/var/lib/sops-nix/age.key";
    secrets."hermes-env" = {
      format = "dotenv";
      owner = config.services.hermes-agent.user;
      group = config.services.hermes-agent.group;
    };
  };
```

(The full template comment about why we need a real secret can stay above the block — just remove the placeholder-specific paragraph.)

- [ ] **Step 2: Update the configuration.nix tests**

In `tests/unit/nix-gen/generate.test.ts`, find the `describe('generateConfigurationNix', ...)` block. Update the existing test to look for the new file/secret names:

```typescript
describe('generateConfigurationNix', () => {
  const baseConfig = loadHermesToml(join(fixturesDir, 'hermes-toml/m3-minimal.toml'));

  it('imports amazon-image, enables flakes, and declares the M3 dotenv sops secret', () => {
    const out = generateConfigurationNix(baseConfig);
    expect(out).toContain('imports = [');
    expect(out).toContain('virtualisation/amazon-image.nix');
    expect(out).toContain('experimental-features');
    expect(out).toContain('defaultSopsFile = ./secrets.env.enc;');
    expect(out).toContain('secrets."hermes-env"');
    expect(out).toContain('format = "dotenv"');
    expect(out).not.toContain('secrets."placeholder"');
    expect(out).not.toContain('secrets.enc.yaml');
    expect(out).toContain('system.stateVersion = "25.11"');
  });
  // ... cachix tests below stay unchanged ...
});
```

(The cachix-set / cachix-unset tests below this one in the existing file should still pass with the m3-minimal fixture — they only check substituter blocks. Just point them at the m3 fixture.)

- [ ] **Step 3: Run the configuration.nix test**

Run: `npx vitest run tests/unit/nix-gen/generate.test.ts -t "generateConfigurationNix"`
Expected: PASS for the updated test.

- [ ] **Step 4: Commit**

```bash
git add src/nix-gen/templates.ts tests/unit/nix-gen/generate.test.ts
git commit -m "feat(nix-gen): configuration.nix declares hermes-env dotenv sops secret"
```

#### Task C2: `flake.nix` template — conditional `nix_extra` inclusion

**Files:**
- Modify: `src/nix-gen/templates.ts`
- Modify: `tests/unit/nix-gen/generate.test.ts`

- [ ] **Step 1: Update the FLAKE_NIX template**

In `src/nix-gen/templates.ts`, find `export const FLAKE_NIX = ...` and update the `modules = [...]` line inside the outputs block:

OLD:
```nix
      modules = [
        ./configuration.nix
        ./hermes.nix
        sops-nix.nixosModules.sops
        hermes-agent.nixosModules.default
      ];
```

NEW:
```nix
      modules = [
        ./configuration.nix
        ./hermes.nix
        sops-nix.nixosModules.sops
        hermes-agent.nixosModules.default
      ] ++ nixpkgs.lib.optional (builtins.pathExists ./hermes.extra.nix) ./hermes.extra.nix;
```

The `pathExists` guard means the same flake.nix works whether or not the user has a `nix_extra` file — no per-deployment template variation.

- [ ] **Step 2: Update the flake test**

In `tests/unit/nix-gen/generate.test.ts`, find the `describe('generateFlakeNix', ...)` block and add a new test:

```typescript
  it('conditionally includes hermes.extra.nix via pathExists', () => {
    const out = generateFlakeNix();
    expect(out).toContain('builtins.pathExists ./hermes.extra.nix');
    expect(out).toContain('nixpkgs.lib.optional');
    expect(out).toContain('./hermes.extra.nix');
  });
```

(The existing two flake tests stay unchanged — they assert on the basic inputs/outputs structure.)

- [ ] **Step 3: Run the flake tests**

Run: `npx vitest run tests/unit/nix-gen/generate.test.ts -t "generateFlakeNix"`
Expected: 3/3 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/nix-gen/templates.ts tests/unit/nix-gen/generate.test.ts
git commit -m "feat(nix-gen): flake.nix conditionally includes hermes.extra.nix"
```

#### Task C3: Rewrite `generateHermesNix` for the new schema fields

**Files:**
- Modify: `src/nix-gen/generate.ts`
- Modify: `tests/unit/nix-gen/generate.test.ts`
- Create: `tests/fixtures/nix-snapshots/m3-minimal.hermes.nix`
- Create: `tests/fixtures/nix-snapshots/m3-full.hermes.nix`
- Delete: `tests/fixtures/nix-snapshots/minimal.hermes.nix`, `tests/fixtures/nix-snapshots/full.hermes.nix`

- [ ] **Step 1: Update the snapshot tests to point at the M3 fixtures**

In `tests/unit/nix-gen/generate.test.ts`, find the `describe('generateHermesNix', ...)` block. Update both `toMatchFileSnapshot` paths:

```typescript
describe('generateHermesNix (M3)', () => {
  it('matches the snapshot for the M3 minimal config', async () => {
    const config = loadHermesToml(join(fixturesDir, 'hermes-toml/m3-minimal.toml'));
    const got = generateHermesNix(config);
    await expect(got).toMatchFileSnapshot(
      join(fixturesDir, 'nix-snapshots/m3-minimal.hermes.nix'),
    );
  });

  it('matches the snapshot for the M3 full config', async () => {
    const config = loadHermesToml(join(fixturesDir, 'hermes-toml/m3-full.toml'));
    const got = generateHermesNix(config);
    await expect(got).toMatchFileSnapshot(
      join(fixturesDir, 'nix-snapshots/m3-full.hermes.nix'),
    );
  });

  it('throws on a documents value with characters invalid in a Nix path literal', () => {
    expect(() => generateHermesNix({
      name: 'x',
      cloud: { provider: 'aws', profile: 'default', region: 'eu-west-3', size: 'small', disk_gb: 30 },
      network: { ssh_allowed_from: 'auto', inbound_ports: [] },
      hermes: {
        config_file: './config.yaml',
        secrets_file: './secrets.env.enc',
        documents: { 'SOUL.md': './path with space/SOUL.md' },
        environment: {},
      },
    })).toThrow(/invalid in a Nix path literal/);
  });
});
```

- [ ] **Step 2: Rewrite `src/nix-gen/generate.ts` for the new schema**

Replace the entire content with:

```typescript
import type { HermesTomlConfig } from '../schema/hermes-toml.js';
import { configurationNix, FLAKE_NIX } from './templates.js';

export function generateConfigurationNix(config: HermesTomlConfig): string {
  return configurationNix(config.hermes.cachix);
}

export function generateFlakeNix(): string {
  return FLAKE_NIX;
}

/**
 * Generate hermes.nix from the validated hermes.toml config.
 *
 * Always emits services.hermes-agent.{enable, configFile, environmentFiles}.
 * Conditionally emits .documents and .environment when those tables are
 * non-empty. The user's nix_extra (when set) is uploaded as
 * /etc/nixos/hermes.extra.nix and pulled in by flake.nix's modules list
 * via pathExists — NOT via an `imports = [...]` line in hermes.nix
 * itself, so this generator stays simple.
 *
 * environmentFiles always references config.sops.secrets."hermes-env".path
 * because configuration.nix always declares that secret. The dotenv file
 * is always present (init bootstraps an empty placeholder one) and
 * sops-nix decrypts it at activation.
 */
export function generateHermesNix(config: HermesTomlConfig): string {
  const lines: string[] = [];
  lines.push('{ config, pkgs, lib, ... }:');
  lines.push('{');
  lines.push('  services.hermes-agent = {');
  lines.push('    enable = true;');
  lines.push('    configFile = ./config.yaml;');
  lines.push('    environmentFiles = [ config.sops.secrets."hermes-env".path ];');

  const docEntries = Object.entries(config.hermes.documents);
  if (docEntries.length > 0) {
    lines.push('');
    lines.push('    documents = {');
    for (const [filename, _path] of docEntries) {
      // The file is uploaded to /etc/nixos/<filename> by the orchestrator.
      // Inside hermes.nix the path is just ./<filename> — Nix path literals
      // resolve relative to the file containing them.
      lines.push('      "' + escapeNixString(filename) + '" = ' + nixPath('./' + filename) + ';');
    }
    lines.push('    };');
  }

  const envEntries = Object.entries(config.hermes.environment);
  if (envEntries.length > 0) {
    lines.push('');
    lines.push('    environment = {');
    for (const [key, value] of envEntries) {
      lines.push('      ' + key + ' = "' + escapeNixString(value) + '";');
    }
    lines.push('    };');
  }

  lines.push('  };');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

/**
 * Validate a string going into a Nix path literal. Nix unquoted path
 * literals support a limited character set — anything else (spaces,
 * shell metacharacters, etc.) is invalid syntax. We validate at
 * generation time so users get a clear error instead of a confusing
 * Nix evaluation failure on the box.
 */
function nixPath(p: string): string {
  if (/[^\w./+-]/.test(p)) {
    throw new Error(
      'nix-gen: path "' + p + '" contains characters that are invalid in a ' +
      'Nix path literal. Use a path with only [A-Za-z0-9._+-/] characters.',
    );
  }
  if (p.startsWith('./') || p.startsWith('/')) return p;
  return './' + p;
}

/** Escape a string for inclusion in a Nix double-quoted string literal. */
function escapeNixString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
}
```

Note: the old M2 generator validated `documents` values (the path side, not the key side) for nix-path-literal-safe characters. We now also need to validate the *destination filename* (the attrset key) because it ends up as both the literal Nix path and the attrset key — but the schema's `documents` is `Record<string, string>`, and we use the key as both. Validation goes on the key side via `nixPath('./' + filename)` — same rules apply.

For document KEYS that have invalid characters (like a space), the same `nixPath` error fires. The test in Step 1 covers this via the `'SOUL.md': './path with space/SOUL.md'` case (the *value* contains the space, which is also invalid because we use the key for the destination filename — but the actual broken path here is the key → ./SOUL.md is fine). Let me clarify with a more pointed test:

Replace the test in Step 1's third case with one that catches a bad KEY:

```typescript
  it('throws on a documents key with characters invalid in a Nix path literal', () => {
    expect(() => generateHermesNix({
      name: 'x',
      cloud: { provider: 'aws', profile: 'default', region: 'eu-west-3', size: 'small', disk_gb: 30 },
      network: { ssh_allowed_from: 'auto', inbound_ports: [] },
      hermes: {
        config_file: './config.yaml',
        secrets_file: './secrets.env.enc',
        documents: { 'bad name.md': './ok.md' },
        environment: {},
      },
    })).toThrow(/invalid in a Nix path literal/);
  });
```

- [ ] **Step 3: Run the test in update mode to write the snapshots**

Run: `npx vitest run -u tests/unit/nix-gen/generate.test.ts`
Expected: tests pass and `tests/fixtures/nix-snapshots/m3-minimal.hermes.nix` and `m3-full.hermes.nix` are created on disk with the new generator output.

- [ ] **Step 4: Inspect the generated snapshots**

Run: `cat tests/fixtures/nix-snapshots/m3-minimal.hermes.nix tests/fixtures/nix-snapshots/m3-full.hermes.nix`

Verify by eye:
- `m3-minimal.hermes.nix` should have `services.hermes-agent = { enable = true; configFile = ./config.yaml; environmentFiles = [ ... ]; };` and NO `documents` or `environment` blocks.
- `m3-full.hermes.nix` should have all of the above PLUS `documents = { "SOUL.md" = ./SOUL.md; "persona.md" = ./persona.md; };` and `environment = { LOG_LEVEL = "debug"; RUST_BACKTRACE = "1"; };`.

If anything looks wrong, fix `src/nix-gen/generate.ts` and re-run with `-u`.

- [ ] **Step 5: Run in normal mode**

Run: `npx vitest run tests/unit/nix-gen/generate.test.ts`
Expected: all tests PASS without `-u`.

- [ ] **Step 6: Delete the old M2 snapshots**

```bash
git rm tests/fixtures/nix-snapshots/minimal.hermes.nix tests/fixtures/nix-snapshots/full.hermes.nix
```

- [ ] **Step 7: Commit**

```bash
git add src/nix-gen/generate.ts \
        tests/unit/nix-gen/generate.test.ts \
        tests/fixtures/nix-snapshots/m3-minimal.hermes.nix \
        tests/fixtures/nix-snapshots/m3-full.hermes.nix
git commit -m "feat(nix-gen): rewrite generateHermesNix for M3 schema (configFile + documents + environment)"
```

---

### Phase D — Init command and templates

#### Task D1: Add `config-yaml` template + update existing init templates

**Files:**
- Create: `src/init-templates/config-yaml.ts`
- Modify: `src/init-templates/hermes-toml.ts`
- Modify: `src/init-templates/gitignore.ts`
- Note: `src/init-templates/soul.ts` is unchanged

- [ ] **Step 1: Create the new `config-yaml.ts` template**

```typescript
// src/init-templates/config-yaml.ts
/**
 * Starter config.yaml for `hermes-deploy init`. This is intentionally
 * minimal but valid — enough for hermes-agent to start without errors,
 * but no real platforms enabled. Users replace with their own config
 * (typically by copying from ~/.hermes/config.yaml).
 *
 * Secret references use the `${VAR}` syntax — those resolve from
 * environment variables loaded from secrets.env.enc at agent startup.
 */
export const CONFIG_YAML_TEMPLATE = `# hermes-agent runtime config.
# See https://github.com/NousResearch/hermes-agent for the full schema.
#
# Secrets: reference env vars from secrets.env.enc with \${VAR} syntax,
# e.g. \`api_key: \${ANTHROPIC_API_KEY}\`. Set them via:
#   hermes-deploy secret set ANTHROPIC_API_KEY sk-...

model:
  default: anthropic/claude-sonnet-4-5
  provider: anthropic

agent:
  max_turns: 50

terminal:
  backend: local

# Uncomment and configure platforms as needed:
#
# discord:
#   enabled: true
#   bot_token: \${DISCORD_BOT_TOKEN}
#
# mcp_servers:
#   github:
#     command: npx
#     args: ["@modelcontextprotocol/server-github"]
#     env:
#       GITHUB_TOKEN: \${GITHUB_TOKEN}
`;
```

- [ ] **Step 2: Rewrite `src/init-templates/hermes-toml.ts` for the M3 schema**

```typescript
// src/init-templates/hermes-toml.ts
export const HERMES_TOML_TEMPLATE = (name: string) => `name = "${name}"

[cloud]
provider = "aws"        # "aws" (M2/M3) or "gcp" (coming in M4)
profile  = "default"     # AWS profile name or GCP project id
region   = "eu-west-3"
size     = "large"       # "small" | "medium" | "large"
                         # IMPORTANT: the first hermes-agent build needs
                         # ~6 GB RAM. "small" (t3.small, 2 GB) will OOM-
                         # kill nix mid-build. Stay on "large" (t3.large,
                         # 8 GB) for the first deploy; downsize later
                         # once Cachix is populated.
disk_gb  = 30            # root volume size; first hermes-agent build
                         # needs at least 20 GB free

[network]
ssh_allowed_from = "auto"   # "auto" = your current public IP, or a CIDR
inbound_ports    = []        # opt in: e.g. [443] for a webhook port

[hermes]
config_file  = "./config.yaml"      # the agent's runtime config (uploaded verbatim)
secrets_file = "./secrets.env.enc"  # sops-encrypted dotenv (managed via \`secret\` subcommands)

# Optional: documents the agent reads at startup (e.g. SOUL.md). The keys
# are filenames on the box; the values are paths in this project dir.
[hermes.documents]
"SOUL.md" = "./SOUL.md"

# Optional: non-secret environment variables for the agent process.
# [hermes.environment]
# LOG_LEVEL = "info"

# Optional: faster first deploy via a Cachix binary cache. Sign up at
# cachix.org, create a cache, and paste the public key from its
# settings page. Without this set, the first deploy compiles the
# hermes-agent closure from source (~10-15 min on a t3.large).
# [hermes.cachix]
# name       = "your-cache-name"
# public_key = "your-cache-name.cachix.org-1:xxxxx"

# Optional escape hatch: a Nix file with extra services.hermes-agent.*
# settings or whole-system NixOS config. Imported by the generated
# flake.nix when present.
# nix_extra = "./hermes.extra.nix"
`;
```

- [ ] **Step 3: Update `src/init-templates/gitignore.ts`**

Replace the gitignore template's comment block to refer to the new filename:

```typescript
// src/init-templates/gitignore.ts
export const PROJECT_GITIGNORE_TEMPLATE = `# hermes-deploy generated
.hermes-deploy/
*.log

# secrets.env.enc is sops-encrypted at rest and SAFE to commit.
# .sops.yaml just records the age recipients and is ALSO safe to commit.
# Both files travel with the project so a fresh clone + key import is
# enough to redeploy. See docs/multi-machine-key-sync.md.
`;
```

- [ ] **Step 4: Verify everything compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/init-templates/config-yaml.ts src/init-templates/hermes-toml.ts src/init-templates/gitignore.ts
git commit -m "feat(init): M3 templates for hermes.toml + config.yaml + gitignore"
```

#### Task D2: Rewrite `init` command to scaffold the new file set

**Files:**
- Modify: `src/commands/init.ts`
- Modify: `tests/unit/commands/init.test.ts`

- [ ] **Step 1: Rewrite the init test**

Replace `tests/unit/commands/init.test.ts` with:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { initCommand } from '../../../src/commands/init.js';
import { HermesTomlSchema } from '../../../src/schema/hermes-toml.js';
import { parse as parseToml } from 'smol-toml';

const sopsAvailable = (() => {
  try {
    execSync('which sops', { stdio: 'ignore' });
    execSync('which age-keygen', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!sopsAvailable)('initCommand (M3)', () => {
  let dir: string;
  let configDir: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-init-m3-'));
    dir = join(root, 'project');
    configDir = join(root, 'config');
    process.env.XDG_CONFIG_HOME = configDir;
    require('node:fs').mkdirSync(dir);
    require('node:fs').mkdirSync(configDir);
  });
  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('creates the full M3 file set', async () => {
    await initCommand({ name: 'test-bot', dir });
    expect(existsSync(join(dir, 'hermes.toml'))).toBe(true);
    expect(existsSync(join(dir, 'config.yaml'))).toBe(true);
    expect(existsSync(join(dir, 'SOUL.md'))).toBe(true);
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
    expect(existsSync(join(dir, '.sops.yaml'))).toBe(true);
    expect(existsSync(join(dir, 'secrets.env.enc'))).toBe(true);
  });

  it('produces a hermes.toml that parses cleanly through the M3 schema', async () => {
    await initCommand({ name: 'parse-test', dir });
    const raw = readFileSync(join(dir, 'hermes.toml'), 'utf-8');
    const parsed = parseToml(raw);
    const result = HermesTomlSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hermes.config_file).toBe('./config.yaml');
      expect(result.data.hermes.secrets_file).toBe('./secrets.env.enc');
      expect(result.data.hermes.documents['SOUL.md']).toBe('./SOUL.md');
    }
  });

  it('refuses to overwrite an existing hermes.toml', async () => {
    await initCommand({ name: 'first', dir });
    await expect(initCommand({ name: 'second', dir })).rejects.toThrow(/already exists/);
  });

  it('does not overwrite an existing SOUL.md', async () => {
    writeFileSync(join(dir, 'SOUL.md'), '# pre-existing user content');
    await initCommand({ name: 'preserve', dir });
    expect(readFileSync(join(dir, 'SOUL.md'), 'utf-8')).toBe('# pre-existing user content');
  });

  it('does not overwrite an existing config.yaml', async () => {
    writeFileSync(join(dir, 'config.yaml'), 'model:\n  default: my-model\n');
    await initCommand({ name: 'preserve-config', dir });
    expect(readFileSync(join(dir, 'config.yaml'), 'utf-8')).toBe('model:\n  default: my-model\n');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/commands/init.test.ts`
Expected: FAIL — current init doesn't create config.yaml or secrets.env.enc.

- [ ] **Step 3: Rewrite `src/commands/init.ts`**

Replace the entire content with:

```typescript
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { HERMES_TOML_TEMPLATE } from '../init-templates/hermes-toml.js';
import { CONFIG_YAML_TEMPLATE } from '../init-templates/config-yaml.js';
import { SOUL_MD_TEMPLATE } from '../init-templates/soul.js';
import { PROJECT_GITIGNORE_TEMPLATE } from '../init-templates/gitignore.js';
import { generateAgeKeypair } from '../crypto/age-keygen.js';
import { ensureSopsBootstrap } from '../sops/bootstrap.js';
import { getStatePaths } from '../state/paths.js';

export interface InitOptions {
  /** Override the deployment name; defaults to a sanitized cwd basename. */
  name?: string;
  /** Override the target directory; defaults to process.cwd(). */
  dir?: string;
}

/**
 * Scaffold a new hermes-deploy project. Writes:
 *   - hermes.toml (M3 schema, with [hermes.documents] pointing at SOUL.md)
 *   - config.yaml (minimal starter — user replaces or copies from ~/.hermes/)
 *   - SOUL.md (starter agent personality)
 *   - .sops.yaml + secrets.env.enc (via ensureSopsBootstrap)
 *   - .gitignore (with comment about secrets.env.enc being safe to commit)
 *
 * Generates a per-deployment age keypair under ~/.config/hermes-deploy/age_keys/<name>
 * because ensureSopsBootstrap needs the public key to encrypt the secrets file.
 *
 * Refuses to overwrite an existing hermes.toml. SOUL.md, config.yaml, .sops.yaml,
 * secrets.env.enc, .gitignore are only written if absent.
 */
export async function initCommand(opts: InitOptions): Promise<void> {
  const dir = opts.dir ?? process.cwd();
  const tomlPath = join(dir, 'hermes.toml');
  if (existsSync(tomlPath)) {
    throw new Error(`hermes.toml already exists at ${tomlPath}`);
  }

  const name = opts.name ?? sanitizeName(basename(dir));

  // Generate the per-deployment age key (or reuse if already present from
  // a previous interrupted init).
  const paths = getStatePaths();
  const ageKeyPath = paths.ageKeyForDeployment(name);
  let agePublicKey: string;
  if (existsSync(ageKeyPath)) {
    // Read pub key from existing file
    const content = require('node:fs').readFileSync(ageKeyPath, 'utf-8');
    const m = content.match(/^# public key: (age1[a-z0-9]+)$/m);
    if (!m) throw new Error(`could not read age public key from ${ageKeyPath}`);
    agePublicKey = m[1]!;
  } else {
    mkdirSync(dirname(ageKeyPath), { recursive: true });
    const generated = generateAgeKeypair(ageKeyPath);
    agePublicKey = generated.publicKey;
  }

  // Bootstrap sops files (creates .sops.yaml + empty encrypted secrets.env.enc)
  ensureSopsBootstrap(dir, agePublicKey);

  // Write hermes.toml
  writeFileSync(tomlPath, HERMES_TOML_TEMPLATE(name));

  // Write config.yaml if absent
  const configYamlPath = join(dir, 'config.yaml');
  if (!existsSync(configYamlPath)) writeFileSync(configYamlPath, CONFIG_YAML_TEMPLATE);

  // Write SOUL.md if absent
  const soulPath = join(dir, 'SOUL.md');
  if (!existsSync(soulPath)) writeFileSync(soulPath, SOUL_MD_TEMPLATE);

  // Write .gitignore if absent
  const gitignorePath = join(dir, '.gitignore');
  if (!existsSync(gitignorePath)) writeFileSync(gitignorePath, PROJECT_GITIGNORE_TEMPLATE);

  console.log(`Scaffolded hermes-deploy project at ${dir}`);
  console.log('Next steps:');
  console.log('  1. edit hermes.toml (cloud, region, size)');
  console.log('  2. edit config.yaml (or copy from ~/.hermes/config.yaml)');
  console.log('  3. edit SOUL.md (agent personality)');
  console.log('  4. hermes-deploy secret set ANTHROPIC_API_KEY <your-key>');
  console.log('  5. hermes-deploy up');
}

function sanitizeName(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const trimmed = cleaned.slice(0, 63) || 'hermes-bot';
  return /^[a-z0-9]/.test(trimmed) ? trimmed : `hermes-${trimmed}`;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/commands/init.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.ts tests/unit/commands/init.test.ts
git commit -m "feat(cli): init scaffolds M3 file set (hermes.toml + config.yaml + SOUL.md + sops)"
```

---

### Phase E — Orchestrator uploads + config hash

#### Task E1: Update `uploadAndRebuild` to upload the M3 file set + hash the right files

**Files:**
- Modify: `src/orchestrator/shared.ts`
- Modify: `src/orchestrator/destroy.ts`
- Modify: `tests/unit/orchestrator/deploy.test.ts`
- Modify: `tests/unit/orchestrator/update.test.ts`

- [ ] **Step 1: Rewrite the deploy + update test fixtures**

The fakes in `deploy.test.ts` and `update.test.ts` write fake hermes.toml content with the OLD schema fields (`model`, `soul`, `secrets_file = "./secrets.enc.yaml"`, `[hermes.platforms.discord]`). Update both files to use the M3 schema.

In both files, find the inline hermes.toml content in `beforeEach`. Replace with:

```toml
name = "test"
[cloud]
provider = "aws"
profile = "default"
region = "eu-west-3"
size = "small"
[network]
ssh_allowed_from = "auto"
inbound_ports = [443]
[hermes]
config_file = "./config.yaml"
secrets_file = "./secrets.env.enc"
[hermes.documents]
"SOUL.md" = "./SOUL.md"
```

In each `beforeEach`, also write the new sibling files the orchestrator now expects:

```typescript
writeFileSync(join(projectDir, 'config.yaml'), 'model:\n  default: test\n');
writeFileSync(join(projectDir, 'secrets.env.enc'), 'sops: dummy\n');
```

(Keep the existing `SOUL.md` write — it still needs to exist for the documents upload.)

Also update any test that references `secrets.enc.yaml` to use `secrets.env.enc`.

- [ ] **Step 2: Update `src/orchestrator/destroy.ts`**

The destroy cleanup file list still references `secrets.enc.yaml`. Change:

```typescript
join(deployment.project_path, '.sops.yaml'),
join(deployment.project_path, 'secrets.enc.yaml'),
```

to:

```typescript
join(deployment.project_path, '.sops.yaml'),
join(deployment.project_path, 'secrets.env.enc'),
```

- [ ] **Step 3: Update `src/orchestrator/shared.ts`'s `uploadAndRebuild`**

Replace the body of `uploadAndRebuild` with:

```typescript
export async function uploadAndRebuild(args: BootstrapArgs): Promise<void> {
  const { session, projectDir, config, ageKeyPath, reporter } = args;
  const flakeNix = generateFlakeNix();
  const configurationNix = generateConfigurationNix(config);
  const hermesNix = generateHermesNix(config);
  const ageKeyContent = readFileSync(ageKeyPath, 'utf-8');

  // Upload the static files
  await session.uploadFile('/etc/nixos/flake.nix', flakeNix);
  await session.uploadFile('/etc/nixos/configuration.nix', configurationNix);
  await session.uploadFile('/etc/nixos/hermes.nix', hermesNix);

  // Upload the user's config.yaml verbatim
  const configYamlContent = readFileSync(pathResolve(projectDir, config.hermes.config_file));
  await session.uploadFile('/etc/nixos/config.yaml', configYamlContent);

  // Upload the encrypted secrets file
  const secretsContent = readFileSync(pathResolve(projectDir, config.hermes.secrets_file));
  await session.uploadFile('/etc/nixos/secrets.env.enc', secretsContent);

  // Upload each [hermes.documents] entry to /etc/nixos/<filename>
  for (const [filename, relPath] of Object.entries(config.hermes.documents)) {
    const docContent = readFileSync(pathResolve(projectDir, relPath));
    await session.uploadFile('/etc/nixos/' + filename, docContent);
  }

  // Upload the optional nix_extra file
  if (config.hermes.nix_extra) {
    const extraContent = readFileSync(pathResolve(projectDir, config.hermes.nix_extra));
    await session.uploadFile('/etc/nixos/hermes.extra.nix', extraContent);
  }

  // sops-nix creates /var/lib/sops-nix on activation, but we need the
  // dir to exist before SFTP can drop the age key there on the very
  // first rebuild. mkdir -p is idempotent on subsequent deploys.
  await session.exec('mkdir -p /var/lib/sops-nix');
  await session.uploadFile('/var/lib/sops-nix/age.key', ageKeyContent, 0o600);

  const rebuild = await runNixosRebuild(session, (_s, line) => reporter.log(line));
  if (!rebuild.success) {
    throw new Error(`nixos-rebuild failed:\n${rebuild.tail.join('\n')}`);
  }
}
```

- [ ] **Step 4: Update `recordConfigAndHealthcheck`'s hash file list**

Inside the same `src/orchestrator/shared.ts`, replace the `computeConfigHash([...])` call inside `recordConfigAndHealthcheck`:

OLD:
```typescript
const configHash = computeConfigHash(
  [
    tomlPath,
    pathResolve(projectDir, config.hermes.secrets_file),
    config.hermes.nix_extra ? pathResolve(projectDir, config.hermes.nix_extra.file) : '',
  ].filter(Boolean),
  true,
);
```

NEW:
```typescript
const documentPaths = Object.values(config.hermes.documents).map(p =>
  pathResolve(projectDir, p),
);
const configHash = computeConfigHash(
  [
    tomlPath,
    pathResolve(projectDir, config.hermes.config_file),
    pathResolve(projectDir, config.hermes.secrets_file),
    config.hermes.nix_extra ? pathResolve(projectDir, config.hermes.nix_extra) : '',
    ...documentPaths,
  ].filter(Boolean),
  true,
);
```

The hash now includes:
- `hermes.toml` (always)
- `config.yaml` (always — it's the user's runtime config; any change should trigger redeploy)
- `secrets.env.enc` (always — secret changes should trigger redeploy)
- `nix_extra` (if set)
- Each `[hermes.documents]` value (so SOUL.md edits trigger redeploy)

Note the schema change: `config.hermes.nix_extra` is now a flat string (not `.file`), so the path resolution drops the `.file` accessor.

- [ ] **Step 5: Run the orchestrator tests**

Run: `npx vitest run tests/unit/orchestrator/`
Expected: all PASS. Both `deploy.test.ts` and `update.test.ts` use the new schema fixtures from Step 1.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: full green. **This is the integration point — after Phase E, M3 should compile and pass the entire suite.**

If there are any holdouts (e.g. a test fixture I missed), fix them inline before committing.

- [ ] **Step 7: TypeScript + lint + build**

Run: `npx tsc --noEmit && npx eslint src tests && npm run build`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add src/orchestrator/shared.ts src/orchestrator/destroy.ts \
        tests/unit/orchestrator/deploy.test.ts tests/unit/orchestrator/update.test.ts
git commit -m "feat(orchestrator): upload config.yaml + documents + nix_extra; hash all of them"
```

---

### Phase F — Documentation

#### Task F1: Update README + getting-started + schema-reference + new migrating-from-m2

**Files:**
- Modify: `README.md`
- Modify: `docs/getting-started.md`
- Modify: `docs/schema-reference.md`
- Create: `docs/migrating-from-m2.md`

- [ ] **Step 1: Update `README.md`**

Find the status banner:
```markdown
> **Status: M2 (AWS feature-complete).** ...
```

Replace with:
```markdown
> **Status: M3 (schema redesign).** AWS-only, full lifecycle, with the
> hermes.toml schema now properly mapping to upstream's services.hermes-agent
> options. config.yaml lives next to hermes.toml and is uploaded verbatim;
> secrets are dotenv-encoded sops files. M4 brings GCP.
```

In the "Five-minute walkthrough" section, replace the workflow with:

```bash
mkdir -p ~/clients/acme/discord-bot && cd ~/clients/acme/discord-bot
hermes-deploy init                                # scaffolds hermes.toml + config.yaml + SOUL.md + secrets.env.enc
$EDITOR hermes.toml                               # set region, size
$EDITOR config.yaml                               # or copy from ~/.hermes/config.yaml
$EDITOR SOUL.md                                   # set agent personality
hermes-deploy secret set ANTHROPIC_API_KEY sk-... # add real keys
hermes-deploy up                                  # provision + boot + nixos-rebuild
hermes-deploy logs                                # stream the agent's journalctl
$EDITOR config.yaml                               # iterate
hermes-deploy update                              # ~30-90s on a warm box
hermes-deploy destroy --yes                       # tear it all down
```

In the "What's deferred to M3+" section, change the heading to "What's deferred to M4+" and remove the bullet about the hermes.toml schema redesign (which M3 just fixed). Keep the GCP, AMI pipeline, and CI bullets.

- [ ] **Step 2: Rewrite `docs/getting-started.md`**

Major rewrite — the walkthrough now includes config.yaml editing, secret set, and the explanation of how `${VAR}` substitution from secrets.env.enc into config.yaml works at agent startup. Important sections:

1. **Prerequisites checklist** — unchanged from M2
2. **Scaffold a project** — `hermes-deploy init` now produces 6 files; explain each briefly
3. **Edit hermes.toml** — same as M2 (cloud, region, size)
4. **Edit config.yaml** — NEW SECTION. Explain that this is hermes-agent's runtime config, that it can reference env vars via `${VAR}`, and that copying from `~/.hermes/config.yaml` is the obvious starting point
5. **Edit SOUL.md** — unchanged
6. **Set secrets** — NEW SECTION. Explain `hermes-deploy secret set <key> <value>`, that values are written into `secrets.env.enc` (sops dotenv), and that they reach the agent via the `${VAR}` substitution chain
7. **Deploy / iterate / tear down** — same as M2 but mention that `update` now does meaningful work (changes to config.yaml propagate; `${API_KEY}` substitution resolves the new value if you re-set the secret first)
8. **Optional Cachix section** — unchanged
9. **Multi-instance section** — unchanged
10. **Going to a different machine** — unchanged

The explicit secret-resolution chain is worth its own paragraph:

> Secrets flow from `secrets.env.enc` to the agent like this:
>
> 1. `hermes-deploy secret set ANTHROPIC_API_KEY sk-...` writes a `KEY=value` line into the encrypted dotenv file
> 2. `hermes-deploy up` (or `update`) uploads the file to `/etc/nixos/secrets.env.enc`
> 3. `nixos-rebuild` activates sops-nix, which decrypts the file to `/run/secrets/hermes-env` (chmod 0440, owner=hermes)
> 4. hermes-agent's activation script merges that file into `$HERMES_HOME/.env`
> 5. The agent starts and loads `.env` into `os.environ`
> 6. The agent loads `config.yaml` and recursively expands `${ANTHROPIC_API_KEY}` references from `os.environ`
>
> Net effect: you write `api_key: ${ANTHROPIC_API_KEY}` in your config.yaml, run `secret set ANTHROPIC_API_KEY sk-...`, and the next deploy gives the agent the real key without ever putting it in plaintext on disk.

- [ ] **Step 3: Rewrite `docs/schema-reference.md`**

Replace the entire schema-reference doc with a version that documents the M3 schema. Use the same table-per-section structure as the M2 version. The big changes:

- `[hermes]` section now has `config_file`, `secrets_file`, `nix_extra` (optional, flat string), and is much shorter
- Add a `[hermes.documents]` section table documenting the attrset shape
- Add a `[hermes.environment]` section table  
- Drop entirely: the `(M3)` notes that flagged "parser-accepted but generator-ignored" — those fields are gone
- Drop the `[[hermes.mcp_servers]]` and `[hermes.platforms.*]` sections — they don't exist in M3
- Keep `[hermes.cachix]` exactly as M2 had it

The full new content of `docs/schema-reference.md`:

```markdown
# `hermes.toml` schema reference

Every field accepted by `hermes-deploy`'s parser. Every field reaches the running agent — there are no more "parser-accepted but generator-ignored" fields after the M3 redesign.

## Top level

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Deployment name. Lowercase alphanumeric with hyphens, 1-63 chars. Must match `^[a-z0-9][a-z0-9-]*$`. |

## `[cloud]`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `provider` | `"aws"` \| `"gcp"` | yes | — | Cloud provider. M3 supports `aws` only; `gcp` lands in M4. |
| `profile` | string | yes | — | AWS profile name (when `provider=aws`) or GCP project ID. |
| `region` | string | yes | — | Cloud region. Must be one with NixOS community AMIs. |
| `zone` | string | required when `provider=gcp` | — | GCP zone within the region. |
| `size` | `"small"` \| `"medium"` \| `"large"` | yes | — | Instance size. `large` (t3.large, 8 GB RAM) recommended for first deploys. |
| `disk_gb` | int | no | `30` | Root volume size in GB. Min 8, max 500. |

## `[network]`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `ssh_allowed_from` | string | no | `"auto"` | CIDR allowed to SSH on port 22. `"auto"` resolves your machine's current public IP. |
| `inbound_ports` | int[] | no | `[]` | Additional inbound TCP ports to open from `0.0.0.0/0`. |

## `[hermes]`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `config_file` | string (relative path) | yes | — | Path to the user's hermes config.yaml. Uploaded verbatim to the box and pointed at by `services.hermes-agent.configFile`. |
| `secrets_file` | string (relative path) | yes | — | Path to the sops-encrypted dotenv file. Decrypted at activation by sops-nix and merged into `$HERMES_HOME/.env`. |
| `nix_extra` | string (relative path) | no | — | Optional Nix file with extra `services.hermes-agent.*` settings or whole-system config. Imported by the generated flake.nix when present. |

## `[hermes.documents]`

Attrset of `<filename-on-box>` → `<relative-path-in-project-dir>`. Each entry is uploaded to `/etc/nixos/<filename>` and exposed via `services.hermes-agent.documents = { ... }`. The agent's activation script copies them into `$HERMES_HOME/documents/`.

```toml
[hermes.documents]
"SOUL.md" = "./SOUL.md"
"persona.md" = "./behaviors/persona-v3.md"
```

The key is the destination filename on the box; the value is where to find the source file in the project directory. The default is `{}` (no documents).

## `[hermes.environment]`

Attrset of `KEY` → `string`. Non-secret environment variables for the agent process. Maps directly to `services.hermes-agent.environment`. Use this for things like `LOG_LEVEL=debug` or `RUST_BACKTRACE=1` — anything you want to flip without re-encrypting the secrets file.

```toml
[hermes.environment]
LOG_LEVEL = "debug"
RUST_BACKTRACE = "1"
```

The default is `{}`.

## `[hermes.cachix]` (optional)

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | yes | — | Cachix cache name (the part before `.cachix.org`). |
| `public_key` | string | yes | — | Cache public key in `<name>.cachix.org-1:<base64>` form. |

When set, the box adds the cache as a Nix substituter so `nixos-rebuild` substitutes the hermes-agent closure from cache instead of compiling it from source.

## Validation

`hermes-deploy` validates the entire file before any cloud calls happen. Missing required fields produce errors like `hermes.config_file: Required` pointing at the exact path. Invalid enum values, missing GCP zones, malformed cachix keys, and Nix-incompatible characters in document filenames are all caught at toml-load time.
```

- [ ] **Step 4: Create `docs/migrating-from-m2.md`**

```markdown
# Migrating from M1/M2 to M3

The M3 schema redesign is a breaking change. Pre-production project — there's no automatic migration tool because the user count for v1 is one (Paul, with smoke-test deployments). The procedure below takes ~5 minutes per project.

## What changed

- `hermes.toml` schema rewritten:
  - Dropped: `[hermes].model`, `[hermes].soul`, `[hermes.platforms.discord]`, `[hermes.platforms.telegram]`, `[[hermes.mcp_servers]]`
  - Added: `[hermes].config_file`, `[hermes].secrets_file` (renamed from M1/M2), `[hermes.documents]`, `[hermes.environment]`
  - Renamed: `[hermes.nix_extra].file` → flat `nix_extra` string
- Secrets file: `secrets.enc.yaml` → `secrets.env.enc` (now sops-encrypted dotenv format instead of YAML)
- New file required: `config.yaml` next to `hermes.toml` (the user's hermes-agent runtime config)
- State file `schema_version` bumped from `1` to `2`. Existing v1 state files are auto-migrated by the runner — no action needed.

## Migration procedure

Per project:

1. **Tear down the existing deployment.**

   ```bash
   cd ~/clients/acme/discord-bot     # or wherever the project lives
   hermes-deploy destroy <name> --yes
   ```

2. **Remove the old M1/M2 user files.**

   ```bash
   rm -f hermes.toml secrets.enc.yaml .sops.yaml SOUL.md
   ```

   Keep any `*.md` files you don't want hermes-deploy to manage. Remove `SOUL.md` if you want `init` to scaffold a new starter version (you can keep your old content if you copy it back in after init).

3. **Re-init.**

   ```bash
   hermes-deploy init
   ```

   This produces the new file set: `hermes.toml`, `config.yaml`, `SOUL.md`, `.sops.yaml`, `secrets.env.enc`, `.gitignore`.

4. **Provide a config.yaml.** Either:

   - Copy from your local hermes install: `cp ~/.hermes/config.yaml ./config.yaml`
   - Edit the starter template that `init` generated

   The config.yaml is hermes-agent's runtime config. It controls model selection, agent behavior, terminal/browser/messaging integrations, MCP servers, etc. Inside it, you reference secrets via `${ENV_VAR}` syntax — e.g. `model.api_key: ${ANTHROPIC_API_KEY}`.

5. **Re-add secrets.**

   ```bash
   hermes-deploy secret set ANTHROPIC_API_KEY sk-...
   hermes-deploy secret set DISCORD_BOT_TOKEN MTI...
   # repeat for every secret your config.yaml references
   ```

6. **Deploy.**

   ```bash
   hermes-deploy up
   ```

After the first successful `up`, the workflow is the same as M2: edit `config.yaml` or `hermes.toml`, run `hermes-deploy update`, watch the changes propagate.

## What I shouldn't do

- Don't try to keep the old `secrets.enc.yaml` — it's YAML, M3 expects dotenv. Re-create from scratch with `secret set`.
- Don't manually edit `~/.config/hermes-deploy/state.toml`. The state migration runner handles the v1 → v2 bump automatically.
- Don't put secrets directly in `config.yaml` (defeats the point of the sops pipeline). Use `${VAR}` references and `secret set`.
- Don't put SOUL.md content into nix_extra — use `[hermes.documents]` instead. nix_extra is the escape hatch for things the schema can't express, not for files the schema already has fields for.
```

- [ ] **Step 5: Verify all docs files are well-formed**

Run: `git diff README.md docs/`
Visually verify the new content is in place. No automated check.

- [ ] **Step 6: Run the full suite one more time**

Run: `npx vitest run && npx tsc --noEmit && npx eslint src tests && npm run build`
Expected: full green.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/getting-started.md docs/schema-reference.md docs/migrating-from-m2.md
git commit -m "docs: M3 README + getting-started + schema-reference + migration guide"
```

---

## Self-Review

After all 11 tasks complete, run this checklist:

### Spec coverage

| Spec section | Implementing tasks |
|---|---|
| Goal & motivation | (no task — context only) |
| Core architectural decision | A1 (schema), C1+C2+C3 (templates+generator), E1 (uploads) |
| New `hermes.toml` shape | A1 |
| Field-by-field table | A1, F1 (schema-reference doc) |
| Generated files on the box layout | E1 (uploads) |
| `hermes.nix` example | C3 (generator + snapshot) |
| `configuration.nix` change | C1 |
| `flake.nix` change | C2 |
| Secrets pipeline end-to-end | B1 (bootstrap), B2 (commands), C1 (sops block), E1 (upload), F1 (docs) |
| Documents pipeline | A1 (schema), C3 (generator), E1 (upload), F1 (docs) |
| Init command | D1 (templates), D2 (command) |
| State migration v1 → v2 | A2 |
| User-file migration (manual) | F1 (migrating-from-m2.md) |
| File structure changes | (covered by every task in its Files block) |
| Tests | (every implementation task includes its test) |
| Out of scope | (no tasks — explicitly deferred) |
| Risks | (mitigated as part of corresponding tasks) |
| Success criteria | (smoke-test phase, post-implementation) |

No spec items are unimplemented. Every section has a corresponding task or is intentionally context-only.

### Placeholder scan

Search the plan for: TBD, TODO, FIXME, "fill in", "similar to", "appropriate", "handle edge cases". None should appear in task bodies.

### Type consistency

- `HermesTomlConfig` is the type returned by `loadHermesToml` (unchanged from M2). Updated by A1, consumed by C3 (generator), D2 (init), E1 (orchestrator).
- `HermesSchema` fields: `config_file`, `secrets_file`, `nix_extra`, `documents`, `environment`, `cachix`. All consistent across A1, C3, D2, E1.
- `documents` is `Record<string, string>` everywhere. Iteration via `Object.entries(config.hermes.documents)` in both C3 (generator) and E1 (upload + hash).
- `environment` is `Record<string, string>` everywhere.
- `nix_extra` is a flat optional string everywhere (NOT `{file: string}`).
- `secrets.env.enc` is the filename string in B1 (bootstrap), B2 (commands), C1 (template), C3 (test fixtures), E1 (upload), F1 (docs).
- `hermes-env` is the sops secret name in C1 (template), C3 (generator's `environmentFiles` reference), nowhere else needs it.
- `CURRENT_SCHEMA_VERSION = 2` everywhere it's referenced after A2 lands.

No drift detected.

### Missing tasks audit

After self-review, no spec requirement listed in the M3 scope is unimplemented.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-04-09-hermes-deploy-M3-schema-redesign.md`. Two execution options:

**1. Subagent-driven** (recommended) — fresh subagent per task, two-stage review (spec then quality) between tasks, fast iteration. Same mode that shipped M1 and M2 cleanly.

**2. Inline execution** — execute tasks in this session with batch checkpoints for review.

Which approach?
