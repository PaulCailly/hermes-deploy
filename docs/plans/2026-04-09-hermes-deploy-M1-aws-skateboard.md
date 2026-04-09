# hermes-deploy M1 — AWS Skateboard Implementation Plan

> **For agentic workers:** Use the `subagent-driven-development` skill (recommended) or the `executing-plans` skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the smallest end-to-end version of `hermes-deploy` that can provision a hermes-agent instance on AWS, configure it from a hand-written `hermes.toml`, and tear it down — with no Ink UI, no GCP, no `update`, and no multi-instance management. Plain text output. AWS only. Single deployment per project directory.

**Architecture:** Five layers (commands → orchestrator → cloud abstraction → state/schema/nix-gen → remote-ops), per the v1 spec at `docs/specs/2026-04-09-hermes-deploy-design.md`. M1 implements every layer at the minimum surface needed for one happy path (`up`) and its inverse (`destroy`), plus `status` and `ssh` for diagnostics.

**Tech Stack:** TypeScript (strict), Node 20+, Vitest, Zod, smol-toml, proper-lockfile, @aws-sdk/client-ec2, ssh2, commander, tsup. Shell-out to `age-keygen`, `sops`, `ssh`. Tests use `aws-sdk-client-mock` for SDK calls and stub `ssh2` at the session boundary.

---

## M1 Scope

### In M1

| Capability | Notes |
|---|---|
| `hermes-deploy up` | Phases 1-5 from spec §8.1 against AWS only |
| `hermes-deploy destroy` | Idempotent, reads ledger from state |
| `hermes-deploy status` | Read-only DescribeInstances + state lookup |
| `hermes-deploy ssh` | Exec `ssh -i <key>` subprocess |
| Hand-written `hermes.toml` | No `init` command |
| Auto-generate per-deployment SSH keypair | ed25519 via `node:crypto` |
| Auto-generate per-deployment age keypair | shell out to `age-keygen` |
| Auto-create `.sops.yaml` and empty `secrets.enc.yaml` if missing | on first `up` |
| Per-project state, stored in global state file | `~/.config/hermes-deploy/state.toml` (one entry per project for now) |
| Single AWS provider | community NixOS AMI via `DescribeImages` |
| sops-nix on the box | secrets decrypted at activation, exposed at `/run/secrets/<key>` |
| Plain text output | `console.log` lines, no Ink, no spinners |

### Deferred to M2 or later

- `init`, `update`, `logs`, `ls` commands
- `secret set/get/rm/edit` subcommands (user shells to `sops` directly)
- `key import/export` subcommands (user copies the file)
- `--name` flag for cross-directory lookup (M1 always walks up from cwd)
- `--watch` dashboard view
- Multi-instance global state (state file shape supports it; M1 just doesn't add multiple)
- Schema migrations engine (M1 hardcodes `schema_version = 1`; mismatch = hard error)
- Network rule reconciliation (M1 has no `update`, so SG rules are write-once at `provision`)
- Ink UI
- GCP provider
- E2E test suite, GitHub Actions CI, release tooling
- Custom VPC, SSM/IAP SSH, Packer images, cloud secret managers — *all permanently out of scope per spec §13*

### What M1 proves

After M1 ships, you can hand-write a `hermes.toml` for one of your AWS clients, run `hermes-deploy up`, and have a real running hermes-agent talking to Discord/Telegram via the box. You can `hermes-deploy ssh` to inspect it. You can `hermes-deploy destroy` to tear it all down. Then you start M2 with a validated foundation.

---

## File Structure

Every file created in M1 listed once here. Each task references this layout.

```
hermes-deploy/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── eslint.config.js
├── .gitignore
├── README.md
├── src/
│   ├── cli.ts                        # bin entry (#!/usr/bin/env node)
│   ├── commands/
│   │   ├── up.ts                     # `hermes-deploy up` handler
│   │   ├── destroy.ts                # `hermes-deploy destroy` handler
│   │   ├── status.ts                 # `hermes-deploy status` handler
│   │   └── ssh.ts                    # `hermes-deploy ssh` handler
│   ├── orchestrator/
│   │   ├── deploy.ts                 # `up` flow phases 1-5
│   │   ├── destroy.ts                # `destroy` flow
│   │   └── reporter.ts               # plain-text progress reporter (M1's "UI")
│   ├── schema/
│   │   ├── hermes-toml.ts            # zod schema for hermes.toml
│   │   ├── state-toml.ts             # zod schema for state.toml
│   │   └── load.ts                   # TOML file → validated typed object
│   ├── state/
│   │   ├── paths.ts                  # ~/.config/hermes-deploy/* path resolution
│   │   ├── store.ts                  # state.toml read/write/lock/backup
│   │   └── hash.ts                   # config hash helper
│   ├── nix-gen/
│   │   ├── templates.ts              # template strings for configuration.nix + hermes.nix
│   │   └── generate.ts               # toml → string content
│   ├── crypto/
│   │   ├── ssh-keygen.ts             # ed25519 SSH keypair generation
│   │   └── age-keygen.ts             # `age-keygen` shell-out wrapper
│   ├── sops/
│   │   └── bootstrap.ts              # create .sops.yaml + empty secrets.enc.yaml
│   ├── cloud/
│   │   ├── core.ts                   # CloudProvider interface, ResourceLedger, errors
│   │   └── aws/
│   │       ├── provider.ts           # AWSProvider class implementing CloudProvider
│   │       ├── images.ts             # NixOS AMI lookup + cache
│   │       ├── provision.ts          # provision() sequence + rollback
│   │       ├── destroy.ts            # destroy() sequence
│   │       ├── status.ts             # status() impl
│   │       └── public-ip.ts          # detect deployer's public IP for SSH allow rule
│   ├── remote-ops/
│   │   ├── wait-ssh.ts               # TCP poll for port 22
│   │   ├── session.ts                # ssh2 session wrapper (connect, exec, dispose)
│   │   ├── scp.ts                    # file upload via session
│   │   ├── nixos-rebuild.ts          # run nixos-rebuild over SSH, stream output
│   │   └── healthcheck.ts            # systemctl is-active poll
│   └── errors/
│       └── index.ts                  # typed error classes used across layers
└── tests/
    ├── unit/
    │   ├── schema/
    │   │   ├── hermes-toml.test.ts
    │   │   └── state-toml.test.ts
    │   ├── state/
    │   │   ├── paths.test.ts
    │   │   ├── store.test.ts
    │   │   └── hash.test.ts
    │   ├── nix-gen/
    │   │   └── generate.test.ts
    │   ├── crypto/
    │   │   ├── ssh-keygen.test.ts
    │   │   └── age-keygen.test.ts
    │   ├── sops/
    │   │   └── bootstrap.test.ts
    │   ├── cloud/aws/
    │   │   ├── images.test.ts
    │   │   ├── provision.test.ts
    │   │   ├── destroy.test.ts
    │   │   └── status.test.ts
    │   └── remote-ops/
    │       ├── wait-ssh.test.ts
    │       ├── session.test.ts
    │       └── nixos-rebuild.test.ts
    └── fixtures/
        ├── hermes-toml/
        │   ├── minimal.toml
        │   ├── full.toml
        │   └── invalid.toml
        └── nix-snapshots/
            ├── minimal.hermes.nix
            └── full.hermes.nix
```

ESLint rule from day 1: `no-restricted-imports` blocks `src/orchestrator/**`, `src/commands/**`, `src/remote-ops/**`, `src/state/**` from importing `src/cloud/aws/**` directly. Only `src/cloud/core.ts` exports the AWSProvider type and a factory. This enforces the abstraction even with one provider.

---

## Tech Decisions Locked In For M1

| Concern | Choice | Why |
|---|---|---|
| TOML parser | `smol-toml` | Modern, fast, supports stringify; maintained |
| Schema validation | `zod` | Industry standard for TS, great DX, narrows types |
| File locking | `proper-lockfile` | Mature, used by npm itself, advisory locking that works on macOS+Linux |
| AWS SDK | `@aws-sdk/client-ec2` v3 | Modular, supports tree-shaking |
| SSH client | `ssh2` | The spec specifies it; mature; supports streaming |
| CLI argv | `commander` | Mature, idiomatic for Node CLIs, plays well with TS |
| Bundler | `tsup` | Single config, ESM+CJS, dts, fast |
| Test runner | `vitest` | Native TS, fast, jest-compatible API |
| AWS mocking | `aws-sdk-client-mock` | The de facto v3 mocking library |
| Crypto | `node:crypto` built-in | ed25519 supported via `generateKeyPairSync` |

External binaries shelled-out to (must be present on the operator's machine; documented in README):

- `age-keygen` — for age keypair generation
- `sops` — only invoked during M1 by the user (no CLI subcommand yet); listed as a prereq
- `ssh` — for the `hermes-deploy ssh` command (M1 execs the system `ssh` binary)
- `aws` — *not required*; we use the SDK directly. But the user must have credentials configured (`~/.aws/credentials` or `AWS_*` env vars).

---

## Tasks

### Phase A — Project setup

#### Task A1: Initialize the npm package

**Files:**
- Create: `hermes-deploy/package.json`
- Create: `hermes-deploy/.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@hermes-deploy/cli",
  "version": "0.1.0-m1",
  "description": "Deploy Nous Research's hermes-agent to AWS and GCP",
  "type": "module",
  "bin": {
    "hermes-deploy": "./dist/cli.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src tests",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@aws-sdk/client-ec2": "^3.600.0",
    "commander": "^12.1.0",
    "proper-lockfile": "^4.1.2",
    "smol-toml": "^1.3.0",
    "ssh2": "^1.15.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/proper-lockfile": "^4.1.4",
    "@types/ssh2": "^1.15.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "aws-sdk-client-mock": "^4.0.0",
    "eslint": "^9.0.0",
    "tsup": "^8.2.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
dist/
coverage/
.DS_Store
*.log
.env
.env.local
```

- [ ] **Step 3: Install dependencies**

Run: `cd hermes-deploy && npm install`
Expected: dependencies installed, `node_modules/` and `package-lock.json` created.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: initialize npm package and dependencies"
```

#### Task A2: Configure TypeScript, Vitest, tsup, ESLint

**Files:**
- Create: `hermes-deploy/tsconfig.json`
- Create: `hermes-deploy/tsup.config.ts`
- Create: `hermes-deploy/vitest.config.ts`
- Create: `hermes-deploy/eslint.config.js`

- [ ] **Step 1: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "declaration": false,
    "outDir": "./dist",
    "rootDir": "./",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "tests/**/*", "tsup.config.ts", "vitest.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 2: Create `tsup.config.ts`**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: false,
  banner: { js: '#!/usr/bin/env node' },
});
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
```

- [ ] **Step 4: Create `eslint.config.js`** (flat config)

```javascript
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/cloud/aws/**', '**/cloud/gcp/**'],
            message: 'Import from src/cloud/core.ts only — provider internals are private.',
          },
        ],
      }],
    },
  },
  {
    files: ['src/cloud/aws/**/*.ts', 'src/cloud/gcp/**/*.ts', 'tests/**/cloud/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
```

- [ ] **Step 5: Verify configs work**

Run: `npx tsc --noEmit`
Expected: no errors (no source files yet).

Run: `npx vitest run --passWithNoTests`
Expected: "No test files found, exiting with code 0" — exit 0. (The `--passWithNoTests` flag is needed because vitest exits non-zero by default when there are no tests.)

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json tsup.config.ts vitest.config.ts eslint.config.js
git commit -m "chore: configure typescript, vitest, tsup, and eslint"
```

#### Task A3: Create directory skeleton

**Files:**
- Create: empty directories per the file structure layout above, with `.gitkeep` placeholders so git tracks them.

- [ ] **Step 1: Create directory tree**

Run:
```bash
cd hermes-deploy
mkdir -p src/{commands,orchestrator,schema,state,nix-gen,crypto,sops,cloud/aws,remote-ops,errors}
mkdir -p tests/unit/{schema,state,nix-gen,crypto,sops,cloud/aws,remote-ops}
mkdir -p tests/fixtures/{hermes-toml,nix-snapshots}
```

- [ ] **Step 2: Add `.gitkeep` files**

Run:
```bash
find src tests -type d -empty -exec touch {}/.gitkeep \;
```

- [ ] **Step 3: Verify tree**

Run: `find src tests -type d`
Expected: every directory listed in the file structure section above.

- [ ] **Step 4: Commit**

```bash
git add src tests
git commit -m "chore: scaffold directory structure"
```

---

### Phase B — Schema layer

#### Task B1: Zod schema for `hermes.toml` (cloud + network + hermes core)

**Files:**
- Create: `src/schema/hermes-toml.ts`
- Create: `tests/unit/schema/hermes-toml.test.ts`
- Create: `tests/fixtures/hermes-toml/minimal.toml`
- Create: `tests/fixtures/hermes-toml/full.toml`
- Create: `tests/fixtures/hermes-toml/invalid.toml`

- [ ] **Step 1: Write fixture `minimal.toml`**

```toml
name = "test-minimal"

[cloud]
provider = "aws"
profile = "default"
region = "eu-west-3"
size = "small"

[hermes]
model = "anthropic/claude-sonnet-4-5"
soul = "./SOUL.md"
secrets_file = "./secrets.enc.yaml"

[hermes.platforms.discord]
enabled = true
token_key = "discord_bot_token"
```

- [ ] **Step 2: Write fixture `full.toml`**

```toml
name = "test-full"

[cloud]
provider = "aws"
profile = "acme"
region = "eu-west-3"
size = "medium"

[network]
ssh_allowed_from = "auto"
inbound_ports = [443]

[hermes]
model = "anthropic/claude-sonnet-4-5"
soul = "./SOUL.md"
secrets_file = "./secrets.enc.yaml"

[hermes.platforms.discord]
enabled = true
token_key = "discord_bot_token"

[hermes.platforms.telegram]
enabled = false

[[hermes.mcp_servers]]
name = "github"
command = "npx"
args = ["@modelcontextprotocol/server-github"]
env_keys = ["github_token"]

[hermes.nix_extra]
file = "./configuration.nix.extra"
```

- [ ] **Step 3: Write fixture `invalid.toml`** (missing required field, bad enum)

```toml
name = "test-invalid"

[cloud]
provider = "azure"
region = "eu-west-3"
size = "huge"

[hermes]
model = "anthropic/claude-sonnet-4-5"
```

- [ ] **Step 4: Write the failing test `tests/unit/schema/hermes-toml.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { HermesTomlSchema } from '../../../src/schema/hermes-toml.js';

const fixturesDir = join(__dirname, '../../fixtures/hermes-toml');
const loadFixture = (name: string) =>
  parseToml(readFileSync(join(fixturesDir, name), 'utf-8'));

describe('HermesTomlSchema', () => {
  it('accepts a minimal valid config', () => {
    const raw = loadFixture('minimal.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('test-minimal');
      expect(result.data.cloud.provider).toBe('aws');
      expect(result.data.cloud.size).toBe('small');
      expect(result.data.network.ssh_allowed_from).toBe('auto'); // default
      expect(result.data.network.inbound_ports).toEqual([]); // default
    }
  });

  it('accepts a full config with telegram, mcp servers, and nix_extra', () => {
    const raw = loadFixture('full.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.network.inbound_ports).toEqual([443]);
      expect(result.data.hermes.mcp_servers).toHaveLength(1);
      expect(result.data.hermes.mcp_servers[0]?.name).toBe('github');
      expect(result.data.hermes.nix_extra?.file).toBe('./configuration.nix.extra');
    }
  });

  it('rejects an invalid config', () => {
    const raw = loadFixture('invalid.toml');
    const result = HermesTomlSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map(i => i.path.join('.'));
      expect(issues).toContain('cloud.provider');
      expect(issues).toContain('cloud.size');
    }
  });

  it('requires gcp configs to specify zone', () => {
    const result = HermesTomlSchema.safeParse({
      name: 'gcp-no-zone',
      cloud: { provider: 'gcp', profile: 'p', region: 'europe-west1', size: 'small' },
      hermes: {
        model: 'm',
        soul: './SOUL.md',
        secrets_file: './secrets.enc.yaml',
        platforms: { discord: { enabled: true, token_key: 'k' } },
      },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run tests/unit/schema/hermes-toml.test.ts`
Expected: FAIL — `HermesTomlSchema` is not exported from `src/schema/hermes-toml.ts`.

- [ ] **Step 6: Implement `src/schema/hermes-toml.ts`**

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
  })
  .refine(c => c.provider !== 'gcp' || !!c.zone, {
    message: 'cloud.zone is required when cloud.provider = "gcp"',
    path: ['zone'],
  });

const NetworkSchema = z.object({
  ssh_allowed_from: z.string().min(1).default('auto'),
  inbound_ports: z.array(z.number().int().min(1).max(65535)).default([]),
});

const PlatformDiscordSchema = z.object({
  enabled: z.boolean(),
  token_key: z.string().min(1).optional(),
});

const PlatformTelegramSchema = z.object({
  enabled: z.boolean(),
  token_key: z.string().min(1).optional(),
});

const McpServerSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env_keys: z.array(z.string()).default([]),
});

const NixExtraSchema = z.object({
  file: z.string().min(1),
});

const HermesSchema = z.object({
  model: z.string().min(1),
  soul: z.string().min(1),
  secrets_file: z.string().min(1),
  platforms: z.object({
    discord: PlatformDiscordSchema.optional(),
    telegram: PlatformTelegramSchema.optional(),
  }),
  mcp_servers: z.array(McpServerSchema).default([]),
  nix_extra: NixExtraSchema.optional(),
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
Expected: all 4 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/schema/hermes-toml.ts tests/unit/schema/hermes-toml.test.ts tests/fixtures/hermes-toml/
git commit -m "feat(schema): add zod schema for hermes.toml with full validation"
```

#### Task B2: Zod schema for `state.toml`

**Files:**
- Create: `src/schema/state-toml.ts`
- Create: `tests/unit/schema/state-toml.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { StateTomlSchema, type StateToml } from '../../../src/schema/state-toml.js';

describe('StateTomlSchema', () => {
  it('accepts an empty state', () => {
    const result = StateTomlSchema.safeParse({ schema_version: 1, deployments: {} });
    expect(result.success).toBe(true);
  });

  it('accepts a state with one AWS deployment', () => {
    const state: StateToml = {
      schema_version: 1,
      deployments: {
        'acme-discord-bot': {
          project_path: '/Users/paul/clients/acme/discord-bot',
          cloud: 'aws',
          region: 'eu-west-3',
          created_at: '2026-04-09T14:23:11Z',
          last_deployed_at: '2026-04-09T14:31:42Z',
          last_config_hash: 'sha256:abc123',
          ssh_key_path: '/Users/paul/.config/hermes-deploy/ssh_keys/acme-discord-bot',
          age_key_path: '/Users/paul/.config/hermes-deploy/age_keys/acme-discord-bot',
          health: 'healthy',
          instance_ip: '203.0.113.42',
          cloud_resources: {
            instance_id: 'i-0abc',
            security_group_id: 'sg-0def',
            key_pair_name: 'hermes-deploy-acme-discord-bot',
            eip_allocation_id: 'eipalloc-0ghi',
            region: 'eu-west-3',
          },
        },
      },
    };
    const result = StateTomlSchema.safeParse(state);
    expect(result.success).toBe(true);
  });

  it('rejects unknown schema_version', () => {
    const result = StateTomlSchema.safeParse({ schema_version: 99, deployments: {} });
    expect(result.success).toBe(false);
  });

  it('rejects deployment without required cloud_resources fields', () => {
    const result = StateTomlSchema.safeParse({
      schema_version: 1,
      deployments: {
        bad: {
          project_path: '/x',
          cloud: 'aws',
          region: 'eu-west-3',
          created_at: '2026-04-09T14:23:11Z',
          last_deployed_at: '2026-04-09T14:31:42Z',
          last_config_hash: 'sha256:abc',
          ssh_key_path: '/x',
          age_key_path: '/x',
          health: 'unknown',
          instance_ip: '0.0.0.0',
          cloud_resources: { instance_id: 'i-0abc' }, // missing the rest
        },
      },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/schema/state-toml.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/schema/state-toml.ts`**

```typescript
import { z } from 'zod';

const HealthSchema = z.enum(['healthy', 'unhealthy', 'unknown']);

const AwsResourcesSchema = z.object({
  instance_id: z.string().min(1),
  security_group_id: z.string().min(1),
  key_pair_name: z.string().min(1),
  eip_allocation_id: z.string().min(1),
  region: z.string().min(1),
});

const GcpResourcesSchema = z.object({
  instance_name: z.string().min(1),
  firewall_rule_name: z.string().min(1),
  project_id: z.string().min(1),
  zone: z.string().min(1),
  external_ip: z.string().min(1),
});

const DeploymentSchema = z.object({
  project_path: z.string().min(1),
  cloud: z.enum(['aws', 'gcp']),
  region: z.string().min(1),
  created_at: z.string().datetime(),
  last_deployed_at: z.string().datetime(),
  last_config_hash: z.string().min(1),
  ssh_key_path: z.string().min(1),
  age_key_path: z.string().min(1),
  health: HealthSchema,
  instance_ip: z.string().min(1),
  cloud_resources: z.union([AwsResourcesSchema, GcpResourcesSchema]),
});

export const StateTomlSchema = z.object({
  schema_version: z.literal(1),
  deployments: z.record(z.string(), DeploymentSchema),
});

export type StateToml = z.infer<typeof StateTomlSchema>;
export type Deployment = z.infer<typeof DeploymentSchema>;
export type AwsResources = z.infer<typeof AwsResourcesSchema>;
export type GcpResources = z.infer<typeof GcpResourcesSchema>;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/schema/state-toml.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/state-toml.ts tests/unit/schema/state-toml.test.ts
git commit -m "feat(schema): add zod schema for state.toml"
```

#### Task B3: TOML loader

**Files:**
- Create: `src/schema/load.ts`
- Create: `tests/unit/schema/load.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHermesToml, HermesTomlError } from '../../../src/schema/load.js';

describe('loadHermesToml', () => {
  it('loads and validates a valid file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-load-'));
    const path = join(dir, 'hermes.toml');
    writeFileSync(path, `
name = "ok"
[cloud]
provider = "aws"
profile = "default"
region = "eu-west-3"
size = "small"
[hermes]
model = "m"
soul = "./SOUL.md"
secrets_file = "./secrets.enc.yaml"
[hermes.platforms.discord]
enabled = true
token_key = "k"
`);
    const config = loadHermesToml(path);
    expect(config.name).toBe('ok');
    rmSync(dir, { recursive: true });
  });

  it('throws HermesTomlError on syntactically invalid TOML', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-load-'));
    const path = join(dir, 'hermes.toml');
    writeFileSync(path, 'this is = = not toml');
    expect(() => loadHermesToml(path)).toThrow(HermesTomlError);
    rmSync(dir, { recursive: true });
  });

  it('throws HermesTomlError with field path on schema violation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-load-'));
    const path = join(dir, 'hermes.toml');
    writeFileSync(path, `
name = "x"
[cloud]
provider = "azure"
profile = "p"
region = "r"
size = "small"
[hermes]
model = "m"
soul = "s"
secrets_file = "se"
[hermes.platforms.discord]
enabled = true
`);
    try {
      loadHermesToml(path);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HermesTomlError);
      expect((e as HermesTomlError).message).toContain('cloud.provider');
    }
    rmSync(dir, { recursive: true });
  });

  it('throws clear error on missing file', () => {
    expect(() => loadHermesToml('/no/such/file.toml')).toThrow(HermesTomlError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/schema/load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/schema/load.ts`**

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { parse as parseToml } from 'smol-toml';
import { HermesTomlSchema, type HermesTomlConfig } from './hermes-toml.js';

export class HermesTomlError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = 'HermesTomlError';
  }
}

export function loadHermesToml(path: string): HermesTomlConfig {
  if (!existsSync(path)) {
    throw new HermesTomlError(`hermes.toml not found at ${path}`, path);
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (e) {
    throw new HermesTomlError(`failed to read ${path}: ${(e as Error).message}`, path);
  }

  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch (e) {
    throw new HermesTomlError(`invalid TOML in ${path}: ${(e as Error).message}`, path);
  }

  const result = HermesTomlSchema.safeParse(parsed);
  if (!result.success) {
    const lines = result.error.issues.map(
      i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new HermesTomlError(
      `validation failed for ${path}:\n${lines.join('\n')}`,
      path,
    );
  }

  return result.data;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/schema/load.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/load.ts tests/unit/schema/load.test.ts
git commit -m "feat(schema): add TOML loader with validation and typed errors"
```

---

### Phase C — State layer

#### Task C1: Path helpers

**Files:**
- Create: `src/state/paths.ts`
- Create: `tests/unit/state/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getStatePaths } from '../../../src/state/paths.js';

describe('getStatePaths', () => {
  const ORIG_XDG = process.env.XDG_CONFIG_HOME;
  afterEach(() => {
    if (ORIG_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = ORIG_XDG;
  });

  it('uses ~/.config/hermes-deploy when XDG_CONFIG_HOME is unset', () => {
    delete process.env.XDG_CONFIG_HOME;
    const p = getStatePaths();
    expect(p.configDir).toBe(join(homedir(), '.config', 'hermes-deploy'));
    expect(p.stateFile).toBe(join(p.configDir, 'state.toml'));
    expect(p.lockFile).toBe(join(p.configDir, 'state.toml.lock'));
    expect(p.sshKeysDir).toBe(join(p.configDir, 'ssh_keys'));
    expect(p.ageKeysDir).toBe(join(p.configDir, 'age_keys'));
    expect(p.imageCacheFile).toBe(join(homedir(), '.cache', 'hermes-deploy', 'images.json'));
  });

  it('honors XDG_CONFIG_HOME when set', () => {
    process.env.XDG_CONFIG_HOME = '/custom/config';
    const p = getStatePaths();
    expect(p.configDir).toBe('/custom/config/hermes-deploy');
    expect(p.stateFile).toBe('/custom/config/hermes-deploy/state.toml');
  });

  it('returns the right per-deployment ssh and age key paths', () => {
    delete process.env.XDG_CONFIG_HOME;
    const p = getStatePaths();
    expect(p.sshKeyForDeployment('acme-discord')).toBe(join(p.sshKeysDir, 'acme-discord'));
    expect(p.ageKeyForDeployment('acme-discord')).toBe(join(p.ageKeysDir, 'acme-discord'));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/state/paths.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/state/paths.ts`**

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StatePaths {
  configDir: string;
  stateFile: string;
  lockFile: string;
  sshKeysDir: string;
  ageKeysDir: string;
  imageCacheFile: string;
  sshKeyForDeployment(name: string): string;
  ageKeyForDeployment(name: string): string;
}

export function getStatePaths(): StatePaths {
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  const xdgCache = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');

  const configDir = join(xdgConfig, 'hermes-deploy');
  const cacheDir = join(xdgCache, 'hermes-deploy');
  const sshKeysDir = join(configDir, 'ssh_keys');
  const ageKeysDir = join(configDir, 'age_keys');

  return {
    configDir,
    stateFile: join(configDir, 'state.toml'),
    lockFile: join(configDir, 'state.toml.lock'),
    sshKeysDir,
    ageKeysDir,
    imageCacheFile: join(cacheDir, 'images.json'),
    sshKeyForDeployment(name) {
      return join(sshKeysDir, name);
    },
    ageKeyForDeployment(name) {
      return join(ageKeysDir, name);
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/state/paths.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/paths.ts tests/unit/state/paths.test.ts
git commit -m "feat(state): add XDG-aware path helpers"
```

#### Task C2: State store with read, write, backup, and locking

**Files:**
- Create: `src/state/store.ts`
- Create: `tests/unit/state/store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../../../src/state/store.js';
import type { StateToml } from '../../../src/schema/state-toml.js';

describe('StateStore', () => {
  let tmpDir: string;
  let store: StateStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hermes-store-'));
    store = new StateStore({
      configDir: tmpDir,
      stateFile: join(tmpDir, 'state.toml'),
      lockFile: join(tmpDir, 'state.toml.lock'),
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty state when the file does not exist', async () => {
    const state = await store.read();
    expect(state.schema_version).toBe(1);
    expect(state.deployments).toEqual({});
  });

  it('persists and re-reads a deployment', async () => {
    const deployment = makeDeployment();
    await store.update(s => {
      s.deployments['test'] = deployment;
    });
    const state = await store.read();
    expect(state.deployments['test']?.cloud).toBe('aws');
    expect(state.deployments['test']?.cloud_resources).toMatchObject({ instance_id: 'i-1' });
  });

  it('creates a backup before overwriting', async () => {
    await store.update(s => { s.deployments['a'] = makeDeployment(); });
    await store.update(s => { s.deployments['b'] = makeDeployment('b'); });
    const backups = readBackups(tmpDir);
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects state files with unknown schema_version', async () => {
    writeFileSync(join(tmpDir, 'state.toml'), 'schema_version = 99\n[deployments]\n');
    await expect(store.read()).rejects.toThrow(/schema_version/);
  });

  it('serializes concurrent updates via the lock file', async () => {
    const order: number[] = [];
    const a = store.update(async s => {
      order.push(1);
      await new Promise(r => setTimeout(r, 50));
      s.deployments['a'] = makeDeployment('a');
      order.push(2);
    });
    const b = store.update(async s => {
      order.push(3);
      s.deployments['b'] = makeDeployment('b');
      order.push(4);
    });
    await Promise.all([a, b]);
    // a's [1,2] must come fully before b's [3,4]
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(3));
  });
});

function makeDeployment(name = 'test') {
  return {
    project_path: '/x',
    cloud: 'aws' as const,
    region: 'eu-west-3',
    created_at: '2026-04-09T00:00:00Z',
    last_deployed_at: '2026-04-09T00:00:00Z',
    last_config_hash: 'sha256:abc',
    ssh_key_path: `/x/${name}`,
    age_key_path: `/x/${name}`,
    health: 'unknown' as const,
    instance_ip: '0.0.0.0',
    cloud_resources: {
      instance_id: 'i-1',
      security_group_id: 'sg-1',
      key_pair_name: `kp-${name}`,
      eip_allocation_id: 'eipalloc-1',
      region: 'eu-west-3',
    },
  };
}

function readBackups(dir: string): string[] {
  const { readdirSync } = require('node:fs');
  return readdirSync(dir).filter((n: string) => n.startsWith('state.toml.bak.'));
}
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/state/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/state/store.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import lockfile from 'proper-lockfile';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { StateTomlSchema, type StateToml } from '../schema/state-toml.js';

interface StorePaths {
  configDir: string;
  stateFile: string;
  lockFile: string;
}

const MAX_BACKUPS = 5;

export class StateStore {
  constructor(private readonly paths: StorePaths) {}

  async read(): Promise<StateToml> {
    if (!existsSync(this.paths.stateFile)) {
      return { schema_version: 1, deployments: {} };
    }
    const raw = readFileSync(this.paths.stateFile, 'utf-8');
    const parsed = parseToml(raw);
    const result = StateTomlSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`state.toml failed validation: ${issues}`);
    }
    return result.data;
  }

  async update(mutator: (state: StateToml) => void | Promise<void>): Promise<void> {
    this.ensureConfigDir();
    // Ensure the lockfile target exists for proper-lockfile
    if (!existsSync(this.paths.stateFile)) {
      writeFileSync(this.paths.stateFile, 'schema_version = 1\n[deployments]\n');
    }
    const release = await lockfile.lock(this.paths.stateFile, {
      retries: { retries: 30, minTimeout: 100, maxTimeout: 500 },
      stale: 30000,
    });
    try {
      const state = await this.read();
      this.backup();
      await mutator(state);
      // Re-validate before writing
      const validated = StateTomlSchema.parse(state);
      writeFileSync(this.paths.stateFile, stringifyToml(validated));
    } finally {
      await release();
    }
  }

  private ensureConfigDir(): void {
    if (!existsSync(this.paths.configDir)) {
      mkdirSync(this.paths.configDir, { recursive: true });
    }
  }

  private backup(): void {
    if (!existsSync(this.paths.stateFile)) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.paths.stateFile}.bak.${ts}`;
    copyFileSync(this.paths.stateFile, backupPath);
    this.pruneOldBackups();
  }

  private pruneOldBackups(): void {
    const dir = dirname(this.paths.stateFile);
    const base = `${this.paths.stateFile.split('/').pop()}.bak.`;
    const backups = readdirSync(dir)
      .filter(n => n.startsWith(base))
      .map(n => join(dir, n))
      .sort()
      .reverse();
    for (const old of backups.slice(MAX_BACKUPS)) {
      try { unlinkSync(old); } catch {}
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/state/store.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts tests/unit/state/store.test.ts
git commit -m "feat(state): add state store with locking, backup, and validation"
```

#### Task C3: Config hash helper

**Files:**
- Create: `src/state/hash.ts`
- Create: `tests/unit/state/hash.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeConfigHash } from '../../../src/state/hash.js';

describe('computeConfigHash', () => {
  it('produces a stable sha256 hash for the same inputs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-hash-'));
    writeFileSync(join(dir, 'hermes.toml'), 'name="x"');
    writeFileSync(join(dir, 'secrets.enc.yaml'), 'enc:1');
    const a = computeConfigHash([
      join(dir, 'hermes.toml'),
      join(dir, 'secrets.enc.yaml'),
    ]);
    const b = computeConfigHash([
      join(dir, 'hermes.toml'),
      join(dir, 'secrets.enc.yaml'),
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    rmSync(dir, { recursive: true });
  });

  it('changes when any input file changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-hash-'));
    writeFileSync(join(dir, 'a'), '1');
    const before = computeConfigHash([join(dir, 'a')]);
    writeFileSync(join(dir, 'a'), '2');
    const after = computeConfigHash([join(dir, 'a')]);
    expect(before).not.toBe(after);
    rmSync(dir, { recursive: true });
  });

  it('skips missing optional files when allowMissing=true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-hash-'));
    writeFileSync(join(dir, 'a'), '1');
    const h = computeConfigHash([join(dir, 'a'), join(dir, 'missing')], true);
    expect(h).toMatch(/^sha256:/);
    rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/state/hash.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/state/hash.ts`**

```typescript
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

export function computeConfigHash(filePaths: string[], allowMissing = false): string {
  const hash = createHash('sha256');
  for (const path of filePaths) {
    if (!existsSync(path)) {
      if (allowMissing) continue;
      throw new Error(`computeConfigHash: file not found: ${path}`);
    }
    hash.update(`${path}\n`);
    hash.update(readFileSync(path));
    hash.update('\n--\n');
  }
  return `sha256:${hash.digest('hex')}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/state/hash.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/hash.ts tests/unit/state/hash.test.ts
git commit -m "feat(state): add config hash helper"
```

---

### Phase D — Nix-gen layer

#### Task D1: Nix templates and generator

**Files:**
- Create: `src/nix-gen/templates.ts`
- Create: `src/nix-gen/generate.ts`
- Create: `tests/unit/nix-gen/generate.test.ts`
- Create: `tests/fixtures/nix-snapshots/minimal.hermes.nix`
- Create: `tests/fixtures/nix-snapshots/full.hermes.nix`

- [ ] **Step 1: Write the failing test**

This test uses Vitest's `toMatchFileSnapshot`, which writes the snapshot file on first run and asserts equality on every subsequent run. To regenerate after intentional template changes: `npx vitest run -u tests/unit/nix-gen/generate.test.ts`.

```typescript
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { generateHermesNix, generateConfigurationNix } from '../../../src/nix-gen/generate.js';
import { loadHermesToml } from '../../../src/schema/load.js';

const fixturesDir = join(__dirname, '../../fixtures');

describe('generateHermesNix', () => {
  it('matches the snapshot for minimal.toml', async () => {
    const config = loadHermesToml(join(fixturesDir, 'hermes-toml/minimal.toml'));
    const got = generateHermesNix(config);
    await expect(got).toMatchFileSnapshot(
      join(fixturesDir, 'nix-snapshots/minimal.hermes.nix'),
    );
  });

  it('matches the snapshot for full.toml', async () => {
    const config = loadHermesToml(join(fixturesDir, 'hermes-toml/full.toml'));
    const got = generateHermesNix(config);
    await expect(got).toMatchFileSnapshot(
      join(fixturesDir, 'nix-snapshots/full.hermes.nix'),
    );
  });
});

describe('generateConfigurationNix', () => {
  it('imports hermes.nix and pins the hermes-agent flake', () => {
    const out = generateConfigurationNix();
    expect(out).toContain('imports = [');
    expect(out).toContain('./hermes.nix');
    expect(out).toContain('hermes-agent');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/nix-gen/generate.test.ts`
Expected: FAIL — module not found, snapshot fixtures missing.

- [ ] **Step 3: Implement `src/nix-gen/templates.ts`**

```typescript
export const CONFIGURATION_NIX = `{ config, pkgs, lib, ... }:
{
  imports = [
    <nixpkgs/nixos/modules/virtualisation/amazon-image.nix>
    "\${builtins.fetchTarball {
      url = \\"https://github.com/NousResearch/hermes-agent/archive/refs/heads/main.tar.gz\\";
    }}/nix/module.nix"
    ./hermes.nix
  ];

  system.stateVersion = "24.05";

  services.openssh = {
    enable = true;
    settings.PasswordAuthentication = false;
    settings.PermitRootLogin = "prohibit-password";
  };

  networking.firewall.enable = true;
}
`;
```

- [ ] **Step 4: Implement `src/nix-gen/generate.ts`**

```typescript
import type { HermesTomlConfig } from '../schema/hermes-toml.js';
import { CONFIGURATION_NIX } from './templates.js';

export function generateConfigurationNix(): string {
  return CONFIGURATION_NIX;
}

export function generateHermesNix(config: HermesTomlConfig): string {
  const lines: string[] = [];
  lines.push('{ config, pkgs, lib, ... }:');
  lines.push('{');
  lines.push('  services.hermes-agent = {');
  lines.push('    enable = true;');
  lines.push(`    model = "${config.hermes.model}";`);
  lines.push(`    soulFile = ${nixPath(config.hermes.soul)};`);
  lines.push('');
  lines.push('    sops = {');
  lines.push(`      secretsFile = ${nixPath(config.hermes.secrets_file)};`);
  lines.push('      ageKeyFile = "/var/lib/sops-nix/age.key";');
  lines.push('    };');

  if (config.hermes.platforms.discord?.enabled) {
    lines.push('');
    lines.push('    platforms.discord = {');
    lines.push('      enable = true;');
    if (config.hermes.platforms.discord.token_key) {
      lines.push(`      tokenSecretKey = "${config.hermes.platforms.discord.token_key}";`);
    }
    lines.push('    };');
  }

  if (config.hermes.platforms.telegram?.enabled) {
    lines.push('');
    lines.push('    platforms.telegram = {');
    lines.push('      enable = true;');
    if (config.hermes.platforms.telegram.token_key) {
      lines.push(`      tokenSecretKey = "${config.hermes.platforms.telegram.token_key}";`);
    }
    lines.push('    };');
  }

  if (config.hermes.mcp_servers.length > 0) {
    lines.push('');
    lines.push('    mcpServers = [');
    for (const m of config.hermes.mcp_servers) {
      lines.push('      {');
      lines.push(`        name = "${m.name}";`);
      lines.push(`        command = "${m.command}";`);
      lines.push(`        args = [ ${m.args.map(a => `"${a}"`).join(' ')} ];`);
      if (m.env_keys.length > 0) {
        lines.push(`        envSecretKeys = [ ${m.env_keys.map(k => `"${k}"`).join(' ')} ];`);
      }
      lines.push('      }');
    }
    lines.push('    ];');
  }

  lines.push('  };');

  if (config.hermes.nix_extra) {
    lines.push('');
    lines.push(`  imports = [ ${nixPath(config.hermes.nix_extra.file)} ];`);
  }

  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function nixPath(p: string): string {
  // Bare relative paths in Nix don't need quoting
  if (p.startsWith('./') || p.startsWith('/')) return p;
  return `./${p}`;
}
```

- [ ] **Step 5: Run the test in update mode to write the snapshot files**

Run: `npx vitest run -u tests/unit/nix-gen/generate.test.ts`
Expected: tests pass and `tests/fixtures/nix-snapshots/minimal.hermes.nix` and `full.hermes.nix` are created on disk. The `-u` flag tells vitest to write/update file snapshots.

- [ ] **Step 6: Inspect the generated snapshot files**

Run: `cat tests/fixtures/nix-snapshots/minimal.hermes.nix tests/fixtures/nix-snapshots/full.hermes.nix`
Verify by eye: the output looks like valid Nix module syntax with `services.hermes-agent`, the right model string, sops config, and (for `full`) the discord platform, mcp servers, and nix_extra import. If the generator is wrong, fix `src/nix-gen/generate.ts` and re-run with `-u`.

- [ ] **Step 7: Run the test in normal mode to verify it passes against the saved snapshots**

Run: `npx vitest run tests/unit/nix-gen/generate.test.ts`
Expected: all 3 tests PASS without `-u`.

- [ ] **Step 8: Commit**

```bash
git add src/nix-gen/ tests/unit/nix-gen/ tests/fixtures/nix-snapshots/
git commit -m "feat(nix-gen): generate hermes.nix and configuration.nix from toml"
```

---

### Phase E — Crypto + SOPS bootstrap

#### Task E1: SSH keypair generation (ed25519)

**Files:**
- Create: `src/crypto/ssh-keygen.ts`
- Create: `tests/unit/crypto/ssh-keygen.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSshKeypair } from '../../../src/crypto/ssh-keygen.js';

describe('generateSshKeypair', () => {
  it('writes private and public key files with chmod 600 / 644', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-ssh-'));
    const priv = join(dir, 'id_ed25519');
    const result = generateSshKeypair(priv);
    expect(existsSync(priv)).toBe(true);
    expect(existsSync(`${priv}.pub`)).toBe(true);
    const privMode = statSync(priv).mode & 0o777;
    expect(privMode).toBe(0o600);
    const pubMode = statSync(`${priv}.pub`).mode & 0o777;
    expect(pubMode).toBe(0o644);
    expect(readFileSync(priv, 'utf-8')).toContain('PRIVATE KEY');
    expect(result.publicKey).toMatch(/^ssh-ed25519 /);
    rmSync(dir, { recursive: true });
  });

  it('throws if the private key file already exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-ssh-'));
    const priv = join(dir, 'id_ed25519');
    generateSshKeypair(priv);
    expect(() => generateSshKeypair(priv)).toThrow(/already exists/);
    rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/crypto/ssh-keygen.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/crypto/ssh-keygen.ts`**

```typescript
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SshKeypair {
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string; // ssh-ed25519 AAAA... line
}

export function generateSshKeypair(privateKeyPath: string): SshKeypair {
  if (existsSync(privateKeyPath)) {
    throw new Error(`SSH private key already exists at ${privateKeyPath}`);
  }
  mkdirSync(dirname(privateKeyPath), { recursive: true });

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;
  writeFileSync(privateKeyPath, privPem);
  chmodSync(privateKeyPath, 0o600);

  // Build OpenSSH-format public key
  const sshPub = toOpenSshPublic(publicKey.export({ format: 'der', type: 'spki' }) as Buffer);
  const publicKeyPath = `${privateKeyPath}.pub`;
  writeFileSync(publicKeyPath, sshPub);
  chmodSync(publicKeyPath, 0o644);

  return { privateKeyPath, publicKeyPath, publicKey: sshPub.trim() };
}

function toOpenSshPublic(spki: Buffer): string {
  // Extract the 32-byte ed25519 public key from SPKI DER
  // The last 32 bytes of an ed25519 SPKI are the raw public key
  const pubBytes = spki.subarray(spki.length - 32);
  // OpenSSH wire format: string "ssh-ed25519" + string <pubBytes>
  const algo = Buffer.from('ssh-ed25519');
  const buf = Buffer.concat([
    lenPrefix(algo),
    lenPrefix(pubBytes),
  ]);
  return `ssh-ed25519 ${buf.toString('base64')} hermes-deploy\n`;
}

function lenPrefix(b: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length);
  return Buffer.concat([len, b]);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/crypto/ssh-keygen.test.ts`
Expected: all 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/crypto/ssh-keygen.ts tests/unit/crypto/ssh-keygen.test.ts
git commit -m "feat(crypto): generate ed25519 SSH keypairs"
```

#### Task E2: Age keypair generation (shell-out)

**Files:**
- Create: `src/crypto/age-keygen.ts`
- Create: `tests/unit/crypto/age-keygen.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { generateAgeKeypair } from '../../../src/crypto/age-keygen.js';

const ageInstalled = (() => {
  try {
    execSync('which age-keygen', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!ageInstalled)('generateAgeKeypair (requires age-keygen on PATH)', () => {
  it('writes a private key file and returns the public key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-age-'));
    const path = join(dir, 'age.key');
    const result = generateAgeKeypair(path);
    expect(existsSync(path)).toBe(true);
    expect(result.publicKey).toMatch(/^age1[a-z0-9]{58}$/);
    expect(readFileSync(path, 'utf-8')).toContain('AGE-SECRET-KEY-1');
    rmSync(dir, { recursive: true });
  });

  it('refuses to overwrite an existing key file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-age-'));
    const path = join(dir, 'age.key');
    generateAgeKeypair(path);
    expect(() => generateAgeKeypair(path)).toThrow(/already exists/);
    rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/crypto/age-keygen.test.ts`
Expected: FAIL — module not found (or skipped if `age-keygen` is not installed). If skipped, install age (`brew install age` on macOS) and re-run.

- [ ] **Step 3: Implement `src/crypto/age-keygen.ts`**

```typescript
import { execFileSync } from 'node:child_process';
import { writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AgeKeypair {
  privateKeyPath: string;
  publicKey: string; // age1...
}

export function generateAgeKeypair(privateKeyPath: string): AgeKeypair {
  if (existsSync(privateKeyPath)) {
    throw new Error(`age key already exists at ${privateKeyPath}`);
  }
  mkdirSync(dirname(privateKeyPath), { recursive: true });

  let stdout: string;
  try {
    stdout = execFileSync('age-keygen', [], { encoding: 'utf-8' });
  } catch (e) {
    throw new Error(
      `age-keygen failed: ${(e as Error).message}. Install age (e.g. 'brew install age').`,
    );
  }

  // Format:
  // # created: 2026-04-09T...
  // # public key: age1...
  // AGE-SECRET-KEY-1...
  const pubMatch = stdout.match(/^# public key: (age1[a-z0-9]+)$/m);
  if (!pubMatch) {
    throw new Error(`age-keygen output did not contain a public key line: ${stdout}`);
  }
  const publicKey = pubMatch[1]!;

  writeFileSync(privateKeyPath, stdout);
  chmodSync(privateKeyPath, 0o600);

  return { privateKeyPath, publicKey };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/crypto/age-keygen.test.ts`
Expected: 2 tests PASS (or skipped if `age-keygen` not installed; install age and re-run).

- [ ] **Step 5: Commit**

```bash
git add src/crypto/age-keygen.ts tests/unit/crypto/age-keygen.test.ts
git commit -m "feat(crypto): wrap age-keygen for per-deployment age keypairs"
```

#### Task E3: SOPS bootstrap (`.sops.yaml` and empty `secrets.enc.yaml`)

**Files:**
- Create: `src/sops/bootstrap.ts`
- Create: `tests/unit/sops/bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { ensureSopsBootstrap } from '../../../src/sops/bootstrap.js';

const sopsInstalled = (() => {
  try { execSync('which sops', { stdio: 'ignore' }); return true; } catch { return false; }
})();

describe.skipIf(!sopsInstalled)('ensureSopsBootstrap', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hermes-sops-'));
  });

  it('creates .sops.yaml with the given age recipient', () => {
    ensureSopsBootstrap(dir, 'age1abcdefghijklmnopqrstuvwxyz0123456789012345678901234567');
    const sopsYaml = readFileSync(join(dir, '.sops.yaml'), 'utf-8');
    expect(sopsYaml).toContain('age1abc');
    expect(sopsYaml).toContain('secrets\\.enc\\.yaml$');
    rmSync(dir, { recursive: true });
  });

  it('creates an empty encrypted secrets.enc.yaml', () => {
    ensureSopsBootstrap(dir, 'age1abcdefghijklmnopqrstuvwxyz0123456789012345678901234567');
    expect(existsSync(join(dir, 'secrets.enc.yaml'))).toBe(true);
    rmSync(dir, { recursive: true });
  });

  it('is idempotent: re-running does not change existing files', () => {
    ensureSopsBootstrap(dir, 'age1abcdefghijklmnopqrstuvwxyz0123456789012345678901234567');
    const before = readFileSync(join(dir, '.sops.yaml'), 'utf-8');
    ensureSopsBootstrap(dir, 'age1abcdefghijklmnopqrstuvwxyz0123456789012345678901234567');
    const after = readFileSync(join(dir, '.sops.yaml'), 'utf-8');
    expect(after).toBe(before);
    rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/sops/bootstrap.test.ts`
Expected: FAIL — module not found (or skipped if `sops` not on PATH).

- [ ] **Step 3: Implement `src/sops/bootstrap.ts`**

```typescript
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function ensureSopsBootstrap(projectDir: string, agePublicKey: string): void {
  const sopsYamlPath = join(projectDir, '.sops.yaml');
  if (!existsSync(sopsYamlPath)) {
    const content = `creation_rules:
  - path_regex: secrets\\.enc\\.yaml$
    age: ${agePublicKey}
`;
    writeFileSync(sopsYamlPath, content);
  }

  const secretsPath = join(projectDir, 'secrets.enc.yaml');
  if (!existsSync(secretsPath)) {
    // Encrypt an empty placeholder file using sops directly
    const placeholder = '# add secrets with: sops secrets.enc.yaml\nplaceholder: bootstrap\n';
    writeFileSync(secretsPath, placeholder);
    try {
      execFileSync('sops', ['--encrypt', '--in-place', secretsPath], {
        cwd: projectDir,
        stdio: 'pipe',
      });
    } catch (e) {
      throw new Error(
        `sops encryption failed: ${(e as Error).message}. Ensure 'sops' is installed and your age recipient is valid.`,
      );
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/sops/bootstrap.test.ts`
Expected: all 3 tests PASS (sops + age must be installed locally).

- [ ] **Step 5: Commit**

```bash
git add src/sops/bootstrap.ts tests/unit/sops/bootstrap.test.ts
git commit -m "feat(sops): bootstrap .sops.yaml and encrypted placeholder secrets file"
```

---

### Phase F — Cloud abstraction core

#### Task F1: CloudProvider interface, types, and errors

**Files:**
- Create: `src/cloud/core.ts`
- Create: `src/errors/index.ts`

- [ ] **Step 1: Implement `src/errors/index.ts`**

```typescript
export class HermesDeployError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'HermesDeployError';
  }
}

export class CloudProvisionError extends HermesDeployError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'CloudProvisionError';
  }
}

export class CloudQuotaError extends CloudProvisionError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'CloudQuotaError';
  }
}

export class SshBootstrapError extends HermesDeployError {
  constructor(message: string, public readonly publicIp: string, cause?: unknown) {
    super(message, cause);
    this.name = 'SshBootstrapError';
  }
}

export class NixosRebuildError extends HermesDeployError {
  constructor(message: string, public readonly logTail: string[], cause?: unknown) {
    super(message, cause);
    this.name = 'NixosRebuildError';
  }
}

export class HealthcheckTimeoutError extends HermesDeployError {
  constructor(message: string, public readonly journalTail: string[]) {
    super(message);
    this.name = 'HealthcheckTimeoutError';
  }
}
```

- [ ] **Step 2: Implement `src/cloud/core.ts`**

```typescript
import type { AwsResources, GcpResources } from '../schema/state-toml.js';

export type Size = 'small' | 'medium' | 'large';

export interface Location {
  region: string;
  zone?: string;
}

export interface ImageRef {
  id: string;       // ami-xxx or projects/.../images/...
  description: string;
}

export interface NetworkRules {
  sshAllowedFrom: string; // CIDR
  inboundPorts: number[];
}

export interface ProvisionSpec {
  deploymentName: string;
  location: Location;
  size: Size;
  image: ImageRef;
  publicSshKey: string;       // OpenSSH-format public key line
  networkRules: NetworkRules;
}

export interface Instance {
  publicIp: string;
  sshUser: string;            // 'root' for NixOS
}

export type ResourceLedger =
  | { kind: 'aws'; resources: Partial<AwsResources> }
  | { kind: 'gcp'; resources: Partial<GcpResources> };

export interface InstanceStatus {
  state: 'pending' | 'running' | 'stopping' | 'stopped' | 'terminated' | 'unknown';
  publicIp: string | null;
}

export interface CloudProvider {
  readonly name: 'aws' | 'gcp';
  resolveNixosImage(loc: Location): Promise<ImageRef>;
  provision(spec: ProvisionSpec, ledger: ResourceLedger): Promise<Instance>;
  destroy(ledger: ResourceLedger): Promise<void>;
  status(ledger: ResourceLedger): Promise<InstanceStatus>;
}

export const SIZE_MAP_AWS: Record<Size, string> = {
  small: 't3.small',
  medium: 't3.medium',
  large: 't3.large',
};
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/cloud/core.ts src/errors/index.ts
git commit -m "feat(cloud): add CloudProvider interface, types, and error classes"
```

---

### Phase G — AWS provider

#### Task G1: NixOS AMI lookup with 1-hour cache

**Files:**
- Create: `src/cloud/aws/images.ts`
- Create: `tests/unit/cloud/aws/images.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { EC2Client, DescribeImagesCommand } from '@aws-sdk/client-ec2';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveNixosAmi } from '../../../../src/cloud/aws/images.js';

describe('resolveNixosAmi', () => {
  const ec2Mock = mockClient(EC2Client);
  let cacheFile: string;

  beforeEach(() => {
    ec2Mock.reset();
    cacheFile = join(mkdtempSync(join(tmpdir(), 'hermes-img-')), 'images.json');
  });

  afterEach(() => {
    if (existsSync(cacheFile)) rmSync(cacheFile);
  });

  it('queries DescribeImages and returns the newest image id', async () => {
    ec2Mock.on(DescribeImagesCommand).resolves({
      Images: [
        { ImageId: 'ami-old', CreationDate: '2024-01-01T00:00:00Z', Name: 'nixos/24.05.x' },
        { ImageId: 'ami-new', CreationDate: '2024-06-01T00:00:00Z', Name: 'nixos/24.05.y' },
      ],
    });
    const ec2 = new EC2Client({ region: 'eu-west-3' });
    const ref = await resolveNixosAmi(ec2, 'eu-west-3', cacheFile);
    expect(ref.id).toBe('ami-new');
  });

  it('returns the cached value on a second call within TTL', async () => {
    ec2Mock.on(DescribeImagesCommand).resolves({
      Images: [{ ImageId: 'ami-cached', CreationDate: '2024-06-01T00:00:00Z', Name: 'n' }],
    });
    const ec2 = new EC2Client({ region: 'eu-west-3' });
    await resolveNixosAmi(ec2, 'eu-west-3', cacheFile);
    expect(ec2Mock.calls()).toHaveLength(1);
    await resolveNixosAmi(ec2, 'eu-west-3', cacheFile);
    expect(ec2Mock.calls()).toHaveLength(1); // not re-called
  });

  it('throws when no images are returned', async () => {
    ec2Mock.on(DescribeImagesCommand).resolves({ Images: [] });
    const ec2 = new EC2Client({ region: 'eu-west-3' });
    await expect(resolveNixosAmi(ec2, 'eu-west-3', cacheFile)).rejects.toThrow(/no NixOS AMI/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/cloud/aws/images.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/cloud/aws/images.ts`**

```typescript
import { EC2Client, DescribeImagesCommand } from '@aws-sdk/client-ec2';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ImageRef } from '../core.js';

const NIXOS_OWNER_ID = '427812963091'; // NixOS Foundation
const NIXOS_NAME_PATTERN = 'nixos/24.05*-x86_64-linux';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedImage {
  region: string;
  imageId: string;
  description: string;
  fetchedAt: number;
}

interface ImageCache {
  entries: CachedImage[];
}

export async function resolveNixosAmi(
  ec2: EC2Client,
  region: string,
  cacheFile: string,
): Promise<ImageRef> {
  const now = Date.now();

  const cache = readCache(cacheFile);
  const hit = cache.entries.find(
    e => e.region === region && now - e.fetchedAt < CACHE_TTL_MS,
  );
  if (hit) {
    return { id: hit.imageId, description: hit.description };
  }

  const result = await ec2.send(
    new DescribeImagesCommand({
      Owners: [NIXOS_OWNER_ID],
      Filters: [
        { Name: 'name', Values: [NIXOS_NAME_PATTERN] },
        { Name: 'architecture', Values: ['x86_64'] },
        { Name: 'state', Values: ['available'] },
      ],
    }),
  );

  const images = result.Images ?? [];
  if (images.length === 0) {
    throw new Error(`no NixOS AMI found in region ${region} matching ${NIXOS_NAME_PATTERN}`);
  }

  const sorted = [...images].sort((a, b) => {
    const da = new Date(a.CreationDate ?? 0).getTime();
    const db = new Date(b.CreationDate ?? 0).getTime();
    return db - da;
  });
  const latest = sorted[0]!;

  const ref: ImageRef = {
    id: latest.ImageId!,
    description: latest.Name ?? 'nixos',
  };

  cache.entries = cache.entries.filter(e => e.region !== region);
  cache.entries.push({
    region,
    imageId: ref.id,
    description: ref.description,
    fetchedAt: now,
  });
  writeCache(cacheFile, cache);

  return ref;
}

function readCache(path: string): ImageCache {
  if (!existsSync(path)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return { entries: [] };
  }
}

function writeCache(path: string, cache: ImageCache): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/cloud/aws/images.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cloud/aws/images.ts tests/unit/cloud/aws/images.test.ts
git commit -m "feat(cloud/aws): resolve latest NixOS AMI with 1-hour cache"
```

#### Task G2: AWS provision sequence and rollback

**Files:**
- Create: `src/cloud/aws/provision.ts`
- Create: `src/cloud/aws/destroy.ts`
- Create: `tests/unit/cloud/aws/provision.test.ts`

- [ ] **Step 1: Write the failing test (full provision happy path + rollback on RunInstances failure)**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  EC2Client,
  ImportKeyPairCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  RunInstancesCommand,
  AllocateAddressCommand,
  AssociateAddressCommand,
  DeleteKeyPairCommand,
  DeleteSecurityGroupCommand,
  TerminateInstancesCommand,
  ReleaseAddressCommand,
} from '@aws-sdk/client-ec2';
import { provisionAws } from '../../../../src/cloud/aws/provision.js';
import type { ProvisionSpec, ResourceLedger } from '../../../../src/cloud/core.js';

describe('provisionAws', () => {
  const ec2Mock = mockClient(EC2Client);
  beforeEach(() => ec2Mock.reset());

  const spec: ProvisionSpec = {
    deploymentName: 'test',
    location: { region: 'eu-west-3' },
    size: 'small',
    image: { id: 'ami-1', description: 'nixos' },
    publicSshKey: 'ssh-ed25519 AAAA test',
    networkRules: { sshAllowedFrom: '203.0.113.1/32', inboundPorts: [443] },
  };

  it('runs the full sequence and returns an instance', async () => {
    ec2Mock.on(ImportKeyPairCommand).resolves({ KeyName: 'hermes-deploy-test' });
    ec2Mock.on(CreateSecurityGroupCommand).resolves({ GroupId: 'sg-1' });
    ec2Mock.on(AuthorizeSecurityGroupIngressCommand).resolves({});
    ec2Mock.on(RunInstancesCommand).resolves({
      Instances: [{ InstanceId: 'i-1' }],
    });
    ec2Mock.on(AllocateAddressCommand).resolves({
      AllocationId: 'eipalloc-1',
      PublicIp: '203.0.113.42',
    });
    ec2Mock.on(AssociateAddressCommand).resolves({});

    const ec2 = new EC2Client({ region: 'eu-west-3' });
    const ledger: ResourceLedger = { kind: 'aws', resources: {} };
    const instance = await provisionAws(ec2, spec, ledger);

    expect(instance.publicIp).toBe('203.0.113.42');
    expect(ledger.kind === 'aws' && ledger.resources.instance_id).toBe('i-1');
    expect(ledger.kind === 'aws' && ledger.resources.security_group_id).toBe('sg-1');
    expect(ledger.kind === 'aws' && ledger.resources.eip_allocation_id).toBe('eipalloc-1');
  });

  it('rolls back resources created so far if RunInstances fails', async () => {
    ec2Mock.on(ImportKeyPairCommand).resolves({ KeyName: 'hermes-deploy-test' });
    ec2Mock.on(CreateSecurityGroupCommand).resolves({ GroupId: 'sg-1' });
    ec2Mock.on(AuthorizeSecurityGroupIngressCommand).resolves({});
    ec2Mock.on(RunInstancesCommand).rejects(new Error('InsufficientInstanceCapacity'));
    ec2Mock.on(DeleteSecurityGroupCommand).resolves({});
    ec2Mock.on(DeleteKeyPairCommand).resolves({});

    const ec2 = new EC2Client({ region: 'eu-west-3' });
    const ledger: ResourceLedger = { kind: 'aws', resources: {} };
    await expect(provisionAws(ec2, spec, ledger)).rejects.toThrow(/InsufficientInstanceCapacity/);

    // After rollback, the ledger should be empty
    expect(ledger.kind === 'aws' && ledger.resources.instance_id).toBeUndefined();
    expect(ledger.kind === 'aws' && ledger.resources.security_group_id).toBeUndefined();

    // And rollback API calls were made
    expect(ec2Mock.commandCalls(DeleteSecurityGroupCommand)).toHaveLength(1);
    expect(ec2Mock.commandCalls(DeleteKeyPairCommand)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/cloud/aws/provision.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/cloud/aws/destroy.ts`** (provision rollback uses it)

```typescript
import {
  EC2Client,
  DeleteKeyPairCommand,
  DeleteSecurityGroupCommand,
  TerminateInstancesCommand,
  ReleaseAddressCommand,
  DescribeInstancesCommand,
  waitUntilInstanceTerminated,
} from '@aws-sdk/client-ec2';
import type { ResourceLedger } from '../core.js';

export async function destroyAws(ec2: EC2Client, ledger: ResourceLedger): Promise<void> {
  if (ledger.kind !== 'aws') throw new Error(`expected aws ledger, got ${ledger.kind}`);
  const r = ledger.resources;

  // Order: instance → EIP → SG → keypair (reverse of provision deps)
  if (r.instance_id) {
    try {
      await ec2.send(new TerminateInstancesCommand({ InstanceIds: [r.instance_id] }));
      await waitUntilInstanceTerminated(
        { client: ec2, maxWaitTime: 300 },
        { InstanceIds: [r.instance_id] },
      );
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    delete r.instance_id;
  }

  if (r.eip_allocation_id) {
    try {
      await ec2.send(new ReleaseAddressCommand({ AllocationId: r.eip_allocation_id }));
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    delete r.eip_allocation_id;
  }

  if (r.security_group_id) {
    try {
      await ec2.send(new DeleteSecurityGroupCommand({ GroupId: r.security_group_id }));
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    delete r.security_group_id;
  }

  if (r.key_pair_name) {
    try {
      await ec2.send(new DeleteKeyPairCommand({ KeyName: r.key_pair_name }));
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    delete r.key_pair_name;
  }
}

function isNotFound(e: unknown): boolean {
  const msg = (e as Error).message ?? '';
  return /NotFound|does not exist|InvalidInstanceID/.test(msg);
}
```

- [ ] **Step 4: Implement `src/cloud/aws/provision.ts`**

```typescript
import {
  EC2Client,
  ImportKeyPairCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  RunInstancesCommand,
  AllocateAddressCommand,
  AssociateAddressCommand,
} from '@aws-sdk/client-ec2';
import type { ProvisionSpec, ResourceLedger, Instance } from '../core.js';
import { SIZE_MAP_AWS } from '../core.js';
import { destroyAws } from './destroy.js';
import { CloudProvisionError } from '../../errors/index.js';

const TAG_MANAGED_BY = 'managed-by';
const TAG_DEPLOYMENT = 'hermes-deploy/deployment';
const TAG_VALUE = 'hermes-deploy';

export async function provisionAws(
  ec2: EC2Client,
  spec: ProvisionSpec,
  ledger: ResourceLedger,
): Promise<Instance> {
  if (ledger.kind !== 'aws') throw new Error(`expected aws ledger, got ${ledger.kind}`);
  const r = ledger.resources;
  const tagSpec = (resourceType: string) => ({
    ResourceType: resourceType,
    Tags: [
      { Key: TAG_MANAGED_BY, Value: TAG_VALUE },
      { Key: TAG_DEPLOYMENT, Value: spec.deploymentName },
      { Key: 'Name', Value: `hermes-deploy-${spec.deploymentName}` },
    ],
  });

  try {
    // 1. ImportKeyPair
    const keyName = `hermes-deploy-${spec.deploymentName}`;
    await ec2.send(
      new ImportKeyPairCommand({
        KeyName: keyName,
        PublicKeyMaterial: Buffer.from(spec.publicSshKey),
        TagSpecifications: [tagSpec('key-pair') as any],
      }),
    );
    r.key_pair_name = keyName;

    // 2. CreateSecurityGroup
    const sgResult = await ec2.send(
      new CreateSecurityGroupCommand({
        GroupName: `hermes-deploy-${spec.deploymentName}`,
        Description: `hermes-deploy security group for ${spec.deploymentName}`,
        TagSpecifications: [tagSpec('security-group') as any],
      }),
    );
    if (!sgResult.GroupId) throw new Error('CreateSecurityGroup returned no GroupId');
    r.security_group_id = sgResult.GroupId;

    // 3. AuthorizeSecurityGroupIngress
    const ipPermissions = [
      {
        IpProtocol: 'tcp',
        FromPort: 22,
        ToPort: 22,
        IpRanges: [{ CidrIp: spec.networkRules.sshAllowedFrom }],
      },
      ...spec.networkRules.inboundPorts.map(port => ({
        IpProtocol: 'tcp',
        FromPort: port,
        ToPort: port,
        IpRanges: [{ CidrIp: '0.0.0.0/0' }],
      })),
    ];
    await ec2.send(
      new AuthorizeSecurityGroupIngressCommand({
        GroupId: sgResult.GroupId,
        IpPermissions: ipPermissions,
      }),
    );

    // 4. RunInstances
    const runResult = await ec2.send(
      new RunInstancesCommand({
        ImageId: spec.image.id,
        InstanceType: SIZE_MAP_AWS[spec.size] as any,
        MinCount: 1,
        MaxCount: 1,
        KeyName: keyName,
        SecurityGroupIds: [sgResult.GroupId],
        TagSpecifications: [tagSpec('instance') as any],
      }),
    );
    const instanceId = runResult.Instances?.[0]?.InstanceId;
    if (!instanceId) throw new Error('RunInstances returned no instance id');
    r.instance_id = instanceId;

    // 5. AllocateAddress
    const eipResult = await ec2.send(
      new AllocateAddressCommand({
        Domain: 'vpc',
        TagSpecifications: [tagSpec('elastic-ip') as any],
      }),
    );
    if (!eipResult.AllocationId || !eipResult.PublicIp) {
      throw new Error('AllocateAddress returned incomplete data');
    }
    r.eip_allocation_id = eipResult.AllocationId;

    // 6. AssociateAddress (must wait for instance to be in 'pending'/'running' state)
    await ec2.send(
      new AssociateAddressCommand({
        AllocationId: eipResult.AllocationId,
        InstanceId: instanceId,
      }),
    );

    r.region = spec.location.region;

    return { publicIp: eipResult.PublicIp, sshUser: 'root' };
  } catch (e) {
    // Roll back whatever was created so far, then re-throw a typed error
    try {
      await destroyAws(ec2, ledger);
    } catch (rollbackError) {
      // Swallow rollback errors; surface the original
    }
    throw new CloudProvisionError(
      `AWS provisioning failed: ${(e as Error).message}`,
      e,
    );
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/unit/cloud/aws/provision.test.ts`
Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cloud/aws/provision.ts src/cloud/aws/destroy.ts tests/unit/cloud/aws/provision.test.ts
git commit -m "feat(cloud/aws): provision sequence with rollback on failure"
```

#### Task G3: AWS destroy idempotency tests

**Files:**
- Create: `tests/unit/cloud/aws/destroy.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  EC2Client,
  TerminateInstancesCommand,
  ReleaseAddressCommand,
  DeleteSecurityGroupCommand,
  DeleteKeyPairCommand,
} from '@aws-sdk/client-ec2';
import { destroyAws } from '../../../../src/cloud/aws/destroy.js';
import type { ResourceLedger } from '../../../../src/cloud/core.js';

describe('destroyAws', () => {
  const ec2Mock = mockClient(EC2Client);
  beforeEach(() => ec2Mock.reset());

  it('deletes resources in reverse dependency order', async () => {
    ec2Mock.on(TerminateInstancesCommand).resolves({});
    ec2Mock.on(ReleaseAddressCommand).resolves({});
    ec2Mock.on(DeleteSecurityGroupCommand).resolves({});
    ec2Mock.on(DeleteKeyPairCommand).resolves({});

    const ledger: ResourceLedger = {
      kind: 'aws',
      resources: {
        instance_id: 'i-1',
        eip_allocation_id: 'eipalloc-1',
        security_group_id: 'sg-1',
        key_pair_name: 'kp-1',
        region: 'eu-west-3',
      },
    };
    await destroyAws(ec2Mock as any, ledger);
    expect(ec2Mock.commandCalls(TerminateInstancesCommand)).toHaveLength(1);
    expect(ec2Mock.commandCalls(ReleaseAddressCommand)).toHaveLength(1);
    expect(ec2Mock.commandCalls(DeleteSecurityGroupCommand)).toHaveLength(1);
    expect(ec2Mock.commandCalls(DeleteKeyPairCommand)).toHaveLength(1);
  });

  it('is idempotent against already-deleted resources', async () => {
    ec2Mock.on(TerminateInstancesCommand).rejects(new Error('InvalidInstanceID.NotFound'));
    ec2Mock.on(ReleaseAddressCommand).rejects(new Error('InvalidAllocationID.NotFound'));
    ec2Mock.on(DeleteSecurityGroupCommand).rejects(new Error('InvalidGroup.NotFound'));
    ec2Mock.on(DeleteKeyPairCommand).resolves({});

    const ledger: ResourceLedger = {
      kind: 'aws',
      resources: {
        instance_id: 'i-1',
        eip_allocation_id: 'eipalloc-1',
        security_group_id: 'sg-1',
        key_pair_name: 'kp-1',
        region: 'eu-west-3',
      },
    };
    await expect(destroyAws(ec2Mock as any, ledger)).resolves.toBeUndefined();
  });

  it('skips steps for missing ledger fields', async () => {
    const ledger: ResourceLedger = { kind: 'aws', resources: { region: 'eu-west-3' } };
    await destroyAws(ec2Mock as any, ledger);
    expect(ec2Mock.calls()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify pass**

Run: `npx vitest run tests/unit/cloud/aws/destroy.test.ts`
Expected: all 3 tests PASS (the impl from G2 should already satisfy them; if not, fix the impl).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/cloud/aws/destroy.test.ts
git commit -m "test(cloud/aws): cover destroy ordering, idempotency, and partial-ledger"
```

#### Task G4: AWS status

**Files:**
- Create: `src/cloud/aws/status.ts`
- Create: `tests/unit/cloud/aws/status.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { statusAws } from '../../../../src/cloud/aws/status.js';

describe('statusAws', () => {
  const ec2Mock = mockClient(EC2Client);
  beforeEach(() => ec2Mock.reset());

  it('returns running and the public ip', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [{
        Instances: [{
          InstanceId: 'i-1',
          State: { Name: 'running' },
          PublicIpAddress: '203.0.113.42',
        }],
      }],
    });
    const result = await statusAws(ec2Mock as any, { kind: 'aws', resources: { instance_id: 'i-1', region: 'r' } });
    expect(result.state).toBe('running');
    expect(result.publicIp).toBe('203.0.113.42');
  });

  it('returns unknown if instance not found', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [] });
    const result = await statusAws(ec2Mock as any, { kind: 'aws', resources: { instance_id: 'i-x', region: 'r' } });
    expect(result.state).toBe('unknown');
  });
});
```

- [ ] **Step 2: Implement `src/cloud/aws/status.ts`**

```typescript
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import type { InstanceStatus, ResourceLedger } from '../core.js';

export async function statusAws(
  ec2: EC2Client,
  ledger: ResourceLedger,
): Promise<InstanceStatus> {
  if (ledger.kind !== 'aws') throw new Error('expected aws ledger');
  const id = ledger.resources.instance_id;
  if (!id) return { state: 'unknown', publicIp: null };

  const result = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [id] }));
  const inst = result.Reservations?.[0]?.Instances?.[0];
  if (!inst) return { state: 'unknown', publicIp: null };

  const state = (inst.State?.Name ?? 'unknown') as InstanceStatus['state'];
  return { state, publicIp: inst.PublicIpAddress ?? null };
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run tests/unit/cloud/aws/status.test.ts`
Expected: both tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cloud/aws/status.ts tests/unit/cloud/aws/status.test.ts
git commit -m "feat(cloud/aws): add status() reading EC2 instance state"
```

#### Task G5: Public IP detection helper

**Files:**
- Create: `src/cloud/aws/public-ip.ts`
- Create: `tests/unit/cloud/aws/public-ip.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { detectPublicIp } from '../../../../src/cloud/aws/public-ip.js';

describe('detectPublicIp', () => {
  it('returns a CIDR ending in /32 when given a public IP', async () => {
    const result = await detectPublicIp(async () => '203.0.113.42');
    expect(result).toBe('203.0.113.42/32');
  });

  it('throws on a syntactically invalid response', async () => {
    await expect(detectPublicIp(async () => 'not an ip')).rejects.toThrow(/invalid/);
  });
});
```

- [ ] **Step 2: Implement `src/cloud/aws/public-ip.ts`**

```typescript
import { request } from 'node:https';

export type IpFetcher = () => Promise<string>;

const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

export async function detectPublicIp(fetcher?: IpFetcher): Promise<string> {
  const fetch = fetcher ?? defaultFetcher;
  const ip = (await fetch()).trim();
  if (!IPV4_REGEX.test(ip)) {
    throw new Error(`invalid IP returned by detector: "${ip}"`);
  }
  return `${ip}/32`;
}

const defaultFetcher: IpFetcher = () =>
  new Promise((resolve, reject) => {
    const req = request(
      { hostname: 'checkip.amazonaws.com', port: 443, method: 'GET' },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', reject);
    req.end();
  });
```

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run tests/unit/cloud/aws/public-ip.test.ts`
Expected: both tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cloud/aws/public-ip.ts tests/unit/cloud/aws/public-ip.test.ts
git commit -m "feat(cloud/aws): detect deployer public IP for SSH allow rule"
```

#### Task G6: AWS provider class

**Files:**
- Create: `src/cloud/aws/provider.ts`

- [ ] **Step 1: Implement `src/cloud/aws/provider.ts`**

```typescript
import { EC2Client } from '@aws-sdk/client-ec2';
import type {
  CloudProvider,
  ImageRef,
  Instance,
  InstanceStatus,
  Location,
  ProvisionSpec,
  ResourceLedger,
} from '../core.js';
import { resolveNixosAmi } from './images.js';
import { provisionAws } from './provision.js';
import { destroyAws } from './destroy.js';
import { statusAws } from './status.js';

export interface AwsProviderOptions {
  region: string;
  profile?: string;
  imageCacheFile: string;
}

export class AwsProvider implements CloudProvider {
  readonly name = 'aws' as const;
  private readonly ec2: EC2Client;

  constructor(private readonly opts: AwsProviderOptions) {
    if (opts.profile) process.env.AWS_PROFILE = opts.profile;
    this.ec2 = new EC2Client({ region: opts.region });
  }

  async resolveNixosImage(_loc: Location): Promise<ImageRef> {
    return resolveNixosAmi(this.ec2, this.opts.region, this.opts.imageCacheFile);
  }

  provision(spec: ProvisionSpec, ledger: ResourceLedger): Promise<Instance> {
    return provisionAws(this.ec2, spec, ledger);
  }

  destroy(ledger: ResourceLedger): Promise<void> {
    return destroyAws(this.ec2, ledger);
  }

  status(ledger: ResourceLedger): Promise<InstanceStatus> {
    return statusAws(this.ec2, ledger);
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cloud/aws/provider.ts
git commit -m "feat(cloud/aws): wrap operations behind AwsProvider class"
```

---

### Phase H — Remote ops layer

#### Task H1: Wait-for-SSH helper

**Files:**
- Create: `src/remote-ops/wait-ssh.ts`
- Create: `tests/unit/remote-ops/wait-ssh.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:net';
import { waitForSshPort } from '../../../src/remote-ops/wait-ssh.js';

describe('waitForSshPort', () => {
  it('resolves once the port is reachable', async () => {
    const server = createServer().listen(0);
    await new Promise<void>(r => server.once('listening', () => r()));
    const port = (server.address() as any).port;
    await expect(
      waitForSshPort({ host: '127.0.0.1', port, timeoutMs: 2000 }),
    ).resolves.toBeUndefined();
    server.close();
  });

  it('rejects after the timeout if the port stays closed', async () => {
    await expect(
      waitForSshPort({ host: '127.0.0.1', port: 1, timeoutMs: 500 }),
    ).rejects.toThrow(/timeout/);
  });
});
```

- [ ] **Step 2: Implement `src/remote-ops/wait-ssh.ts`**

```typescript
import { createConnection } from 'node:net';

export interface WaitForSshOptions {
  host: string;
  port?: number;
  timeoutMs?: number;
}

export async function waitForSshPort(opts: WaitForSshOptions): Promise<void> {
  const port = opts.port ?? 22;
  const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
  const backoffSeq = [1000, 2000, 4000, 8000, 8000];
  let attempt = 0;

  while (Date.now() < deadline) {
    const ok = await tryConnect(opts.host, port);
    if (ok) return;
    const wait = backoffSeq[Math.min(attempt, backoffSeq.length - 1)]!;
    attempt++;
    await sleep(wait);
  }
  throw new Error(`timeout waiting for ${opts.host}:${port}`);
}

function tryConnect(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host, port, timeout: 2000 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
```

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run tests/unit/remote-ops/wait-ssh.test.ts`
Expected: both tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/remote-ops/wait-ssh.ts tests/unit/remote-ops/wait-ssh.test.ts
git commit -m "feat(remote-ops): wait-for-ssh with TCP poll and backoff"
```

#### Task H2: SSH session wrapper (ssh2)

**Files:**
- Create: `src/remote-ops/session.ts`
- Create: `tests/unit/remote-ops/session.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createSshSession } from '../../../src/remote-ops/session.js';

// We test the *interface* — the actual ssh2 connection happens against a real
// box during smoke tests. Here we use a mock Client.
class FakeStream {
  private listeners: Record<string, Array<(arg: any) => void>> = {};
  on(ev: string, cb: (arg: any) => void) {
    (this.listeners[ev] ||= []).push(cb);
    return this;
  }
  emit(ev: string, arg?: any) {
    for (const cb of this.listeners[ev] ?? []) cb(arg);
  }
  stderr = { on: (_e: string, _cb: any) => this };
}

class FakeClient {
  on = vi.fn();
  exec = vi.fn();
  end = vi.fn();
  connect = vi.fn();
}

describe('createSshSession', () => {
  it('runs a command and resolves with stdout', async () => {
    const fake = new FakeClient();
    const stream = new FakeStream();
    fake.exec.mockImplementation((_cmd: string, cb: any) => {
      cb(null, stream);
      setTimeout(() => {
        stream.emit('data', Buffer.from('hello'));
        stream.emit('close', 0);
      }, 5);
    });
    fake.on.mockImplementation((ev: string, cb: any) => {
      if (ev === 'ready') setTimeout(cb, 5);
      return fake;
    });

    const session = await createSshSession(
      { host: 'x', username: 'root', privateKey: 'key', port: 22 },
      fake as any,
    );
    const result = await session.exec('echo hello');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    await session.dispose();
    expect(fake.end).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement `src/remote-ops/session.ts`**

```typescript
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import { readFileSync } from 'node:fs';

export interface SshSessionConfig {
  host: string;
  username: string;
  privateKey: string | Buffer; // contents, not a path
  port?: number;
  readyTimeoutMs?: number;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface SshSession {
  exec(command: string): Promise<ExecResult>;
  execStream(
    command: string,
    onLine: (stream: 'stdout' | 'stderr', line: string) => void,
  ): Promise<ExecResult>;
  uploadFile(remotePath: string, contents: Buffer | string, mode?: number): Promise<void>;
  dispose(): Promise<void>;
}

export async function createSshSession(
  config: SshSessionConfig,
  clientImpl?: Client,
): Promise<SshSession> {
  const client = clientImpl ?? new Client();
  const connectConfig: ConnectConfig = {
    host: config.host,
    port: config.port ?? 22,
    username: config.username,
    privateKey: config.privateKey,
    readyTimeout: config.readyTimeoutMs ?? 30_000,
  };

  await new Promise<void>((resolve, reject) => {
    client.on('ready', () => resolve());
    client.on('error', err => reject(err));
    if (typeof (client as any).connect === 'function' && clientImpl === undefined) {
      client.connect(connectConfig);
    }
  });

  const exec = (command: string): Promise<ExecResult> =>
    new Promise((resolve, reject) => {
      client.exec(command, (err, stream: ClientChannel) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        let exitCode: number | null = null;
        stream.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
        stream.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        stream.on('exit', (code: number) => { exitCode = code; });
        stream.on('close', () => resolve({ exitCode, stdout, stderr }));
      });
    });

  const execStream = (
    command: string,
    onLine: (stream: 'stdout' | 'stderr', line: string) => void,
  ): Promise<ExecResult> =>
    new Promise((resolve, reject) => {
      client.exec(command, (err, stream: ClientChannel) => {
        if (err) return reject(err);
        let stdoutBuf = '';
        let stderrBuf = '';
        let stdoutAll = '';
        let stderrAll = '';
        let exitCode: number | null = null;

        const flush = (which: 'stdout' | 'stderr') => {
          const buf = which === 'stdout' ? stdoutBuf : stderrBuf;
          const lines = buf.split('\n');
          for (let i = 0; i < lines.length - 1; i++) onLine(which, lines[i]!);
          if (which === 'stdout') stdoutBuf = lines[lines.length - 1]!;
          else stderrBuf = lines[lines.length - 1]!;
        };

        stream.on('data', (chunk: Buffer) => {
          stdoutAll += chunk.toString();
          stdoutBuf += chunk.toString();
          flush('stdout');
        });
        stream.stderr.on('data', (chunk: Buffer) => {
          stderrAll += chunk.toString();
          stderrBuf += chunk.toString();
          flush('stderr');
        });
        stream.on('exit', (code: number) => { exitCode = code; });
        stream.on('close', () => {
          if (stdoutBuf) onLine('stdout', stdoutBuf);
          if (stderrBuf) onLine('stderr', stderrBuf);
          resolve({ exitCode, stdout: stdoutAll, stderr: stderrAll });
        });
      });
    });

  const uploadFile = (remotePath: string, contents: Buffer | string, mode = 0o644): Promise<void> =>
    new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        const stream = sftp.createWriteStream(remotePath, { mode });
        stream.on('error', reject);
        stream.on('close', () => resolve());
        stream.end(typeof contents === 'string' ? Buffer.from(contents) : contents);
      });
    });

  const dispose = (): Promise<void> => {
    client.end();
    return Promise.resolve();
  };

  return { exec, execStream, uploadFile, dispose };
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run tests/unit/remote-ops/session.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/remote-ops/session.ts tests/unit/remote-ops/session.test.ts
git commit -m "feat(remote-ops): ssh2 session wrapper with exec, stream, and sftp upload"
```

#### Task H3: nixos-rebuild over SSH with line streaming

**Files:**
- Create: `src/remote-ops/nixos-rebuild.ts`
- Create: `tests/unit/remote-ops/nixos-rebuild.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runNixosRebuild } from '../../../src/remote-ops/nixos-rebuild.js';
import type { SshSession } from '../../../src/remote-ops/session.js';

function makeFakeSession(exitCode: number, lines: Array<[string, string]> = []) {
  const fake: Partial<SshSession> = {
    execStream: vi.fn(async (_cmd, onLine) => {
      for (const [s, l] of lines) onLine(s as any, l);
      return { exitCode, stdout: lines.map(l => l[1]).join('\n'), stderr: '' };
    }),
  };
  return fake as SshSession;
}

describe('runNixosRebuild', () => {
  it('returns success on exit code 0', async () => {
    const session = makeFakeSession(0, [['stdout', 'building...'], ['stdout', 'done']]);
    const result = await runNixosRebuild(session, () => {});
    expect(result.success).toBe(true);
  });

  it('returns failure on non-zero exit and captures the tail', async () => {
    const lines: Array<[string, string]> = [];
    for (let i = 0; i < 60; i++) lines.push(['stdout', `line ${i}`]);
    lines.push(['stderr', 'error: build failed']);
    const session = makeFakeSession(1, lines);
    const result = await runNixosRebuild(session, () => {});
    expect(result.success).toBe(false);
    expect(result.tail.length).toBeLessThanOrEqual(50);
    expect(result.tail.join('\n')).toContain('error: build failed');
  });
});
```

- [ ] **Step 2: Implement `src/remote-ops/nixos-rebuild.ts`**

```typescript
import type { SshSession } from './session.js';

export interface RebuildResult {
  success: boolean;
  tail: string[];
}

const TAIL_LINES = 50;

export async function runNixosRebuild(
  session: SshSession,
  onLine: (stream: 'stdout' | 'stderr', line: string) => void,
): Promise<RebuildResult> {
  const ring: string[] = [];
  const result = await session.execStream('nixos-rebuild switch 2>&1', (stream, line) => {
    ring.push(line);
    if (ring.length > TAIL_LINES) ring.shift();
    onLine(stream, line);
  });
  return { success: result.exitCode === 0, tail: ring };
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run tests/unit/remote-ops/nixos-rebuild.test.ts`
Expected: both tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/remote-ops/nixos-rebuild.ts tests/unit/remote-ops/nixos-rebuild.test.ts
git commit -m "feat(remote-ops): run nixos-rebuild over SSH with rolling tail"
```

#### Task H4: Healthcheck poll

**Files:**
- Create: `src/remote-ops/healthcheck.ts`
- Create: `tests/unit/remote-ops/healthcheck.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { pollHermesHealth } from '../../../src/remote-ops/healthcheck.js';
import type { SshSession } from '../../../src/remote-ops/session.js';

function fakeSession(responses: Array<{ exitCode: number; stdout: string }>) {
  let i = 0;
  const fake: Partial<SshSession> = {
    exec: vi.fn(async () => {
      const r = responses[i++] ?? responses[responses.length - 1]!;
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: '' };
    }),
  };
  return fake as SshSession;
}

describe('pollHermesHealth', () => {
  it('returns healthy when systemctl is-active returns active immediately', async () => {
    const session = fakeSession([{ exitCode: 0, stdout: 'active' }]);
    const result = await pollHermesHealth(session, { intervalMs: 10, timeoutMs: 1000 });
    expect(result.health).toBe('healthy');
  });

  it('returns unhealthy with journal tail when never active within timeout', async () => {
    const session = fakeSession([
      { exitCode: 3, stdout: 'activating' },
      { exitCode: 3, stdout: 'failed' },
      { exitCode: 0, stdout: 'line 1\nline 2\nline 3' }, // journalctl call
    ]);
    const result = await pollHermesHealth(session, { intervalMs: 10, timeoutMs: 50 });
    expect(result.health).toBe('unhealthy');
    expect(result.journalTail.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement `src/remote-ops/healthcheck.ts`**

```typescript
import type { SshSession } from './session.js';

export interface HealthcheckOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export interface HealthcheckResult {
  health: 'healthy' | 'unhealthy';
  journalTail: string[];
}

export async function pollHermesHealth(
  session: SshSession,
  opts: HealthcheckOptions = {},
): Promise<HealthcheckResult> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const r = await session.exec('systemctl is-active hermes-agent.service');
    if (r.exitCode === 0 && r.stdout.trim() === 'active') {
      return { health: 'healthy', journalTail: [] };
    }
    await new Promise(res => setTimeout(res, intervalMs));
  }

  const journal = await session.exec(
    'journalctl -u hermes-agent.service -n 50 --no-pager',
  );
  return {
    health: 'unhealthy',
    journalTail: journal.stdout.split('\n').filter(Boolean),
  };
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run tests/unit/remote-ops/healthcheck.test.ts`
Expected: both tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/remote-ops/healthcheck.ts tests/unit/remote-ops/healthcheck.test.ts
git commit -m "feat(remote-ops): poll systemctl is-active with journal tail on failure"
```

---

### Phase I — Orchestrator

The orchestrator is the lifecycle state machine. Each task below corresponds to one phase from spec §8.1. Tests use a fake CloudProvider and fake SshSession so we exercise the orchestration logic without real cloud or SSH.

#### Task I1: Reporter (plain-text progress reporter)

**Files:**
- Create: `src/orchestrator/reporter.ts`

- [ ] **Step 1: Implement `src/orchestrator/reporter.ts`**

```typescript
export type PhaseId =
  | 'validate'
  | 'ensure-keys'
  | 'provision'
  | 'wait-ssh'
  | 'bootstrap'
  | 'healthcheck';

export interface Reporter {
  phaseStart(id: PhaseId, label: string): void;
  phaseDone(id: PhaseId): void;
  phaseFail(id: PhaseId, error: string): void;
  log(line: string): void;
  success(summary: string): void;
}

export function createPlainReporter(): Reporter {
  const start = Date.now();
  return {
    phaseStart(_id, label) {
      console.log(`▸ ${label}...`);
    },
    phaseDone(_id) {
      console.log('  ✓');
    },
    phaseFail(_id, error) {
      console.error(`  ✗ ${error}`);
    },
    log(line) {
      console.log(`    ${line}`);
    },
    success(summary) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`\n✔ ${summary} (${elapsed}s)`);
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/orchestrator/reporter.ts
git commit -m "feat(orchestrator): plain-text progress reporter for M1"
```

#### Task I2: Deploy orchestrator (phases 1-5)

**Files:**
- Create: `src/orchestrator/deploy.ts`
- Create: `tests/unit/orchestrator/deploy.test.ts`

- [ ] **Step 1: Write the failing test (happy path with fake provider and fake session)**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDeploy } from '../../../src/orchestrator/deploy.js';
import type { CloudProvider, Instance, ResourceLedger } from '../../../src/cloud/core.js';
import type { SshSession } from '../../../src/remote-ops/session.js';

function fakeProvider(): CloudProvider {
  return {
    name: 'aws',
    resolveNixosImage: vi.fn(async () => ({ id: 'ami-1', description: 'nixos' })),
    provision: vi.fn(async (_spec, ledger) => {
      if (ledger.kind === 'aws') {
        ledger.resources.instance_id = 'i-1';
        ledger.resources.security_group_id = 'sg-1';
        ledger.resources.key_pair_name = 'kp-1';
        ledger.resources.eip_allocation_id = 'eipalloc-1';
        ledger.resources.region = 'eu-west-3';
      }
      return { publicIp: '203.0.113.42', sshUser: 'root' };
    }),
    destroy: vi.fn(async () => {}),
    status: vi.fn(async () => ({ state: 'running', publicIp: '203.0.113.42' })),
  };
}

function fakeSession(): SshSession {
  return {
    exec: vi.fn(async () => ({ exitCode: 0, stdout: 'active', stderr: '' })),
    execStream: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    uploadFile: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

describe('runDeploy (happy path)', () => {
  let projectDir: string;
  let configDir: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-deploy-'));
    projectDir = join(root, 'project');
    configDir = join(root, 'config');
    mkdirSync(projectDir);
    mkdirSync(configDir);
    writeFileSync(join(projectDir, 'hermes.toml'), `
name = "test"
[cloud]
provider = "aws"
profile = "default"
region = "eu-west-3"
size = "small"
[hermes]
model = "m"
soul = "./SOUL.md"
secrets_file = "./secrets.enc.yaml"
[hermes.platforms.discord]
enabled = true
token_key = "k"
`);
    writeFileSync(join(projectDir, 'SOUL.md'), '# soul');
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('runs all phases and updates state', async () => {
    process.env.XDG_CONFIG_HOME = configDir;

    const provider = fakeProvider();
    const result = await runDeploy({
      projectDir,
      provider,
      sessionFactory: async () => fakeSession(),
      detectPublicIp: async () => '203.0.113.1/32',
      ageKeyGenerator: async () => ({ publicKey: 'age1abc', privateKeyPath: 'mocked' }),
      sshKeyGenerator: async () => ({ publicKey: 'ssh-ed25519 AAAA test', privateKeyPath: 'mocked', publicKeyPath: 'mocked' }),
      sopsBootstrap: async () => {},
      waitSsh: async () => {},
    });

    expect(result.health).toBe('healthy');
    expect(result.publicIp).toBe('203.0.113.42');
    expect(provider.provision).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Implement `src/orchestrator/deploy.ts`**

```typescript
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { loadHermesToml, HermesTomlError } from '../schema/load.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import { computeConfigHash } from '../state/hash.js';
import { generateHermesNix, generateConfigurationNix } from '../nix-gen/generate.js';
import { runNixosRebuild } from '../remote-ops/nixos-rebuild.js';
import { pollHermesHealth } from '../remote-ops/healthcheck.js';
import type { CloudProvider, ProvisionSpec, ResourceLedger } from '../cloud/core.js';
import type { SshSession } from '../remote-ops/session.js';
import { createPlainReporter, type Reporter } from './reporter.js';

export interface DeployOptions {
  projectDir: string;
  provider: CloudProvider;
  sessionFactory: (host: string, privateKey: string) => Promise<SshSession>;
  detectPublicIp: () => Promise<string>;
  sshKeyGenerator: (path: string) => Promise<{ publicKey: string; privateKeyPath: string; publicKeyPath: string }>;
  ageKeyGenerator: (path: string) => Promise<{ publicKey: string; privateKeyPath: string }>;
  sopsBootstrap: (projectDir: string, agePublicKey: string) => Promise<void>;
  waitSsh: (host: string) => Promise<void>;
  reporter?: Reporter;
}

export interface DeployResult {
  health: 'healthy' | 'unhealthy';
  publicIp: string;
}

export async function runDeploy(opts: DeployOptions): Promise<DeployResult> {
  const reporter = opts.reporter ?? createPlainReporter();
  const paths = getStatePaths();
  const store = new StateStore(paths);

  // === Phase 1 — local validation ===
  reporter.phaseStart('validate', 'Validating project configuration');
  const tomlPath = join(opts.projectDir, 'hermes.toml');
  const config = loadHermesToml(tomlPath);
  const soulPath = pathResolve(opts.projectDir, config.hermes.soul);
  if (!existsSync(soulPath)) {
    throw new HermesTomlError(`SOUL file not found: ${soulPath}`);
  }
  reporter.phaseDone('validate');

  // === Phase 1.5 — ensure SSH and age keys exist ===
  reporter.phaseStart('ensure-keys', 'Preparing SSH and age keys');
  const sshKeyPath = paths.sshKeyForDeployment(config.name);
  const ageKeyPath = paths.ageKeyForDeployment(config.name);

  let sshPublicKey: string;
  if (existsSync(sshKeyPath)) {
    sshPublicKey = readFileSync(`${sshKeyPath}.pub`, 'utf-8').trim();
  } else {
    const ssh = await opts.sshKeyGenerator(sshKeyPath);
    sshPublicKey = ssh.publicKey;
  }

  let agePublicKey: string;
  if (existsSync(ageKeyPath)) {
    const content = readFileSync(ageKeyPath, 'utf-8');
    const m = content.match(/^# public key: (age1[a-z0-9]+)$/m);
    if (!m) throw new Error(`could not read age public key from ${ageKeyPath}`);
    agePublicKey = m[1]!;
  } else {
    const age = await opts.ageKeyGenerator(ageKeyPath);
    agePublicKey = age.publicKey;
  }

  await opts.sopsBootstrap(opts.projectDir, agePublicKey);
  reporter.phaseDone('ensure-keys');

  // === Phase 2 — provision ===
  reporter.phaseStart('provision', 'Provisioning AWS resources');
  const image = await opts.provider.resolveNixosImage({
    region: config.cloud.region,
    zone: config.cloud.zone,
  });
  const sshAllowedFrom =
    config.network.ssh_allowed_from === 'auto'
      ? await opts.detectPublicIp()
      : config.network.ssh_allowed_from;

  const ledger: ResourceLedger = { kind: 'aws', resources: {} };
  const spec: ProvisionSpec = {
    deploymentName: config.name,
    location: { region: config.cloud.region, zone: config.cloud.zone },
    size: config.cloud.size,
    image,
    publicSshKey: sshPublicKey,
    networkRules: {
      sshAllowedFrom,
      inboundPorts: config.network.inbound_ports,
    },
  };
  const instance = await opts.provider.provision(spec, ledger);

  // Persist ledger BEFORE SSH bootstrap
  await store.update(state => {
    const now = new Date().toISOString();
    state.deployments[config.name] = {
      project_path: opts.projectDir,
      cloud: 'aws',
      region: config.cloud.region,
      created_at: state.deployments[config.name]?.created_at ?? now,
      last_deployed_at: now,
      last_config_hash: '', // updated in phase 5
      ssh_key_path: sshKeyPath,
      age_key_path: ageKeyPath,
      health: 'unknown',
      instance_ip: instance.publicIp,
      cloud_resources: {
        instance_id: ledger.resources.instance_id!,
        security_group_id: ledger.resources.security_group_id!,
        key_pair_name: ledger.resources.key_pair_name!,
        eip_allocation_id: ledger.resources.eip_allocation_id!,
        region: ledger.resources.region!,
      },
    };
  });
  reporter.phaseDone('provision');

  // === Phase 3 — wait for SSH ===
  reporter.phaseStart('wait-ssh', `Waiting for SSH on ${instance.publicIp}`);
  await opts.waitSsh(instance.publicIp);
  reporter.phaseDone('wait-ssh');

  // === Phase 4 — bootstrap NixOS configuration ===
  reporter.phaseStart('bootstrap', 'Uploading config and running nixos-rebuild');
  const privateKeyContent = readFileSync(sshKeyPath, 'utf-8');
  const session = await opts.sessionFactory(instance.publicIp, privateKeyContent);
  try {
    const configurationNix = generateConfigurationNix();
    const hermesNix = generateHermesNix(config);
    const ageKeyContent = readFileSync(ageKeyPath, 'utf-8');
    const secretsContent = readFileSync(
      pathResolve(opts.projectDir, config.hermes.secrets_file),
    );

    await session.uploadFile('/etc/nixos/configuration.nix', configurationNix);
    await session.uploadFile('/etc/nixos/hermes.nix', hermesNix);
    await session.uploadFile('/etc/nixos/secrets.enc.yaml', secretsContent);
    await session.uploadFile('/var/lib/sops-nix/age.key', ageKeyContent, 0o600);

    const rebuild = await runNixosRebuild(session, (_s, line) => reporter.log(line));
    if (!rebuild.success) {
      throw new Error(`nixos-rebuild failed:\n${rebuild.tail.join('\n')}`);
    }
    reporter.phaseDone('bootstrap');

    // === Phase 5 — healthcheck and state update ===
    reporter.phaseStart('healthcheck', 'Waiting for hermes-agent.service');
    const configHash = computeConfigHash(
      [
        tomlPath,
        pathResolve(opts.projectDir, config.hermes.secrets_file),
        config.hermes.nix_extra
          ? pathResolve(opts.projectDir, config.hermes.nix_extra.file)
          : '',
      ].filter(Boolean),
      true,
    );

    await store.update(state => {
      const d = state.deployments[config.name]!;
      d.last_config_hash = configHash;
      d.last_deployed_at = new Date().toISOString();
    });

    const health = await pollHermesHealth(session);
    await store.update(state => {
      state.deployments[config.name]!.health = health.health;
    });

    if (health.health === 'unhealthy') {
      reporter.phaseFail('healthcheck', 'service is not active');
      for (const line of health.journalTail) reporter.log(line);
      return { health: 'unhealthy', publicIp: instance.publicIp };
    }
    reporter.phaseDone('healthcheck');
    reporter.success(`hermes-agent is running at ${instance.publicIp}`);
    return { health: 'healthy', publicIp: instance.publicIp };
  } finally {
    await session.dispose();
  }
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run tests/unit/orchestrator/deploy.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/deploy.ts tests/unit/orchestrator/deploy.test.ts
git commit -m "feat(orchestrator): implement deploy flow phases 1-5"
```

#### Task I3: Destroy orchestrator

**Files:**
- Create: `src/orchestrator/destroy.ts`
- Create: `tests/unit/orchestrator/destroy.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDestroy } from '../../../src/orchestrator/destroy.js';
import type { CloudProvider } from '../../../src/cloud/core.js';
import { StateStore } from '../../../src/state/store.js';
import { getStatePaths } from '../../../src/state/paths.js';

function fakeProvider(destroyImpl?: () => Promise<void>): CloudProvider {
  return {
    name: 'aws',
    resolveNixosImage: vi.fn(),
    provision: vi.fn(),
    destroy: vi.fn(destroyImpl ?? (async () => {})),
    status: vi.fn(),
  } as any;
}

describe('runDestroy', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'hermes-destroy-'));
    process.env.XDG_CONFIG_HOME = configDir;
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('calls provider.destroy and removes the state entry', async () => {
    const store = new StateStore(getStatePaths());
    await store.update(state => {
      state.deployments['test'] = {
        project_path: '/x',
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-09T00:00:00Z',
        last_deployed_at: '2026-04-09T00:00:00Z',
        last_config_hash: 'sha256:x',
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
      };
    });

    const provider = fakeProvider();
    await runDestroy({ deploymentName: 'test', provider });

    expect(provider.destroy).toHaveBeenCalled();
    const state = await store.read();
    expect(state.deployments['test']).toBeUndefined();
  });

  it('throws if the deployment is not in state', async () => {
    const provider = fakeProvider();
    await expect(runDestroy({ deploymentName: 'missing', provider })).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Implement `src/orchestrator/destroy.ts`**

```typescript
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import type { CloudProvider, ResourceLedger } from '../cloud/core.js';
import { createPlainReporter, type Reporter } from './reporter.js';

export interface DestroyOptions {
  deploymentName: string;
  provider: CloudProvider;
  reporter?: Reporter;
}

export async function runDestroy(opts: DestroyOptions): Promise<void> {
  const reporter = opts.reporter ?? createPlainReporter();
  const store = new StateStore(getStatePaths());
  const state = await store.read();
  const deployment = state.deployments[opts.deploymentName];
  if (!deployment) {
    throw new Error(`deployment "${opts.deploymentName}" not found in state`);
  }

  const ledger: ResourceLedger = {
    kind: 'aws',
    resources: { ...(deployment.cloud_resources as any) },
  };

  reporter.phaseStart('provision', `Destroying ${opts.deploymentName} on ${deployment.cloud}`);
  await opts.provider.destroy(ledger);
  reporter.phaseDone('provision');

  await store.update(s => {
    delete s.deployments[opts.deploymentName];
  });

  reporter.success(`removed ${opts.deploymentName}`);
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run tests/unit/orchestrator/destroy.test.ts`
Expected: both tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/destroy.ts tests/unit/orchestrator/destroy.test.ts
git commit -m "feat(orchestrator): implement destroy flow"
```

---

### Phase J — CLI commands

#### Task J1: argv router and `up` command

**Files:**
- Create: `src/cli.ts`
- Create: `src/commands/up.ts`

- [ ] **Step 1: Implement `src/commands/up.ts`**

```typescript
import { findUp } from './find-project.js';
import { loadHermesToml } from '../schema/load.js';
import { runDeploy } from '../orchestrator/deploy.js';
import { AwsProvider } from '../cloud/aws/provider.js';
import { getStatePaths } from '../state/paths.js';
import { createSshSession } from '../remote-ops/session.js';
import { waitForSshPort } from '../remote-ops/wait-ssh.js';
import { detectPublicIp } from '../cloud/aws/public-ip.js';
import { generateSshKeypair } from '../crypto/ssh-keygen.js';
import { generateAgeKeypair } from '../crypto/age-keygen.js';
import { ensureSopsBootstrap } from '../sops/bootstrap.js';

export async function upCommand(_opts: Record<string, unknown>): Promise<void> {
  const projectDir = findUp(process.cwd(), 'hermes.toml');
  if (!projectDir) {
    throw new Error('no hermes.toml found in current directory or any parent');
  }
  const config = loadHermesToml(`${projectDir}/hermes.toml`);
  if (config.cloud.provider !== 'aws') {
    throw new Error(`M1 only supports cloud.provider = "aws" (got "${config.cloud.provider}")`);
  }

  const paths = getStatePaths();
  const provider = new AwsProvider({
    region: config.cloud.region,
    profile: config.cloud.profile,
    imageCacheFile: paths.imageCacheFile,
  });

  const result = await runDeploy({
    projectDir,
    provider,
    sessionFactory: (host, privateKey) =>
      createSshSession({ host, username: 'root', privateKey }),
    detectPublicIp: () => detectPublicIp(),
    sshKeyGenerator: async (path) => generateSshKeypair(path),
    ageKeyGenerator: async (path) => generateAgeKeypair(path),
    sopsBootstrap: async (dir, key) => ensureSopsBootstrap(dir, key),
    waitSsh: (host) => waitForSshPort({ host }),
  });

  if (result.health === 'unhealthy') process.exit(1);
}
```

- [ ] **Step 2: Implement `src/commands/find-project.ts`**

```typescript
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

export function findUp(startDir: string, filename: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, filename))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
```

- [ ] **Step 3: Implement `src/cli.ts`**

```typescript
import { Command } from 'commander';
import { upCommand } from './commands/up.js';
import { destroyCommand } from './commands/destroy.js';
import { statusCommand } from './commands/status.js';
import { sshCommand } from './commands/ssh.js';

const program = new Command();

program
  .name('hermes-deploy')
  .description('Deploy hermes-agent to AWS or GCP')
  .version('0.1.0-m1');

program
  .command('up')
  .description('Provision and configure the deployment defined by ./hermes.toml')
  .action(async () => {
    try {
      await upCommand({});
    } catch (e) {
      console.error(`hermes-deploy up: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('destroy')
  .argument('[name]', 'deployment name (defaults to the name in ./hermes.toml)')
  .option('--yes', 'skip confirmation prompt')
  .action(async (name, opts) => {
    try {
      await destroyCommand({ name, yes: opts.yes });
    } catch (e) {
      console.error(`hermes-deploy destroy: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('status')
  .argument('[name]', 'deployment name (defaults to ./hermes.toml)')
  .action(async (name) => {
    try {
      await statusCommand({ name });
    } catch (e) {
      console.error(`hermes-deploy status: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('ssh')
  .argument('[name]', 'deployment name (defaults to ./hermes.toml)')
  .action(async (name) => {
    try {
      await sshCommand({ name });
    } catch (e) {
      console.error(`hermes-deploy ssh: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: `dist/cli.js` produced, no errors. (Other commands won't exist yet — see J2-J4. To unblock typecheck temporarily, stub them.)

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/commands/up.ts src/commands/find-project.ts
git commit -m "feat(cli): up command and argv router skeleton"
```

#### Task J2: `destroy` command

**Files:**
- Create: `src/commands/destroy.ts`

- [ ] **Step 1: Implement `src/commands/destroy.ts`**

```typescript
import { findUp } from './find-project.js';
import { loadHermesToml } from '../schema/load.js';
import { runDestroy } from '../orchestrator/destroy.js';
import { AwsProvider } from '../cloud/aws/provider.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';
import { createInterface } from 'node:readline/promises';

export async function destroyCommand(opts: { name?: string; yes?: boolean }): Promise<void> {
  const paths = getStatePaths();
  const store = new StateStore(paths);
  const state = await store.read();

  let name = opts.name;
  if (!name) {
    const projectDir = findUp(process.cwd(), 'hermes.toml');
    if (!projectDir) throw new Error('no name given and no hermes.toml in cwd');
    name = loadHermesToml(`${projectDir}/hermes.toml`).name;
  }

  const deployment = state.deployments[name];
  if (!deployment) throw new Error(`deployment "${name}" not found in state`);

  if (!opts.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `Destroy "${name}" (${deployment.cloud}, ${deployment.region}, ${deployment.instance_ip})? [y/N] `,
    );
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('aborted');
      return;
    }
  }

  const provider = new AwsProvider({
    region: deployment.region,
    imageCacheFile: paths.imageCacheFile,
  });

  await runDestroy({ deploymentName: name, provider });
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/commands/destroy.ts
git commit -m "feat(cli): destroy command with confirmation prompt"
```

#### Task J3: `status` command

**Files:**
- Create: `src/commands/status.ts`

- [ ] **Step 1: Implement `src/commands/status.ts`**

```typescript
import { findUp } from './find-project.js';
import { loadHermesToml } from '../schema/load.js';
import { AwsProvider } from '../cloud/aws/provider.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';

export async function statusCommand(opts: { name?: string }): Promise<void> {
  const paths = getStatePaths();
  const store = new StateStore(paths);
  const state = await store.read();

  let name = opts.name;
  if (!name) {
    const projectDir = findUp(process.cwd(), 'hermes.toml');
    if (!projectDir) throw new Error('no name given and no hermes.toml in cwd');
    name = loadHermesToml(`${projectDir}/hermes.toml`).name;
  }

  const deployment = state.deployments[name];
  if (!deployment) {
    console.log(`No deployment named "${name}" found in state.`);
    return;
  }

  const provider = new AwsProvider({
    region: deployment.region,
    imageCacheFile: paths.imageCacheFile,
  });

  const live = await provider.status({
    kind: 'aws',
    resources: deployment.cloud_resources as any,
  });

  console.log(`Deployment:    ${name}`);
  console.log(`  Cloud:       ${deployment.cloud}`);
  console.log(`  Region:      ${deployment.region}`);
  console.log(`  Instance:    ${live.state}`);
  console.log(`  Public IP:   ${live.publicIp ?? '(none)'}`);
  console.log(`  Last config: ${deployment.last_config_hash}`);
  console.log(`  Health:      ${deployment.health}`);
  console.log(`  Deployed at: ${deployment.last_deployed_at}`);
  console.log(`  SSH key:     ${deployment.ssh_key_path}`);
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/commands/status.ts
git commit -m "feat(cli): status command showing live and stored state"
```

#### Task J4: `ssh` command

**Files:**
- Create: `src/commands/ssh.ts`

- [ ] **Step 1: Implement `src/commands/ssh.ts`**

```typescript
import { spawn } from 'node:child_process';
import { findUp } from './find-project.js';
import { loadHermesToml } from '../schema/load.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';

export async function sshCommand(opts: { name?: string }): Promise<void> {
  const paths = getStatePaths();
  const store = new StateStore(paths);
  const state = await store.read();

  let name = opts.name;
  if (!name) {
    const projectDir = findUp(process.cwd(), 'hermes.toml');
    if (!projectDir) throw new Error('no name given and no hermes.toml in cwd');
    name = loadHermesToml(`${projectDir}/hermes.toml`).name;
  }

  const deployment = state.deployments[name];
  if (!deployment) throw new Error(`deployment "${name}" not found in state`);

  // Exec system ssh; replaces this process so the user gets a real interactive shell
  const args = [
    '-i', deployment.ssh_key_path,
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'StrictHostKeyChecking=no',
    `root@${deployment.instance_ip}`,
  ];
  const child = spawn('ssh', args, { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Verify the bin runs end-to-end (no real cloud)**

Run: `./dist/cli.js --help`
Expected: prints commands `up`, `destroy`, `status`, `ssh`.

- [ ] **Step 4: Commit**

```bash
git add src/commands/ssh.ts
git commit -m "feat(cli): ssh command exec'ing system ssh with stored key"
```

---

### Phase K — Documentation and smoke test

#### Task K1: README with smoke-test instructions

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# hermes-deploy

A CLI for deploying [hermes-agent](https://hermes-agent.nousresearch.com/) to a cloud VPS in one command.

> **Status: M1 (AWS skateboard).** This release supports AWS only, with `up`, `destroy`, `status`, and `ssh`. No `update`, no GCP, no Ink UI yet. See `docs/specs/2026-04-09-hermes-deploy-design.md` for the full v1 design.

## Prerequisites

On the machine running `hermes-deploy`:

- Node 20 or newer
- `age-keygen` and `sops` on PATH (`brew install age sops` on macOS)
- `ssh` on PATH
- AWS credentials configured (`~/.aws/credentials` or `AWS_*` env vars)

On the AWS account:

- An IAM user/role with permissions to create EC2 key pairs, security groups, instances, and elastic IPs
- A region where NixOS publishes community AMIs (e.g. `us-east-1`, `eu-west-3`, `ap-southeast-1`)

## Install (M1: from source)

```bash
git clone <this repo>
cd hermes-deploy
npm install
npm run build
npm link  # makes `hermes-deploy` available globally
```

## Smoke test: deploy, status, ssh, destroy

Create a project directory:

```bash
mkdir -p ~/hermes-test/discord-bot && cd ~/hermes-test/discord-bot
cat > hermes.toml <<'EOF'
name = "smoketest"

[cloud]
provider = "aws"
profile = "default"
region = "eu-west-3"
size = "small"

[hermes]
model = "anthropic/claude-sonnet-4-5"
soul = "./SOUL.md"
secrets_file = "./secrets.enc.yaml"

[hermes.platforms.discord]
enabled = true
token_key = "discord_bot_token"
EOF

cat > SOUL.md <<'EOF'
# Smoke test soul
You are a helpful test bot.
EOF
```

Run `hermes-deploy up`. The CLI will:

1. Validate the config.
2. Generate an ed25519 SSH keypair under `~/.config/hermes-deploy/ssh_keys/smoketest`.
3. Generate an age keypair under `~/.config/hermes-deploy/age_keys/smoketest`.
4. Create `.sops.yaml` and an empty encrypted `secrets.enc.yaml` in the project dir.
5. Resolve the latest NixOS AMI for `eu-west-3`.
6. Provision a `t3.small` with a security group allowing SSH from your current public IP.
7. SSH in, upload `configuration.nix`, `hermes.nix`, `secrets.enc.yaml`, and the age key.
8. Run `nixos-rebuild switch` (3-8 minutes on first deploy — Nix store is cold).
9. Wait for `hermes-agent.service` to be active.

You'll need to add real secrets before the agent can connect to Discord:

```bash
sops secrets.enc.yaml
# add: discord_bot_token: "<real bot token>"
```

Then re-run the relevant pieces by hand (no `update` command in M1):

```bash
hermes-deploy ssh smoketest
# inside the box:
sudo nixos-rebuild switch
```

Inspect:

```bash
hermes-deploy status smoketest
```

Tear down:

```bash
hermes-deploy destroy smoketest --yes
```

## State and key file locations

- `~/.config/hermes-deploy/state.toml` — global state (one entry per deployment)
- `~/.config/hermes-deploy/ssh_keys/<name>` — per-deployment SSH private key
- `~/.config/hermes-deploy/age_keys/<name>` — per-deployment age private key
- `~/.cache/hermes-deploy/images.json` — 1-hour AMI lookup cache

## What's deferred to M2

`update`, `logs`, `ls`, `init`, `secret` subcommands, `--name` flag for cross-directory lookup, multi-instance management, schema migrations, Ink UI, GCP. See `docs/plans/` for the M2 plan when it lands.

## License

Apache 2.0.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with M1 smoke-test instructions"
```

---

## Self-Review

After finishing all 32 tasks (across 11 phases), run this checklist:

### Spec coverage

| Spec section | Implementing tasks |
|---|---|
| §3 row 1 (Local CLI) | J1-J4 |
| §3 row 4 (NixOS image, native module) | D1, I2 |
| §3 row 5 (Community NixOS AMIs) | G1 |
| §3 row 6 (Full lifecycle subset) | J1-J4 (M1 omits update/logs/ls/init by design) |
| §3 row 7 (Per-project + global state) | C1, C2, J1-J4 |
| §3 row 8 (TOML wrapper + Nix escape hatch) | B1, B3, D1 |
| §3 row 9 (sops-nix) | E2, E3, I2 |
| §3 row 10 (Standard SDK creds) | G6, J1 |
| §3 row 11 (TypeScript) | A1-A2 |
| §3 row 12 (Direct cloud SDKs) | G1-G6 |
| §3 row 13 (Networking defaults) | G2, G5 |
| §4.2 (CloudProvider opaque ledger) | F1, G1-G6 |
| §6.1 (`hermes.toml` schema) | B1 |
| §7 (Global state file) | B2, C1-C3 |
| §8.1 phase 1 (validation) | I2 |
| §8.1 phase 1.5 (key bootstrap) | I2 |
| §8.1 phase 2 (provision) | G2, I2 |
| §8.1 phase 3 (wait SSH) | H1, I2 |
| §8.1 phase 4 (bootstrap NixOS) | H2, H3, I2 |
| §8.1 phase 5 (healthcheck + state, both paths) | H4, I2 |
| §8.3 (sops bootstrap) | E2, E3 |
| §9 (failure modes — those reachable in M1) | G2 (rollback), G3 (idempotency), I2 (healthcheck unhealthy path), C2 (state validation, locking) |

Spec items NOT covered in M1 (all explicitly deferred per "M1 Scope → Deferred"):

- §5 commands `init`, `update`, `logs`, `ls`
- §5 `secret set/get/rm/edit` subcommands
- §5 `--name` cross-directory resolution
- §5.1 multi-instance UX
- §6.2 instance type override (escape hatch only)
- §7.1 schema migration runner (only the version literal is checked)
- §8.2 update flow (no command yet)
- §10 testing strategy beyond unit tests
- §11 monorepo workspaces (single package)
- §12 distribution / release tooling
- §13 every entry — all permanently or post-M1

### Placeholder scan

Search the plan for: TBD, TODO, "fill in", "similar to", "appropriate", "validation", "error handling". None should remain in task descriptions or code blocks.

### Type consistency check

- `HermesTomlConfig` is the type returned by `loadHermesToml` (B3) and consumed by `generateHermesNix` (D1) and `runDeploy` (I2). ✓
- `ResourceLedger` is created in `runDeploy` (I2), passed to `provider.provision` (G2/G6), persisted in state (C2), and re-loaded in `runDestroy` (I3). ✓
- `SshSession` is created by `createSshSession` (H2), used by `runNixosRebuild` (H3) and `pollHermesHealth` (H4) and `runDeploy` (I2). ✓
- `Reporter` interface is defined in I1 and consumed by I2 and I3. ✓
- `StatePaths` from C1 is consumed by C2 and J1-J4. ✓
- `CloudProvider` interface from F1 is implemented by `AwsProvider` (G6) and consumed by `runDeploy`/`runDestroy` (I2/I3). ✓

### Missing tasks audit

After self-review, no spec requirement listed in the M1 scope is unimplemented.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-04-09-hermes-deploy-M1-aws-skateboard.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Each task is small and self-contained, which is exactly what subagent dispatch is good at.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
