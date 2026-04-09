# hermes-deploy M2 — AWS Feature-Complete Implementation Plan

> **For agentic workers:** Use the `subagent-driven-development` skill (recommended) or the `executing-plans` skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the M1 skateboard to feature-complete on AWS. Ship `update`, `logs`, `ls`, `init`, `secret`, and `key` subcommands; multi-instance `--name` resolution; schema migration scaffold; and the full Ink UI rewrite. After M2, a single user can manage many hermes-agent deployments across many client AWS accounts from one machine with the same muscle memory as Fly or Vercel CLI.

**Architecture:** Extends the M1 architecture without restructuring it. The 5-layer split (commands → orchestrator → cloud → state/schema/nix-gen → remote-ops) stays the same. New code lands in the layers it belongs to: `runUpdate` sits next to `runDeploy` in the orchestrator; `ls`/`logs`/`init`/`secret`/`key` commands sit next to `up`/`destroy`/`status`/`ssh`; the Ink renderer is a new `InkReporter` implementing the existing `Reporter` interface from M1's `src/orchestrator/reporter.ts`; schema migrations get their own `src/state/migrations.ts`.

**Tech Stack:** Inherits everything from M1. Adds `ink` (^5.x) + `react` (^18.x) as runtime deps for the TUI. Shells to `sops` for the `secret` subcommand (already a prereq from M1).

---

## M2 Scope

### In M2

| Capability | Notes |
|---|---|
| `hermes-deploy update` | Config-only push; skips provisioning entirely; reconciles network rules in place; typical run <90s |
| `hermes-deploy logs [<name>]` | Streams `journalctl -u hermes-agent -f` from the box until Ctrl-C |
| `hermes-deploy ls [--watch]` | Lists all deployments across all clouds from the global state, optionally polling live status |
| `hermes-deploy init` | Scaffolds `hermes.toml`, `SOUL.md`, `.gitignore` in the current directory |
| `hermes-deploy secret set/get/rm/edit/list` | Thin wrappers around `sops` with the right `SOPS_AGE_KEY_FILE` |
| `hermes-deploy key export/import/path` | Move the per-deployment age key between machines |
| `--name <name>` and `--project <path>` flags | Work on `up`, `destroy`, `update`, `status`, `logs`, `ssh` |
| Schema migration runner | Scaffold that reads `schema_version`, runs forward migrations in code, then validates. Fixture-tested with a synthetic v0→v1 migration. v1 remains the only "real" schema. |
| Ink UI | Deploy/update timeline (phase-status rows with live spinners), `ls --watch` dashboard, streaming log view. Auto-detected via TTY; opt-out via `--no-ink` or `HERMES_DEPLOY_NO_INK=1` |

### Deferred to M3+

- GCP provider implementation
- Cloud-native secret managers
- Packer-baked images
- Custom VPC / SSM-IAP / private-only networking
- E2E cloud test suite
- GitHub Actions CI / release-please / npm publish

### What M2 proves

You (or a first open-source tester) can:

1. `cd ~/clients/acme/bot && hermes-deploy init` → edit `hermes.toml` → `hermes-deploy secret set discord_token ...` → `hermes-deploy up`.
2. Watch a rich Ink timeline show each phase of the deploy.
3. Edit `hermes.toml`, run `hermes-deploy update` to push the change in ~60 seconds.
4. `hermes-deploy logs` to see what the agent is doing.
5. `hermes-deploy ls --watch` on a second monitor to keep tabs on all your client deployments.
6. Move the project to a second machine via `git clone` + `hermes-deploy key import acme-bot ~/age.key` + `hermes-deploy update`.

After M2, the tool is usable for real client work — you just can't deploy to GCP yet.

---

## File Structure

New files in M2 (on top of M1):

```
hermes-deploy/
├── src/
│   ├── cli.ts                        # MODIFIED: register update/logs/ls/init/secret/key
│   ├── commands/
│   │   ├── update.ts                 # NEW
│   │   ├── logs.ts                   # NEW
│   │   ├── ls.ts                     # NEW
│   │   ├── init.ts                   # NEW
│   │   ├── secret.ts                 # NEW (set/get/rm/edit/list as one file)
│   │   ├── key.ts                    # NEW (export/import/path)
│   │   ├── resolve.ts                # NEW: shared --name/--project/cwd resolver
│   │   └── up.ts, destroy.ts, ...    # MODIFIED: use resolve.ts
│   ├── orchestrator/
│   │   ├── update.ts                 # NEW: runUpdate flow
│   │   └── deploy.ts                 # MODIFIED: extract shared Phase 4/5 helpers
│   ├── state/
│   │   └── migrations.ts             # NEW: version-keyed migration runner
│   ├── schema/
│   │   └── state-toml.ts             # MODIFIED: schema_version literal stays 1; add MigrationError
│   ├── cloud/
│   │   ├── core.ts                   # MODIFIED: add reconcileNetwork to CloudProvider
│   │   └── aws/
│   │       ├── provider.ts           # MODIFIED: wire reconcileNetwork
│   │       └── reconcile-network.ts  # NEW
│   ├── remote-ops/
│   │   └── session.ts                # MODIFIED: add abortable execStream for logs
│   ├── ui/                           # NEW SUBTREE
│   │   ├── index.ts                  # InkReporter class + factory
│   │   ├── components/
│   │   │   ├── DeployTimeline.tsx    # NEW
│   │   │   ├── LogStream.tsx         # NEW
│   │   │   ├── Dashboard.tsx         # NEW
│   │   │   └── PhaseRow.tsx          # NEW: shared timeline row
│   │   └── tty.ts                    # NEW: TTY detection + env opt-out
│   └── init-templates/               # NEW
│       ├── hermes.toml.template
│       ├── SOUL.md.template
│       └── gitignore.template
└── tests/
    ├── unit/
    │   ├── commands/
    │   │   ├── resolve.test.ts
    │   │   ├── ls.test.ts
    │   │   ├── init.test.ts
    │   │   ├── secret.test.ts
    │   │   └── key.test.ts
    │   ├── orchestrator/
    │   │   └── update.test.ts
    │   ├── cloud/aws/
    │   │   └── reconcile-network.test.ts
    │   ├── state/
    │   │   └── migrations.test.ts
    │   └── ui/
    │       └── DeployTimeline.test.tsx
    └── fixtures/
        └── state-migrations/
            ├── v0-legacy.toml        # synthetic v0 fixture
            └── v1-expected.toml
```

---

## Tech decisions locked in for M2

| Concern | Choice | Why |
|---|---|---|
| UI framework | `ink` ^5 + `react` ^18 | User preference (explicit in memory); canonical for TS CLIs; React model is familiar |
| Ink testing | `ink-testing-library` | Official; enables snapshot + interaction tests for components |
| TSX transform | tsup supports `.tsx` via esbuild | No extra config needed; just enable `loader: { '.tsx': 'tsx' }` in tsup if default fails |
| Log streaming | Extend `SshSession.execStream` with an `AbortSignal` | Use existing ssh2 primitives; Ctrl-C raises SIGINT which triggers abort |
| Migration storage | In-code functions keyed by target version | `migrations[1] = (v0Input) => v1Output`; runs sequentially until target matches |
| Init templates | String literals in `src/init-templates/*.ts` (NOT fs assets) | Simpler distribution: tsup bundles them into `dist/cli.js`; no runtime file lookups |

---

## Tasks

### Phase A — `update` command

#### Task A1: reconcileNetwork interface + AWS implementation

**Files:**
- Modify: `src/cloud/core.ts` (add `reconcileNetwork` to `CloudProvider` interface)
- Create: `src/cloud/aws/reconcile-network.ts`
- Create: `tests/unit/cloud/aws/reconcile-network.test.ts`

- [ ] **Step 1: Extend `src/cloud/core.ts`** — add the method to the interface.

Find the existing `interface CloudProvider` and add this method between `provision` and `destroy`:

```typescript
  /**
   * Apply network rule changes in place, without recreating the instance.
   * Adds new rules not present in the ledger's current state, removes rules
   * that are no longer required. Idempotent — safe to call when the rules
   * already match.
   */
  reconcileNetwork(ledger: ResourceLedger, rules: NetworkRules): Promise<void>;
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  EC2Client,
  DescribeSecurityGroupsCommand,
  AuthorizeSecurityGroupIngressCommand,
  RevokeSecurityGroupIngressCommand,
} from '@aws-sdk/client-ec2';
import { reconcileNetworkAws } from '../../../../src/cloud/aws/reconcile-network.js';
import type { ResourceLedger } from '../../../../src/cloud/core.js';

describe('reconcileNetworkAws', () => {
  const ec2Mock = mockClient(EC2Client);
  beforeEach(() => ec2Mock.reset());

  const ledger: ResourceLedger = {
    kind: 'aws',
    resources: {
      security_group_id: 'sg-1',
      instance_id: 'i-1',
      key_pair_name: 'kp-1',
      eip_allocation_id: 'eip-1',
      region: 'eu-west-3',
    },
  };

  it('adds a new inbound port rule when not present', async () => {
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [{
        GroupId: 'sg-1',
        IpPermissions: [
          { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '1.2.3.4/32' }] },
        ],
      }],
    });
    ec2Mock.on(AuthorizeSecurityGroupIngressCommand).resolves({});

    await reconcileNetworkAws(ec2Mock as any, ledger, {
      sshAllowedFrom: '1.2.3.4/32',
      inboundPorts: [443],
    });

    const authCalls = ec2Mock.commandCalls(AuthorizeSecurityGroupIngressCommand);
    expect(authCalls).toHaveLength(1);
    const perms = (authCalls[0]!.args[0].input as any).IpPermissions;
    expect(perms).toHaveLength(1);
    expect(perms[0].FromPort).toBe(443);
  });

  it('revokes a rule that is no longer required', async () => {
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [{
        GroupId: 'sg-1',
        IpPermissions: [
          { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '1.2.3.4/32' }] },
          { IpProtocol: 'tcp', FromPort: 8080, ToPort: 8080, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
        ],
      }],
    });
    ec2Mock.on(RevokeSecurityGroupIngressCommand).resolves({});

    await reconcileNetworkAws(ec2Mock as any, ledger, {
      sshAllowedFrom: '1.2.3.4/32',
      inboundPorts: [],
    });

    expect(ec2Mock.commandCalls(RevokeSecurityGroupIngressCommand)).toHaveLength(1);
  });

  it('is a no-op when rules already match', async () => {
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [{
        GroupId: 'sg-1',
        IpPermissions: [
          { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '1.2.3.4/32' }] },
          { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
        ],
      }],
    });

    await reconcileNetworkAws(ec2Mock as any, ledger, {
      sshAllowedFrom: '1.2.3.4/32',
      inboundPorts: [443],
    });

    expect(ec2Mock.commandCalls(AuthorizeSecurityGroupIngressCommand)).toHaveLength(0);
    expect(ec2Mock.commandCalls(RevokeSecurityGroupIngressCommand)).toHaveLength(0);
  });

  it('updates the SSH allow rule when the CIDR changes', async () => {
    ec2Mock.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [{
        GroupId: 'sg-1',
        IpPermissions: [
          { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '1.1.1.1/32' }] },
        ],
      }],
    });
    ec2Mock.on(RevokeSecurityGroupIngressCommand).resolves({});
    ec2Mock.on(AuthorizeSecurityGroupIngressCommand).resolves({});

    await reconcileNetworkAws(ec2Mock as any, ledger, {
      sshAllowedFrom: '2.2.2.2/32',
      inboundPorts: [],
    });

    expect(ec2Mock.commandCalls(RevokeSecurityGroupIngressCommand)).toHaveLength(1);
    expect(ec2Mock.commandCalls(AuthorizeSecurityGroupIngressCommand)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/cloud/aws/reconcile-network.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/cloud/aws/reconcile-network.ts`**

```typescript
import {
  EC2Client,
  DescribeSecurityGroupsCommand,
  AuthorizeSecurityGroupIngressCommand,
  RevokeSecurityGroupIngressCommand,
  type IpPermission,
} from '@aws-sdk/client-ec2';
import type { ResourceLedger, NetworkRules } from '../core.js';

interface DesiredRule {
  port: number;
  cidr: string;
}

/**
 * Apply the desired NetworkRules to an existing security group in place.
 * Adds rules that are missing, revokes rules that are no longer wanted.
 * The rule set modeled here is tight on purpose: one SSH rule from
 * `sshAllowedFrom`, and one rule per `inboundPorts` entry from 0.0.0.0/0.
 * Everything else on the SG is left alone (we don't touch rules we didn't
 * create — a future change could tag our rules for stricter matching).
 */
export async function reconcileNetworkAws(
  ec2: EC2Client,
  ledger: ResourceLedger,
  rules: NetworkRules,
): Promise<void> {
  if (ledger.kind !== 'aws') throw new Error(`expected aws ledger, got ${ledger.kind}`);
  const groupId = ledger.resources.security_group_id;
  if (!groupId) throw new Error('reconcileNetworkAws: ledger has no security_group_id');

  const desired: DesiredRule[] = [
    { port: 22, cidr: rules.sshAllowedFrom },
    ...rules.inboundPorts.map(port => ({ port, cidr: '0.0.0.0/0' })),
  ];

  const result = await ec2.send(new DescribeSecurityGroupsCommand({ GroupIds: [groupId] }));
  const current = flatten(result.SecurityGroups?.[0]?.IpPermissions ?? []);

  // Add desired rules that are not in current
  const toAdd = desired.filter(
    d => !current.some(c => c.port === d.port && c.cidr === d.cidr),
  );
  for (const rule of toAdd) {
    await ec2.send(
      new AuthorizeSecurityGroupIngressCommand({
        GroupId: groupId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: rule.port,
            ToPort: rule.port,
            IpRanges: [{ CidrIp: rule.cidr }],
          },
        ],
      }),
    );
  }

  // Revoke current rules that are not in desired
  const toRevoke = current.filter(
    c => !desired.some(d => d.port === c.port && d.cidr === c.cidr),
  );
  for (const rule of toRevoke) {
    await ec2.send(
      new RevokeSecurityGroupIngressCommand({
        GroupId: groupId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: rule.port,
            ToPort: rule.port,
            IpRanges: [{ CidrIp: rule.cidr }],
          },
        ],
      }),
    );
  }
}

function flatten(perms: IpPermission[]): DesiredRule[] {
  const out: DesiredRule[] = [];
  for (const p of perms) {
    if (p.IpProtocol !== 'tcp') continue;
    if (p.FromPort !== p.ToPort || p.FromPort === undefined) continue;
    const port = p.FromPort;
    for (const range of p.IpRanges ?? []) {
      if (range.CidrIp) out.push({ port, cidr: range.CidrIp });
    }
  }
  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/cloud/aws/reconcile-network.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 6: Typecheck**

The `CloudProvider` interface now requires `reconcileNetwork`, so `AwsProvider` in M1 will fail to implement it. That's expected — the next task (A2) wires it up. For now, temporarily silence the error by adding a placeholder method stub to `AwsProvider`:

```typescript
reconcileNetwork(_ledger: ResourceLedger, _rules: NetworkRules): Promise<void> {
  throw new Error('not wired yet — see task A2');
}
```

Add the necessary imports if missing. Run `npx tsc --noEmit`: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/cloud/core.ts src/cloud/aws/reconcile-network.ts src/cloud/aws/provider.ts tests/unit/cloud/aws/reconcile-network.test.ts
git commit -m "feat(cloud/aws): reconcileNetwork idempotently adds and revokes SG rules"
```

#### Task A2: wire reconcileNetwork into AwsProvider

**Files:**
- Modify: `src/cloud/aws/provider.ts`

- [ ] **Step 1: Replace the stub** in `AwsProvider` with a real delegation.

At the top of `provider.ts`, add the import:

```typescript
import { reconcileNetworkAws } from './reconcile-network.js';
import type { NetworkRules } from '../core.js';
```

And replace the stub method with:

```typescript
reconcileNetwork(ledger: ResourceLedger, rules: NetworkRules): Promise<void> {
  return reconcileNetworkAws(this.ec2, ledger, rules);
}
```

- [ ] **Step 2: Run typecheck + all tests**

```bash
npx tsc --noEmit && npx vitest run
```

All existing tests should still pass. `tsc` should be clean.

- [ ] **Step 3: Commit**

```bash
git add src/cloud/aws/provider.ts
git commit -m "feat(cloud/aws): wire reconcileNetwork through AwsProvider"
```

#### Task A3: `runUpdate` orchestrator

**Files:**
- Create: `src/orchestrator/update.ts`
- Modify: `src/orchestrator/deploy.ts` (extract shared helpers)
- Create: `tests/unit/orchestrator/update.test.ts`

- [ ] **Step 1: Extract shared helpers from `deploy.ts`**

Before writing `runUpdate`, look at `src/orchestrator/deploy.ts` and identify the Phase 4 (upload + nixos-rebuild) and Phase 5 (healthcheck + state update) logic that both `up` and `update` will need to share. Pull them into two internal helpers at the top of `deploy.ts` (or a new `src/orchestrator/shared.ts` if cleaner) and export them:

```typescript
// src/orchestrator/shared.ts
import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { generateHermesNix, generateConfigurationNix } from '../nix-gen/generate.js';
import { runNixosRebuild } from '../remote-ops/nixos-rebuild.js';
import { pollHermesHealth } from '../remote-ops/healthcheck.js';
import { StateStore } from '../state/store.js';
import { computeConfigHash } from '../state/hash.js';
import type { SshSession } from '../remote-ops/session.js';
import type { HermesTomlConfig } from '../schema/hermes-toml.js';
import type { Reporter } from './reporter.js';

export interface BootstrapArgs {
  session: SshSession;
  projectDir: string;
  config: HermesTomlConfig;
  ageKeyPath: string;
  reporter: Reporter;
}

/** Phase 4: generate nix files, SCP them, run nixos-rebuild. Throws on failure. */
export async function uploadAndRebuild(args: BootstrapArgs): Promise<void> {
  const { session, projectDir, config, ageKeyPath, reporter } = args;
  const configurationNix = generateConfigurationNix();
  const hermesNix = generateHermesNix(config);
  const ageKeyContent = readFileSync(ageKeyPath, 'utf-8');
  const secretsContent = readFileSync(pathResolve(projectDir, config.hermes.secrets_file));

  await session.uploadFile('/etc/nixos/configuration.nix', configurationNix);
  await session.uploadFile('/etc/nixos/hermes.nix', hermesNix);
  await session.uploadFile('/etc/nixos/secrets.enc.yaml', secretsContent);
  await session.uploadFile('/var/lib/sops-nix/age.key', ageKeyContent, 0o600);

  const rebuild = await runNixosRebuild(session, (_s, line) => reporter.log(line));
  if (!rebuild.success) {
    throw new Error(`nixos-rebuild failed:\n${rebuild.tail.join('\n')}`);
  }
}

export interface HealthcheckArgs {
  session: SshSession;
  store: StateStore;
  deploymentName: string;
  projectDir: string;
  tomlPath: string;
  config: HermesTomlConfig;
  healthcheckTimeoutMs?: number;
}

/** Phase 5: update state hash, poll health, record result. Returns 'healthy' | 'unhealthy'. */
export async function recordConfigAndHealthcheck(
  args: HealthcheckArgs,
): Promise<'healthy' | 'unhealthy'> {
  const { session, store, deploymentName, projectDir, tomlPath, config, healthcheckTimeoutMs } = args;
  const configHash = computeConfigHash(
    [
      tomlPath,
      pathResolve(projectDir, config.hermes.secrets_file),
      config.hermes.nix_extra ? pathResolve(projectDir, config.hermes.nix_extra.file) : '',
    ].filter(Boolean),
    true,
  );

  await store.update(state => {
    const d = state.deployments[deploymentName]!;
    d.last_config_hash = configHash;
    d.last_deployed_at = new Date().toISOString();
  });

  const health = await pollHermesHealth(session, { timeoutMs: healthcheckTimeoutMs });
  await store.update(state => {
    state.deployments[deploymentName]!.health = health.health;
  });
  return health.health;
}
```

Update `deploy.ts` to import and call these helpers instead of inlining the logic. The existing tests must continue to pass.

- [ ] **Step 2: Run the existing suite**

```bash
npx vitest run
```

Expected: 60/60 tests still pass.

- [ ] **Step 3: Write the failing `update` test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runUpdate } from '../../../src/orchestrator/update.js';
import type { CloudProvider, ResourceLedger } from '../../../src/cloud/core.js';
import type { SshSession } from '../../../src/remote-ops/session.js';
import { StateStore } from '../../../src/state/store.js';
import { getStatePaths } from '../../../src/state/paths.js';

function fakeProvider(): CloudProvider {
  return {
    name: 'aws',
    resolveNixosImage: vi.fn(),
    provision: vi.fn(),
    reconcileNetwork: vi.fn(async () => {}),
    destroy: vi.fn(),
    status: vi.fn(async () => ({ state: 'running', publicIp: '203.0.113.42' })),
  };
}

function healthySession(): SshSession {
  return {
    exec: vi.fn(async () => ({ exitCode: 0, stdout: 'active', stderr: '' })),
    execStream: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    uploadFile: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

describe('runUpdate', () => {
  let projectDir: string;
  let configDir: string;

  beforeEach(async () => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-update-'));
    projectDir = join(root, 'project');
    configDir = join(root, 'config');
    mkdirSync(projectDir);
    mkdirSync(configDir);
    process.env.XDG_CONFIG_HOME = configDir;

    writeFileSync(join(projectDir, 'hermes.toml'), `
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
model = "m"
soul = "./SOUL.md"
secrets_file = "./secrets.enc.yaml"
[hermes.platforms.discord]
enabled = true
token_key = "k"
`);
    writeFileSync(join(projectDir, 'SOUL.md'), '# soul');
    writeFileSync(join(projectDir, 'secrets.enc.yaml'), 'sops: {}\n');

    // Seed state with an existing healthy deployment
    const store = new StateStore(getStatePaths());
    await store.update(state => {
      state.deployments['test'] = {
        project_path: projectDir,
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-01T00:00:00Z',
        last_deployed_at: '2026-04-01T00:00:00Z',
        last_config_hash: 'sha256:old',
        ssh_key_path: join(configDir, 'hermes-deploy/ssh_keys/test'),
        age_key_path: join(configDir, 'hermes-deploy/age_keys/test'),
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

    // Pre-create the keys (no generation on update)
    mkdirSync(join(configDir, 'hermes-deploy/ssh_keys'), { recursive: true });
    mkdirSync(join(configDir, 'hermes-deploy/age_keys'), { recursive: true });
    writeFileSync(
      join(configDir, 'hermes-deploy/ssh_keys/test'),
      '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
    );
    writeFileSync(
      join(configDir, 'hermes-deploy/ssh_keys/test.pub'),
      'ssh-ed25519 AAAA test',
    );
    writeFileSync(
      join(configDir, 'hermes-deploy/age_keys/test'),
      '# public key: age1abc\nAGE-SECRET-KEY-1abc\n',
    );
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('runs reconcileNetwork and bootstrap without calling provision', async () => {
    const provider = fakeProvider();
    const result = await runUpdate({
      deploymentName: 'test',
      provider,
      sessionFactory: async () => healthySession(),
      detectPublicIp: async () => '203.0.113.1/32',
      healthcheckTimeoutMs: 500,
    });

    expect(result.health).toBe('healthy');
    expect(provider.provision).not.toHaveBeenCalled();
    expect(provider.reconcileNetwork).toHaveBeenCalledTimes(1);
  });

  it('short-circuits (no SSH) when the config hash has not changed', async () => {
    // Pre-populate state's last_config_hash with what update will compute
    // from the current files. The cleanest way is to let runUpdate compute
    // it and then re-run — but we can also compute it inline. Since
    // computeConfigHash is content-based (post-M1 fix), we just need to
    // match the current content hash.
    const store = new StateStore(getStatePaths());
    const { computeConfigHash } = await import('../../../src/state/hash.js');
    const currentHash = computeConfigHash(
      [
        join(projectDir, 'hermes.toml'),
        join(projectDir, 'secrets.enc.yaml'),
      ],
      true,
    );
    await store.update(state => {
      state.deployments['test']!.last_config_hash = currentHash;
    });

    const provider = fakeProvider();
    const sessionFactory = vi.fn(async () => healthySession());

    const result = await runUpdate({
      deploymentName: 'test',
      provider,
      sessionFactory,
      detectPublicIp: async () => '203.0.113.1/32',
      healthcheckTimeoutMs: 500,
    });

    expect(result.skipped).toBe(true);
    expect(sessionFactory).not.toHaveBeenCalled();
    expect(provider.reconcileNetwork).not.toHaveBeenCalled();
  });

  it('throws when the deployment is not in state', async () => {
    const provider = fakeProvider();
    await expect(
      runUpdate({
        deploymentName: 'missing',
        provider,
        sessionFactory: async () => healthySession(),
        detectPublicIp: async () => '1.1.1.1/32',
      }),
    ).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 4: Run, expect FAIL (module not found).**

```bash
npx vitest run tests/unit/orchestrator/update.test.ts
```

- [ ] **Step 5: Implement `src/orchestrator/update.ts`**

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { loadHermesToml, HermesTomlError } from '../schema/load.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import { computeConfigHash } from '../state/hash.js';
import { createPlainReporter, type Reporter } from './reporter.js';
import { uploadAndRebuild, recordConfigAndHealthcheck } from './shared.js';
import type { CloudProvider, NetworkRules, ResourceLedger } from '../cloud/core.js';
import type { SshSession } from '../remote-ops/session.js';

export interface UpdateOptions {
  deploymentName: string;
  provider: CloudProvider;
  sessionFactory: (host: string, privateKey: string) => Promise<SshSession>;
  detectPublicIp: () => Promise<string>;
  healthcheckTimeoutMs?: number;
  reporter?: Reporter;
}

export interface UpdateResult {
  health: 'healthy' | 'unhealthy';
  publicIp: string;
  skipped: boolean;
}

export async function runUpdate(opts: UpdateOptions): Promise<UpdateResult> {
  const reporter = opts.reporter ?? createPlainReporter();
  const paths = getStatePaths();
  const store = new StateStore(paths);
  const state = await store.read();

  const deployment = state.deployments[opts.deploymentName];
  if (!deployment) {
    throw new Error(`deployment "${opts.deploymentName}" not found in state`);
  }

  reporter.phaseStart('validate', `Validating ${opts.deploymentName}`);
  const tomlPath = join(deployment.project_path, 'hermes.toml');
  const config = loadHermesToml(tomlPath);
  const soulPath = pathResolve(deployment.project_path, config.hermes.soul);
  if (!existsSync(soulPath)) {
    throw new HermesTomlError(`SOUL file not found: ${soulPath}`);
  }
  reporter.phaseDone('validate');

  // Short-circuit: if the config hash hasn't changed, there's nothing to do.
  const newHash = computeConfigHash(
    [
      tomlPath,
      pathResolve(deployment.project_path, config.hermes.secrets_file),
      config.hermes.nix_extra
        ? pathResolve(deployment.project_path, config.hermes.nix_extra.file)
        : '',
    ].filter(Boolean),
    true,
  );
  if (newHash === deployment.last_config_hash) {
    reporter.success(`no changes — ${opts.deploymentName} is already up-to-date`);
    return { health: deployment.health === 'healthy' ? 'healthy' : 'unhealthy', publicIp: deployment.instance_ip, skipped: true };
  }

  // Reconcile network rules if ssh_allowed_from or inbound_ports changed.
  reporter.phaseStart('provision', 'Reconciling network rules');
  const sshAllowedFrom =
    config.network.ssh_allowed_from === 'auto'
      ? await opts.detectPublicIp()
      : config.network.ssh_allowed_from;
  const rules: NetworkRules = { sshAllowedFrom, inboundPorts: config.network.inbound_ports };
  const ledger: ResourceLedger =
    deployment.cloud === 'aws'
      ? { kind: 'aws', resources: { ...deployment.cloud_resources } }
      : { kind: 'gcp', resources: { ...deployment.cloud_resources } };
  await opts.provider.reconcileNetwork(ledger, rules);
  reporter.phaseDone('provision');

  // Open SSH session and reuse for bootstrap + healthcheck.
  reporter.phaseStart('bootstrap', 'Uploading config and running nixos-rebuild');
  const privateKeyContent = readFileSync(deployment.ssh_key_path, 'utf-8');
  const session = await opts.sessionFactory(deployment.instance_ip, privateKeyContent);
  try {
    await uploadAndRebuild({
      session,
      projectDir: deployment.project_path,
      config,
      ageKeyPath: deployment.age_key_path,
      reporter,
    });
    reporter.phaseDone('bootstrap');

    reporter.phaseStart('healthcheck', 'Waiting for hermes-agent.service');
    const health = await recordConfigAndHealthcheck({
      session,
      store,
      deploymentName: opts.deploymentName,
      projectDir: deployment.project_path,
      tomlPath,
      config,
      healthcheckTimeoutMs: opts.healthcheckTimeoutMs,
    });

    if (health === 'unhealthy') {
      reporter.phaseFail('healthcheck', 'service is not active');
      return { health: 'unhealthy', publicIp: deployment.instance_ip, skipped: false };
    }
    reporter.phaseDone('healthcheck');
    reporter.success(`${opts.deploymentName} updated`);
    return { health: 'healthy', publicIp: deployment.instance_ip, skipped: false };
  } finally {
    await session.dispose();
  }
}
```

- [ ] **Step 6: Run the test**

```bash
npx vitest run tests/unit/orchestrator/update.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 7: Run the full suite**

```bash
npx vitest run
```

Expected: no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/orchestrator/shared.ts src/orchestrator/update.ts src/orchestrator/deploy.ts tests/unit/orchestrator/update.test.ts
git commit -m "feat(orchestrator): implement update flow with hash short-circuit and network reconcile"
```

#### Task A4: `update` CLI command

**Files:**
- Create: `src/commands/update.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement `src/commands/update.ts`**

```typescript
import { findUp } from './find-project.js';
import { loadHermesToml } from '../schema/load.js';
import { runUpdate } from '../orchestrator/update.js';
import { createCloudProvider } from '../cloud/factory.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';
import { createSshSession } from '../remote-ops/session.js';
import { detectPublicIp } from '../utils/public-ip.js';

export async function updateCommand(opts: { name?: string }): Promise<void> {
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

  const provider = createCloudProvider({
    provider: deployment.cloud,
    region: deployment.region,
    imageCacheFile: paths.imageCacheFile,
  });

  const result = await runUpdate({
    deploymentName: name,
    provider,
    sessionFactory: (host, privateKey) =>
      createSshSession({ host, username: 'root', privateKey }),
    detectPublicIp: () => detectPublicIp(),
  });

  if (result.health === 'unhealthy') process.exit(1);
}
```

- [ ] **Step 2: Register in `src/cli.ts`**

Add to the imports:

```typescript
import { updateCommand } from './commands/update.js';
```

And add the command block (after `up`, before `destroy`):

```typescript
program
  .command('update')
  .argument('[name]', 'deployment name (defaults to ./hermes.toml)')
  .description('Push config changes to an existing deployment (skips provisioning)')
  .action(async (name) => {
    try {
      await updateCommand({ name });
    } catch (e) {
      console.error(`hermes-deploy update: ${(e as Error).message}`);
      process.exit(1);
    }
  });
```

- [ ] **Step 3: Build + verify**

```bash
npm run build
./dist/cli.js update --help
```

Expected: shows `update [options] [name]` with description.

- [ ] **Step 4: Commit**

```bash
git add src/commands/update.ts src/cli.ts
git commit -m "feat(cli): update command for config-only redeploys"
```

---

### Phase B — Multi-instance + `ls`

#### Task B1: Shared `--name`/`--project` resolver

**Files:**
- Create: `src/commands/resolve.ts`
- Create: `tests/unit/commands/resolve.test.ts`
- Modify: `src/commands/{up,destroy,status,ssh,update}.ts` to use the resolver

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDeployment } from '../../../src/commands/resolve.js';
import { StateStore } from '../../../src/state/store.js';
import { getStatePaths } from '../../../src/state/paths.js';

describe('resolveDeployment', () => {
  let configDir: string;
  let projectDir: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-resolve-'));
    configDir = join(root, 'config');
    projectDir = join(root, 'project');
    mkdirSync(configDir);
    mkdirSync(projectDir);
    process.env.XDG_CONFIG_HOME = configDir;

    writeFileSync(join(projectDir, 'hermes.toml'), `
name = "my-bot"
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
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('resolves by --name from global state', async () => {
    const store = new StateStore(getStatePaths());
    await store.update(state => {
      state.deployments['acme-bot'] = {
        project_path: '/some/path',
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-01T00:00:00Z',
        last_deployed_at: '2026-04-01T00:00:00Z',
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

    const r = await resolveDeployment({ name: 'acme-bot', cwd: '/unrelated/dir' });
    expect(r.name).toBe('acme-bot');
    expect(r.projectPath).toBe('/some/path');
    expect(r.source).toBe('name');
  });

  it('resolves by --project path', async () => {
    const r = await resolveDeployment({ projectPath: projectDir, cwd: '/unrelated/dir' });
    expect(r.name).toBe('my-bot');
    expect(r.projectPath).toBe(projectDir);
    expect(r.source).toBe('project');
  });

  it('resolves by walking up from cwd', async () => {
    const nested = join(projectDir, 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    const r = await resolveDeployment({ cwd: nested });
    expect(r.name).toBe('my-bot');
    expect(r.projectPath).toBe(projectDir);
    expect(r.source).toBe('cwd');
  });

  it('throws when nothing resolves', async () => {
    await expect(
      resolveDeployment({ cwd: '/nonexistent' }),
    ).rejects.toThrow(/no hermes\.toml/);
  });

  it('rejects both --name and --project at once', async () => {
    await expect(
      resolveDeployment({ name: 'x', projectPath: '/y', cwd: '/z' }),
    ).rejects.toThrow(/mutually exclusive/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `src/commands/resolve.ts`**

```typescript
import { findUp } from './find-project.js';
import { loadHermesToml } from '../schema/load.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import { join } from 'node:path';

export interface ResolveOptions {
  name?: string;
  projectPath?: string;
  cwd: string;
}

export interface ResolvedDeployment {
  name: string;
  projectPath: string;
  source: 'name' | 'project' | 'cwd';
}

/**
 * Resolve a deployment using the spec §5.1 precedence:
 *   1. --name → look up in global state, read project_path from there
 *   2. --project → load hermes.toml from that path, use its name field
 *   3. cwd walk → find hermes.toml upward, use its name field
 */
export async function resolveDeployment(opts: ResolveOptions): Promise<ResolvedDeployment> {
  if (opts.name && opts.projectPath) {
    throw new Error('--name and --project are mutually exclusive');
  }

  if (opts.name) {
    const store = new StateStore(getStatePaths());
    const state = await store.read();
    const deployment = state.deployments[opts.name];
    if (!deployment) {
      throw new Error(`deployment "${opts.name}" not found in state`);
    }
    return { name: opts.name, projectPath: deployment.project_path, source: 'name' };
  }

  if (opts.projectPath) {
    const config = loadHermesToml(join(opts.projectPath, 'hermes.toml'));
    return { name: config.name, projectPath: opts.projectPath, source: 'project' };
  }

  const projectDir = findUp(opts.cwd, 'hermes.toml');
  if (!projectDir) {
    throw new Error('no hermes.toml found in current directory or any parent');
  }
  const config = loadHermesToml(join(projectDir, 'hermes.toml'));
  return { name: config.name, projectPath: projectDir, source: 'cwd' };
}
```

- [ ] **Step 4: Run, expect 5/5 PASS.**

- [ ] **Step 5: Update `up`, `destroy`, `status`, `ssh`, `update` commands to use `resolveDeployment`**

For each command, replace the name-resolution block at the top with a call to `resolveDeployment({ name, projectPath, cwd: process.cwd() })`. Each command function gains two optional fields in its opts type: `name?: string`, `projectPath?: string`.

Example for `src/commands/up.ts` — replace the `findUp(...)` + `loadHermesToml(...)` block with:

```typescript
import { resolveDeployment } from './resolve.js';

export async function upCommand(opts: { name?: string; projectPath?: string }): Promise<void> {
  const { projectPath } = await resolveDeployment({
    name: opts.name,
    projectPath: opts.projectPath,
    cwd: process.cwd(),
  });
  const config = loadHermesToml(`${projectPath}/hermes.toml`);
  // ... rest unchanged, but `projectDir` becomes `projectPath`
}
```

Apply the same change to `destroy.ts`, `status.ts`, `ssh.ts`, `update.ts`. In each, the existing `findUp` usage is replaced with `resolveDeployment`.

- [ ] **Step 6: Update `src/cli.ts`** to pass `--name` and `--project` as options to each command

For each of `up`, `destroy`, `status`, `ssh`, `update`, add:

```typescript
  .option('--name <name>', 'deployment name (use instead of cwd lookup)')
  .option('--project <path>', 'project directory (use instead of cwd lookup)')
```

And update the action handlers to pass these options through:

```typescript
  .action(async (positionalName, opts) => {
    try {
      await upCommand({ name: opts.name ?? positionalName, projectPath: opts.project });
    } catch (e) { ... }
  });
```

Note: commands that already had a positional `[name]` argument (destroy/status/ssh/update) need to merge the positional with the `--name` option. Positional is the fallback.

- [ ] **Step 7: Typecheck and run full suite**

```bash
npx tsc --noEmit && npx vitest run
```

All existing tests must still pass. The up/destroy/status/ssh/update commands now support `--name` and `--project`.

- [ ] **Step 8: Commit**

```bash
git add src/commands/ src/cli.ts tests/unit/commands/resolve.test.ts
git commit -m "feat(cli): --name and --project flags via shared deployment resolver"
```

#### Task B2: `ls` command

**Files:**
- Create: `src/commands/ls.ts`
- Create: `tests/unit/commands/ls.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectDeploymentSummaries } from '../../../src/commands/ls.js';
import { StateStore } from '../../../src/state/store.js';
import { getStatePaths } from '../../../src/state/paths.js';
import type { CloudProvider } from '../../../src/cloud/core.js';

function stubProvider(state: 'running' | 'stopped' = 'running'): CloudProvider {
  return {
    name: 'aws',
    resolveNixosImage: vi.fn(),
    provision: vi.fn(),
    reconcileNetwork: vi.fn(),
    destroy: vi.fn(),
    status: vi.fn(async () => ({ state, publicIp: '203.0.113.42' })),
  };
}

describe('collectDeploymentSummaries', () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = mkdtempSync(join(tmpdir(), 'hermes-ls-'));
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = configDir;

    const store = new StateStore(getStatePaths());
    await store.update(state => {
      state.deployments['acme'] = {
        project_path: '/acme',
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-01T00:00:00Z',
        last_deployed_at: '2026-04-05T00:00:00Z',
        last_config_hash: 'sha256:acme',
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
      state.deployments['beta'] = {
        project_path: '/beta',
        cloud: 'aws',
        region: 'us-east-1',
        created_at: '2026-04-02T00:00:00Z',
        last_deployed_at: '2026-04-06T00:00:00Z',
        last_config_hash: 'sha256:beta',
        ssh_key_path: '/y',
        age_key_path: '/y',
        health: 'unhealthy',
        instance_ip: '203.0.113.43',
        cloud_resources: {
          instance_id: 'i-2',
          security_group_id: 'sg-2',
          key_pair_name: 'kp-2',
          eip_allocation_id: 'eipalloc-2',
          region: 'us-east-1',
        },
      };
    });
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('returns one summary per deployment, sorted by name', async () => {
    const providerFactory = () => stubProvider('running');
    const summaries = await collectDeploymentSummaries({ providerFactory, live: false });
    expect(summaries.map(s => s.name)).toEqual(['acme', 'beta']);
    expect(summaries[0]!.storedHealth).toBe('healthy');
    expect(summaries[1]!.storedHealth).toBe('unhealthy');
  });

  it('includes live status when live=true', async () => {
    const providerFactory = () => stubProvider('running');
    const summaries = await collectDeploymentSummaries({ providerFactory, live: true });
    expect(summaries[0]!.liveState).toBe('running');
    expect(summaries[1]!.liveState).toBe('running');
  });

  it('omits live status when live=false', async () => {
    const providerFactory = () => stubProvider('running');
    const summaries = await collectDeploymentSummaries({ providerFactory, live: false });
    expect(summaries[0]!.liveState).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `src/commands/ls.ts`**

```typescript
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import { createCloudProvider } from '../cloud/factory.js';
import type { CloudProvider, ResourceLedger } from '../cloud/core.js';

export interface DeploymentSummary {
  name: string;
  cloud: 'aws' | 'gcp';
  region: string;
  instanceIp: string;
  storedHealth: 'healthy' | 'unhealthy' | 'unknown';
  lastDeployedAt: string;
  liveState?: string;
  livePublicIp?: string | null;
}

export interface CollectOptions {
  /** When true, calls provider.status() for each deployment. */
  live: boolean;
  /**
   * Factory for constructing a CloudProvider per deployment. Injected so tests
   * can stub it. Defaults to createCloudProvider.
   */
  providerFactory?: (deployment: { cloud: 'aws' | 'gcp'; region: string }) => CloudProvider;
}

export async function collectDeploymentSummaries(opts: CollectOptions): Promise<DeploymentSummary[]> {
  const paths = getStatePaths();
  const store = new StateStore(paths);
  const state = await store.read();

  const names = Object.keys(state.deployments).sort();
  const summaries: DeploymentSummary[] = [];

  for (const name of names) {
    const d = state.deployments[name]!;
    const summary: DeploymentSummary = {
      name,
      cloud: d.cloud,
      region: d.region,
      instanceIp: d.instance_ip,
      storedHealth: d.health,
      lastDeployedAt: d.last_deployed_at,
    };

    if (opts.live) {
      const factory =
        opts.providerFactory ??
        ((deployment) =>
          createCloudProvider({
            provider: deployment.cloud,
            region: deployment.region,
            imageCacheFile: paths.imageCacheFile,
          }));
      const provider = factory({ cloud: d.cloud, region: d.region });
      const ledger: ResourceLedger =
        d.cloud === 'aws'
          ? { kind: 'aws', resources: { ...d.cloud_resources } }
          : { kind: 'gcp', resources: { ...d.cloud_resources } };
      try {
        const live = await provider.status(ledger);
        summary.liveState = live.state;
        summary.livePublicIp = live.publicIp;
      } catch {
        summary.liveState = 'error';
      }
    }

    summaries.push(summary);
  }
  return summaries;
}

/** CLI entry — renders a plain-text table. M2's Ink dashboard wraps this. */
export async function lsCommand(opts: { watch?: boolean }): Promise<void> {
  const summaries = await collectDeploymentSummaries({ live: true });
  if (summaries.length === 0) {
    console.log('No deployments.');
    return;
  }

  const header = ['NAME', 'CLOUD', 'REGION', 'IP', 'STORED', 'LIVE', 'LAST DEPLOYED'];
  const rows = summaries.map(s => [
    s.name,
    s.cloud,
    s.region,
    s.instanceIp,
    s.storedHealth,
    s.liveState ?? '-',
    s.lastDeployedAt,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(line(header));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));

  if (opts.watch) {
    console.log('\n(--watch not yet wired to Ink; see phase H)');
  }
}
```

- [ ] **Step 4: Register in `src/cli.ts`**

```typescript
import { lsCommand } from './commands/ls.js';

program
  .command('ls')
  .description('List all deployments')
  .option('--watch', 'poll live status continuously (Ink dashboard)')
  .action(async (opts) => {
    try {
      await lsCommand({ watch: opts.watch });
    } catch (e) {
      console.error(`hermes-deploy ls: ${(e as Error).message}`);
      process.exit(1);
    }
  });
```

- [ ] **Step 5: Run tests + build**

```bash
npx vitest run && npm run build && ./dist/cli.js ls --help
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/ls.ts tests/unit/commands/ls.test.ts src/cli.ts
git commit -m "feat(cli): ls command with stored and live deployment status"
```

---

### Phase C — `logs` command

#### Task C1: Abortable streaming on SshSession

**Files:**
- Modify: `src/remote-ops/session.ts`

- [ ] **Step 1: Extend the SshSession interface**

Add a new method `execStreamUntil` that accepts an `AbortSignal` so the caller can terminate the stream:

```typescript
export interface SshSession {
  // ... existing methods ...
  /**
   * Like execStream, but runs until the remote command exits OR the
   * provided AbortSignal fires. On abort, the underlying ssh2 stream is
   * destroyed and the returned promise resolves with `{aborted: true}`.
   */
  execStreamUntil(
    command: string,
    signal: AbortSignal,
    onLine: (stream: 'stdout' | 'stderr', line: string) => void,
  ): Promise<{ aborted: boolean; exitCode: number | null }>;
}
```

- [ ] **Step 2: Implement it** inside `createSshSession`

Add below `execStream`:

```typescript
  const execStreamUntil = (
    command: string,
    signal: AbortSignal,
    onLine: (stream: 'stdout' | 'stderr', line: string) => void,
  ): Promise<{ aborted: boolean; exitCode: number | null }> =>
    new Promise((resolve, reject) => {
      client.exec(command, (err, stream: ClientChannel) => {
        if (err) return reject(err);
        let exitCode: number | null = null;
        let stdoutBuf = '';
        let stderrBuf = '';
        let aborted = false;

        const flush = (which: 'stdout' | 'stderr') => {
          const buf = which === 'stdout' ? stdoutBuf : stderrBuf;
          const lines = buf.split('\n');
          for (let i = 0; i < lines.length - 1; i++) onLine(which, lines[i]!);
          if (which === 'stdout') stdoutBuf = lines[lines.length - 1]!;
          else stderrBuf = lines[lines.length - 1]!;
        };

        stream.on('data', (chunk: Buffer) => {
          stdoutBuf += chunk.toString();
          flush('stdout');
        });
        stream.stderr.on('data', (chunk: Buffer) => {
          stderrBuf += chunk.toString();
          flush('stderr');
        });
        stream.on('exit', (code: number) => { exitCode = code; });
        stream.on('close', () => {
          if (stdoutBuf) onLine('stdout', stdoutBuf);
          if (stderrBuf) onLine('stderr', stderrBuf);
          resolve({ aborted, exitCode });
        });

        const onAbort = () => {
          aborted = true;
          try { stream.signal('TERM'); } catch { /* stream may already be closed */ }
          try { stream.end(); } catch { /* same */ }
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
    });
```

Include it in the returned session object: `return { exec, execStream, execStreamUntil, uploadFile, dispose };`.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

The `runNixosRebuild` function doesn't need this method — it keeps using `execStream`. The only new consumer is the logs command (C2).

- [ ] **Step 4: Commit**

```bash
git add src/remote-ops/session.ts
git commit -m "feat(remote-ops): add execStreamUntil with AbortSignal for logs streaming"
```

#### Task C2: `logs` command

**Files:**
- Create: `src/commands/logs.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement `src/commands/logs.ts`**

```typescript
import { readFileSync } from 'node:fs';
import { resolveDeployment } from './resolve.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import { createSshSession } from '../remote-ops/session.js';

export async function logsCommand(opts: { name?: string; projectPath?: string }): Promise<void> {
  const { name } = await resolveDeployment({
    name: opts.name,
    projectPath: opts.projectPath,
    cwd: process.cwd(),
  });

  const store = new StateStore(getStatePaths());
  const state = await store.read();
  const deployment = state.deployments[name];
  if (!deployment) throw new Error(`deployment "${name}" not found in state`);

  const privateKey = readFileSync(deployment.ssh_key_path, 'utf-8');
  const session = await createSshSession({
    host: deployment.instance_ip,
    username: 'root',
    privateKey,
  });

  const controller = new AbortController();
  const sigintHandler = () => {
    process.stdout.write('\nstopping log stream...\n');
    controller.abort();
  };
  process.on('SIGINT', sigintHandler);

  try {
    const result = await session.execStreamUntil(
      'journalctl -u hermes-agent.service -f --no-pager',
      controller.signal,
      (stream, line) => {
        if (stream === 'stderr') process.stderr.write(`${line}\n`);
        else process.stdout.write(`${line}\n`);
      },
    );
    if (!result.aborted && result.exitCode !== 0) {
      process.exitCode = result.exitCode ?? 1;
    }
  } finally {
    process.off('SIGINT', sigintHandler);
    await session.dispose();
  }
}
```

- [ ] **Step 2: Register in cli.ts**

```typescript
import { logsCommand } from './commands/logs.js';

program
  .command('logs')
  .argument('[name]', 'deployment name (defaults to ./hermes.toml)')
  .option('--name <name>', 'deployment name (use instead of cwd lookup)')
  .option('--project <path>', 'project directory')
  .description("Stream the remote hermes-agent service log until Ctrl-C")
  .action(async (positionalName, opts) => {
    try {
      await logsCommand({
        name: opts.name ?? positionalName,
        projectPath: opts.project,
      });
    } catch (e) {
      console.error(`hermes-deploy logs: ${(e as Error).message}`);
      process.exit(1);
    }
  });
```

- [ ] **Step 3: Build + verify**

```bash
npm run build && ./dist/cli.js logs --help
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/logs.ts src/cli.ts
git commit -m "feat(cli): logs command streaming journalctl until Ctrl-C"
```

---

### Phase D — `init` command

#### Task D1: Init templates and command

**Files:**
- Create: `src/init-templates/hermes-toml.ts` (exports `HERMES_TOML_TEMPLATE`)
- Create: `src/init-templates/soul.ts` (exports `SOUL_MD_TEMPLATE`)
- Create: `src/init-templates/gitignore.ts` (exports `PROJECT_GITIGNORE_TEMPLATE`)
- Create: `src/commands/init.ts`
- Create: `tests/unit/commands/init.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create the three template files**

`src/init-templates/hermes-toml.ts`:

```typescript
export const HERMES_TOML_TEMPLATE = (name: string) => `name = "${name}"

[cloud]
provider = "aws"       # or "gcp" (coming in M3)
profile = "default"     # aws profile or gcp project id
region = "eu-west-3"
size = "small"          # "small" | "medium" | "large"

[network]
ssh_allowed_from = "auto"   # "auto" = your current public IP; or a CIDR
inbound_ports = []          # e.g. [443] for webhooks

[hermes]
model = "anthropic/claude-sonnet-4-5"
soul = "./SOUL.md"
secrets_file = "./secrets.enc.yaml"

[hermes.platforms.discord]
enabled = true
token_key = "discord_bot_token"

# [hermes.platforms.telegram]
# enabled = true
# token_key = "telegram_bot_token"

# [[hermes.mcp_servers]]
# name = "github"
# command = "npx"
# args = ["@modelcontextprotocol/server-github"]
# env_keys = ["github_token"]
`;
```

`src/init-templates/soul.ts`:

```typescript
export const SOUL_MD_TEMPLATE = `# SOUL.md — your agent's personality

You are a helpful assistant. Replace this with your agent's personality,
operating instructions, and any context that should inform every response.

This file is read by hermes-agent at startup. Changes require a redeploy
(\`hermes-deploy update\`).
`;
```

`src/init-templates/gitignore.ts`:

```typescript
export const PROJECT_GITIGNORE_TEMPLATE = `# hermes-deploy generated
.hermes-deploy/
*.log
`;
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initCommand } from '../../../src/commands/init.js';

describe('initCommand', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hermes-init-'));
    process.chdir(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates hermes.toml, SOUL.md, and .gitignore', async () => {
    await initCommand({ name: 'test-bot' });
    expect(existsSync(join(dir, 'hermes.toml'))).toBe(true);
    expect(existsSync(join(dir, 'SOUL.md'))).toBe(true);
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
    expect(readFileSync(join(dir, 'hermes.toml'), 'utf-8')).toContain('name = "test-bot"');
  });

  it('refuses to overwrite existing hermes.toml', async () => {
    await initCommand({ name: 'first' });
    await expect(initCommand({ name: 'second' })).rejects.toThrow(/already exists/);
  });

  it('accepts a default name derived from the directory', async () => {
    await initCommand({});
    const toml = readFileSync(join(dir, 'hermes.toml'), 'utf-8');
    // name should match the sanitized basename of dir
    expect(toml).toMatch(/^name = "hermes-init/m);
  });
});
```

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: Implement `src/commands/init.ts`**

```typescript
import { existsSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { HERMES_TOML_TEMPLATE } from '../init-templates/hermes-toml.js';
import { SOUL_MD_TEMPLATE } from '../init-templates/soul.js';
import { PROJECT_GITIGNORE_TEMPLATE } from '../init-templates/gitignore.js';

export interface InitOptions {
  name?: string;
  dir?: string;
}

export async function initCommand(opts: InitOptions): Promise<void> {
  const dir = opts.dir ?? process.cwd();
  const tomlPath = join(dir, 'hermes.toml');
  if (existsSync(tomlPath)) {
    throw new Error(`hermes.toml already exists at ${tomlPath}`);
  }

  const name = opts.name ?? sanitizeName(basename(dir));
  writeFileSync(tomlPath, HERMES_TOML_TEMPLATE(name));

  const soulPath = join(dir, 'SOUL.md');
  if (!existsSync(soulPath)) writeFileSync(soulPath, SOUL_MD_TEMPLATE);

  const gitignorePath = join(dir, '.gitignore');
  if (!existsSync(gitignorePath)) writeFileSync(gitignorePath, PROJECT_GITIGNORE_TEMPLATE);

  console.log(`Scaffolded hermes-deploy project at ${dir}`);
  console.log('Next steps:');
  console.log('  1. edit hermes.toml (cloud, region, platforms)');
  console.log('  2. edit SOUL.md (agent personality)');
  console.log('  3. hermes-deploy secret set <key> <value>');
  console.log('  4. hermes-deploy up');
}

function sanitizeName(raw: string): string {
  // Lowercase, replace invalid chars with hyphens, trim to 63 chars,
  // drop leading non-alphanumeric.
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const trimmed = cleaned.slice(0, 63) || 'hermes-bot';
  return /^[a-z0-9]/.test(trimmed) ? trimmed : `hermes-${trimmed}`;
}
```

- [ ] **Step 5: Run tests — 3/3 PASS**

- [ ] **Step 6: Register in `src/cli.ts`**

```typescript
import { initCommand } from './commands/init.js';

program
  .command('init')
  .option('--name <name>', 'deployment name (defaults to sanitized directory name)')
  .description('Scaffold a new hermes-deploy project in the current directory')
  .action(async (opts) => {
    try {
      await initCommand({ name: opts.name });
    } catch (e) {
      console.error(`hermes-deploy init: ${(e as Error).message}`);
      process.exit(1);
    }
  });
```

- [ ] **Step 7: Commit**

```bash
git add src/init-templates/ src/commands/init.ts tests/unit/commands/init.test.ts src/cli.ts
git commit -m "feat(cli): init command scaffolds hermes.toml, SOUL.md, .gitignore"
```

---

### Phase E — `secret` subcommands

#### Task E1: `secret set/get/rm/edit/list`

**Files:**
- Create: `src/commands/secret.ts`
- Create: `tests/unit/commands/secret.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { secretSet, secretGet, secretRemove, secretList } from '../../../src/commands/secret.js';
import { ensureSopsBootstrap } from '../../../src/sops/bootstrap.js';
import { StateStore } from '../../../src/state/store.js';
import { getStatePaths } from '../../../src/state/paths.js';

const sopsAvailable = (() => {
  try { execSync('which sops', { stdio: 'ignore' }); execSync('which age-keygen', { stdio: 'ignore' }); return true; }
  catch { return false; }
})();

describe.skipIf(!sopsAvailable)('secret subcommands', () => {
  let projectDir: string;
  let configDir: string;

  beforeEach(async () => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-secret-'));
    projectDir = join(root, 'project');
    configDir = join(root, 'config');
    mkdirSync(projectDir);
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = configDir;

    // Generate a real age key and set up sops
    const ageOutput = execSync('age-keygen', { encoding: 'utf-8' });
    const pubMatch = ageOutput.match(/^# public key: (age1[a-z0-9]+)$/m);
    if (!pubMatch || !pubMatch[1]) throw new Error('age-keygen output missing pub key');
    const publicKey = pubMatch[1];
    const ageKeyPath = join(configDir, 'hermes-deploy/age_keys/test');
    mkdirSync(join(configDir, 'hermes-deploy/age_keys'), { recursive: true });
    writeFileSync(ageKeyPath, ageOutput);
    process.env['SOPS_AGE_KEY_FILE'] = ageKeyPath;
    ensureSopsBootstrap(projectDir, publicKey);

    // Seed state with a deployment pointing at projectDir
    const store = new StateStore(getStatePaths());
    await store.update(state => {
      state.deployments['test'] = {
        project_path: projectDir,
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-04-01T00:00:00Z',
        last_deployed_at: '2026-04-01T00:00:00Z',
        last_config_hash: 'sha256:x',
        ssh_key_path: '/x',
        age_key_path: ageKeyPath,
        health: 'healthy',
        instance_ip: '0.0.0.0',
        cloud_resources: {
          instance_id: 'i-1',
          security_group_id: 'sg-1',
          key_pair_name: 'kp-1',
          eip_allocation_id: 'eipalloc-1',
          region: 'eu-west-3',
        },
      };
    });

    // hermes.toml so cwd resolution works from projectDir
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
token_key = "discord_bot_token"
`);
    writeFileSync(join(projectDir, 'SOUL.md'), '# soul');
    process.chdir(projectDir);
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('sets and gets a secret value', async () => {
    await secretSet({ key: 'discord_bot_token', value: 'my-token-123' });
    const got = await secretGet({ key: 'discord_bot_token' });
    expect(got).toBe('my-token-123');
  });

  it('lists secret keys (without values)', async () => {
    await secretSet({ key: 'a', value: '1' });
    await secretSet({ key: 'b', value: '2' });
    const keys = await secretList({});
    expect(keys).toContain('a');
    expect(keys).toContain('b');
  });

  it('removes a secret', async () => {
    await secretSet({ key: 'ephemeral', value: 'gone' });
    await secretRemove({ key: 'ephemeral' });
    const keys = await secretList({});
    expect(keys).not.toContain('ephemeral');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `src/commands/secret.ts`**

```typescript
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
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
    throw new Error(`deployment "${resolvedName}" not found in state — run \`hermes-deploy up\` first`);
  }
  const secretsPath = join(resolvedProject, 'secrets.enc.yaml');
  return { projectDir: resolvedProject, secretsPath, ageKeyPath: deployment.age_key_path };
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

export async function secretSet(opts: { key: string; value: string; name?: string; projectPath?: string }): Promise<void> {
  const ctx = await getContext(opts.name, opts.projectPath);
  // Decrypt, mutate, re-encrypt. Using `sops --set` is cleaner but has quoting
  // quirks with YAML values; decrypt/mutate/encrypt is more robust.
  const decrypted = runSops(['--decrypt', ctx.secretsPath], ctx.ageKeyPath);
  const data = (parseYaml(decrypted) ?? {}) as Record<string, unknown>;
  data[opts.key] = opts.value;
  const plain = stringifyYaml(data);
  // Write plain, then re-encrypt in place
  const { writeFileSync } = await import('node:fs');
  writeFileSync(ctx.secretsPath, plain);
  runSops(['--encrypt', '--in-place', ctx.secretsPath], ctx.ageKeyPath);
}

export async function secretGet(opts: { key: string; name?: string; projectPath?: string }): Promise<string | undefined> {
  const ctx = await getContext(opts.name, opts.projectPath);
  const decrypted = runSops(['--decrypt', ctx.secretsPath], ctx.ageKeyPath);
  const data = (parseYaml(decrypted) ?? {}) as Record<string, unknown>;
  const v = data[opts.key];
  return v === undefined ? undefined : String(v);
}

export async function secretRemove(opts: { key: string; name?: string; projectPath?: string }): Promise<void> {
  const ctx = await getContext(opts.name, opts.projectPath);
  const decrypted = runSops(['--decrypt', ctx.secretsPath], ctx.ageKeyPath);
  const data = (parseYaml(decrypted) ?? {}) as Record<string, unknown>;
  delete data[opts.key];
  const plain = stringifyYaml(data);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(ctx.secretsPath, plain);
  runSops(['--encrypt', '--in-place', ctx.secretsPath], ctx.ageKeyPath);
}

export async function secretList(opts: { name?: string; projectPath?: string }): Promise<string[]> {
  const ctx = await getContext(opts.name, opts.projectPath);
  const decrypted = runSops(['--decrypt', ctx.secretsPath], ctx.ageKeyPath);
  const data = (parseYaml(decrypted) ?? {}) as Record<string, unknown>;
  return Object.keys(data);
}

export async function secretEdit(opts: { name?: string; projectPath?: string }): Promise<void> {
  const ctx = await getContext(opts.name, opts.projectPath);
  // Shell out interactively — sops opens $EDITOR
  execFileSync('sops', [ctx.secretsPath], {
    stdio: 'inherit',
    env: { ...process.env, SOPS_AGE_KEY_FILE: ctx.ageKeyPath },
  });
}
```

Note: this file adds a new runtime dep `yaml`. Install it: `npm install yaml` (it's a widely-used, zero-dep YAML parser for Node; ~300 KB).

- [ ] **Step 4: Run tests — expected 3/3 PASS (skipped if no sops).**

- [ ] **Step 5: Register in `src/cli.ts`**

```typescript
import { secretSet, secretGet, secretRemove, secretList, secretEdit } from './commands/secret.js';

const secret = program.command('secret').description('Manage sops-encrypted secrets');

secret
  .command('set <key> <value>')
  .option('--name <name>', 'deployment name')
  .option('--project <path>', 'project directory')
  .action(async (key, value, opts) => {
    try { await secretSet({ key, value, name: opts.name, projectPath: opts.project }); }
    catch (e) { console.error(`hermes-deploy secret set: ${(e as Error).message}`); process.exit(1); }
  });

secret
  .command('get <key>')
  .option('--name <name>', 'deployment name')
  .option('--project <path>', 'project directory')
  .action(async (key, opts) => {
    try {
      const v = await secretGet({ key, name: opts.name, projectPath: opts.project });
      if (v === undefined) { console.error(`no such secret: ${key}`); process.exit(1); }
      console.log(v);
    } catch (e) { console.error(`hermes-deploy secret get: ${(e as Error).message}`); process.exit(1); }
  });

secret
  .command('rm <key>')
  .option('--name <name>', 'deployment name')
  .option('--project <path>', 'project directory')
  .action(async (key, opts) => {
    try { await secretRemove({ key, name: opts.name, projectPath: opts.project }); }
    catch (e) { console.error(`hermes-deploy secret rm: ${(e as Error).message}`); process.exit(1); }
  });

secret
  .command('list')
  .option('--name <name>', 'deployment name')
  .option('--project <path>', 'project directory')
  .action(async (opts) => {
    try {
      const keys = await secretList({ name: opts.name, projectPath: opts.project });
      for (const k of keys) console.log(k);
    } catch (e) { console.error(`hermes-deploy secret list: ${(e as Error).message}`); process.exit(1); }
  });

secret
  .command('edit')
  .option('--name <name>', 'deployment name')
  .option('--project <path>', 'project directory')
  .action(async (opts) => {
    try { await secretEdit({ name: opts.name, projectPath: opts.project }); }
    catch (e) { console.error(`hermes-deploy secret edit: ${(e as Error).message}`); process.exit(1); }
  });
```

- [ ] **Step 6: Build + verify**

```bash
npm run build && ./dist/cli.js secret --help
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/commands/secret.ts tests/unit/commands/secret.test.ts src/cli.ts
git commit -m "feat(cli): secret set/get/rm/list/edit subcommands via sops"
```

---

### Phase F — `key` subcommands

#### Task F1: `key export/import/path`

**Files:**
- Create: `src/commands/key.ts`
- Create: `tests/unit/commands/key.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyExport, keyImport, keyPath } from '../../../src/commands/key.js';

describe('key subcommands', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'hermes-key-'));
    process.env.XDG_CONFIG_HOME = configDir;
    mkdirSync(join(configDir, 'hermes-deploy/age_keys'), { recursive: true });
    const path = join(configDir, 'hermes-deploy/age_keys/alpha');
    writeFileSync(path, '# public key: age1abc\nAGE-SECRET-KEY-1abc\n');
    chmodSync(path, 0o600);
  });

  afterEach(() => rmSync(configDir, { recursive: true, force: true }));

  it('exports the age key content', async () => {
    const content = await keyExport({ name: 'alpha' });
    expect(content).toContain('AGE-SECRET-KEY-1abc');
  });

  it('throws on export of a missing key', async () => {
    await expect(keyExport({ name: 'missing' })).rejects.toThrow(/no age key/);
  });

  it('imports an age key to the right path with chmod 600', async () => {
    const src = join(configDir, 'external.key');
    writeFileSync(src, '# public key: age1xyz\nAGE-SECRET-KEY-1xyz\n');
    await keyImport({ name: 'imported', path: src });
    const dest = join(configDir, 'hermes-deploy/age_keys/imported');
    expect(existsSync(dest)).toBe(true);
    expect((statSync(dest).mode & 0o777)).toBe(0o600);
    expect(readFileSync(dest, 'utf-8')).toContain('AGE-SECRET-KEY-1xyz');
  });

  it('refuses to overwrite an existing key on import', async () => {
    const src = join(configDir, 'external.key');
    writeFileSync(src, 'age key content');
    await expect(keyImport({ name: 'alpha', path: src })).rejects.toThrow(/already exists/);
  });

  it('reports the on-disk path of a key', async () => {
    const p = await keyPath({ name: 'alpha' });
    expect(p).toBe(join(configDir, 'hermes-deploy/age_keys/alpha'));
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `src/commands/key.ts`**

```typescript
import { copyFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { getStatePaths } from '../state/paths.js';

export async function keyExport(opts: { name: string }): Promise<string> {
  const paths = getStatePaths();
  const keyPath = paths.ageKeyForDeployment(opts.name);
  if (!existsSync(keyPath)) {
    throw new Error(`no age key for deployment "${opts.name}" at ${keyPath}`);
  }
  return readFileSync(keyPath, 'utf-8');
}

export async function keyImport(opts: { name: string; path: string }): Promise<string> {
  const paths = getStatePaths();
  const destPath = paths.ageKeyForDeployment(opts.name);
  if (existsSync(destPath)) {
    throw new Error(
      `age key for "${opts.name}" already exists at ${destPath} — remove it first if you really want to overwrite`,
    );
  }
  if (!existsSync(opts.path)) {
    throw new Error(`source file does not exist: ${opts.path}`);
  }
  // Ensure the parent dir exists
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(opts.path, destPath);
  chmodSync(destPath, 0o600);
  return destPath;
}

export async function keyPath(opts: { name: string }): Promise<string> {
  return getStatePaths().ageKeyForDeployment(opts.name);
}
```

- [ ] **Step 4: Run tests — 5/5 PASS.**

- [ ] **Step 5: Register in cli.ts**

```typescript
import { keyExport, keyImport, keyPath } from './commands/key.js';

const key = program.command('key').description('Manage per-deployment age keys');

key
  .command('export <name>')
  .description('Write the age private key for a deployment to stdout')
  .action(async (name) => {
    try { process.stdout.write(await keyExport({ name })); }
    catch (e) { console.error(`hermes-deploy key export: ${(e as Error).message}`); process.exit(1); }
  });

key
  .command('import <name> <path>')
  .description('Copy an age private key into the hermes-deploy config')
  .action(async (name, path) => {
    try { console.log(await keyImport({ name, path })); }
    catch (e) { console.error(`hermes-deploy key import: ${(e as Error).message}`); process.exit(1); }
  });

key
  .command('path <name>')
  .description('Print the on-disk path of a deployment\\'s age key')
  .action(async (name) => {
    try { console.log(await keyPath({ name })); }
    catch (e) { console.error(`hermes-deploy key path: ${(e as Error).message}`); process.exit(1); }
  });
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/key.ts tests/unit/commands/key.test.ts src/cli.ts
git commit -m "feat(cli): key export/import/path for multi-machine age key sync"
```

---

### Phase G — Schema migration scaffold

#### Task G1: Migration runner

**Files:**
- Create: `src/state/migrations.ts`
- Modify: `src/state/store.ts` (invoke runner before validation)
- Modify: `src/schema/state-toml.ts` (allow current_version to be loose during migration)
- Create: `tests/unit/state/migrations.test.ts`
- Create: `tests/fixtures/state-migrations/v0-legacy.toml`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { runMigrations, CURRENT_SCHEMA_VERSION } from '../../../src/state/migrations.js';

describe('runMigrations', () => {
  it('is a no-op on an already-current state', () => {
    const state = { schema_version: 1, deployments: {} };
    const migrated = runMigrations(state);
    expect(migrated).toEqual(state);
  });

  it('migrates a synthetic v0 state to v1', () => {
    // v0 had no schema_version field and stored deployments as a flat array
    const v0 = {
      deployments: [
        {
          name: 'legacy',
          project_path: '/legacy',
          cloud: 'aws',
          region: 'eu-west-3',
          last_deployed: '2025-06-01T00:00:00Z',
          aws: { instance_id: 'i-old', security_group_id: 'sg-old', key_pair_name: 'kp-old', eip_allocation_id: 'eipalloc-old' },
        },
      ],
    };
    const migrated = runMigrations(v0) as any;
    expect(migrated.schema_version).toBe(1);
    expect(migrated.deployments.legacy).toBeDefined();
    expect(migrated.deployments.legacy.cloud).toBe('aws');
    expect(migrated.deployments.legacy.cloud_resources.instance_id).toBe('i-old');
  });

  it('exports the current version constant', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });

  it('throws on a future schema_version', () => {
    expect(() => runMigrations({ schema_version: 99, deployments: {} })).toThrow(/newer/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `src/state/migrations.ts`**

```typescript
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Forward migration functions keyed by TARGET version. `migrations[N]`
 * accepts state at version N-1 and returns state at version N.
 *
 * M2 ships with one scaffolded migration (v0 → v1) that covers a synthetic
 * v0 shape. The scaffold exists so M3/M4 schema evolutions have a proven
 * runner to plug into, not because v0 ever shipped publicly.
 */
const migrations: Record<number, (input: unknown) => unknown> = {
  1: (input: unknown) => {
    const src = input as {
      schema_version?: number;
      deployments?: unknown;
    };

    // Synthetic v0 shape: no schema_version, deployments is a flat array
    // with per-entry `name` and a separate `aws`/`gcp` field instead of
    // cloud_resources.
    if (src.schema_version === undefined && Array.isArray(src.deployments)) {
      const out: Record<string, unknown> = {};
      for (const entry of src.deployments as any[]) {
        const { name, aws, gcp, last_deployed, ...rest } = entry;
        const cloud_resources = aws ?? gcp ?? {};
        out[name] = {
          ...rest,
          last_deployed_at: last_deployed ?? new Date(0).toISOString(),
          created_at: last_deployed ?? new Date(0).toISOString(),
          last_config_hash: 'sha256:migrated',
          ssh_key_path: rest.ssh_key_path ?? '/unknown',
          age_key_path: rest.age_key_path ?? '/unknown',
          health: rest.health ?? 'unknown',
          instance_ip: rest.instance_ip ?? '0.0.0.0',
          cloud_resources: {
            ...cloud_resources,
            region: cloud_resources.region ?? entry.region ?? 'unknown',
          },
        };
      }
      return { schema_version: 1, deployments: out };
    }

    // Already v1 — no-op
    if (src.schema_version === 1) return src;

    throw new Error(`cannot migrate to v1 from unrecognized input shape`);
  },
};

export function runMigrations(input: unknown): unknown {
  let current = input as { schema_version?: number };
  const startVersion =
    typeof current.schema_version === 'number' ? current.schema_version : 0;

  if (startVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `state file schema_version=${startVersion} is newer than CLI version (${CURRENT_SCHEMA_VERSION}) — upgrade hermes-deploy`,
    );
  }

  for (let target = startVersion + 1; target <= CURRENT_SCHEMA_VERSION; target++) {
    const migration = migrations[target];
    if (!migration) {
      throw new Error(`missing migration to v${target}`);
    }
    current = migration(current) as any;
  }

  return current;
}
```

- [ ] **Step 4: Wire into `src/state/store.ts`**

In `read()`, after `parseToml` but before `StateTomlSchema.safeParse`, invoke `runMigrations`:

```typescript
import { runMigrations } from './migrations.js';

// Inside read():
const parsed = parseToml(raw);
const migrated = runMigrations(parsed);
const result = StateTomlSchema.safeParse(migrated);
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/unit/state/migrations.test.ts tests/unit/state/store.test.ts
```

Expected: migrations 4/4 PASS, store tests continue to pass (they were already v1 so migrations is a no-op).

- [ ] **Step 6: Commit**

```bash
git add src/state/migrations.ts src/state/store.ts tests/unit/state/migrations.test.ts
git commit -m "feat(state): schema migration scaffold with runner and v0→v1 fixture"
```

---

### Phase H — Ink UI

#### Task H1: Install Ink + React

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install deps**

```bash
npm install ink@^5 react@^18
npm install --save-dev @types/react@^18 ink-testing-library
```

- [ ] **Step 2: Enable TSX in tsup**

Add to `tsup.config.ts`:

```typescript
  loader: { '.tsx': 'tsx' },
```

In `tsconfig.json`, add:

```json
  "jsx": "react-jsx",
```

- [ ] **Step 3: Verify build still works**

```bash
npx tsc --noEmit && npm run build
```

Expected: no errors. `dist/cli.js` still produced.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tsup.config.ts tsconfig.json
git commit -m "chore(ui): install ink + react and enable tsx compilation"
```

#### Task H2: InkReporter + DeployTimeline component

**Files:**
- Create: `src/ui/index.ts`
- Create: `src/ui/components/PhaseRow.tsx`
- Create: `src/ui/components/DeployTimeline.tsx`
- Create: `src/ui/tty.ts`
- Create: `tests/unit/ui/DeployTimeline.test.tsx`

- [ ] **Step 1: Implement `src/ui/tty.ts`**

```typescript
export function shouldUseInk(): boolean {
  if (process.env.HERMES_DEPLOY_NO_INK === '1') return false;
  if (process.argv.includes('--no-ink')) return false;
  return process.stdout.isTTY === true;
}
```

- [ ] **Step 2: Implement `src/ui/components/PhaseRow.tsx`**

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner'; // install separately if needed: npm i ink-spinner

export type PhaseStatus = 'pending' | 'running' | 'done' | 'failed';

export interface PhaseRowProps {
  label: string;
  status: PhaseStatus;
  error?: string;
}

const STATUS_CHAR: Record<PhaseStatus, string> = {
  pending: '○',
  running: '◐',
  done: '✓',
  failed: '✗',
};

const STATUS_COLOR: Record<PhaseStatus, string> = {
  pending: 'gray',
  running: 'cyan',
  done: 'green',
  failed: 'red',
};

export function PhaseRow({ label, status, error }: PhaseRowProps) {
  return (
    <Box>
      <Text color={STATUS_COLOR[status]}>
        {status === 'running' ? <Spinner type="dots" /> : STATUS_CHAR[status]}
      </Text>
      <Text> {label}</Text>
      {error && <Text color="red"> — {error}</Text>}
    </Box>
  );
}
```

Note: `ink-spinner` is a small separate package used by most Ink CLIs. Install it: `npm install ink-spinner@^5`.

- [ ] **Step 3: Implement `src/ui/components/DeployTimeline.tsx`**

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { PhaseRow, type PhaseStatus } from './PhaseRow.js';

export interface TimelinePhase {
  id: string;
  label: string;
  status: PhaseStatus;
  error?: string;
}

export interface DeployTimelineProps {
  phases: TimelinePhase[];
  logLines: string[];
  finalMessage?: string;
  finalStatus?: 'success' | 'failure';
}

export function DeployTimeline({ phases, logLines, finalMessage, finalStatus }: DeployTimelineProps) {
  const recentLogs = logLines.slice(-10);
  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {phases.map(p => (
          <PhaseRow key={p.id} label={p.label} status={p.status} error={p.error} />
        ))}
      </Box>
      {recentLogs.length > 0 && (
        <Box flexDirection="column" marginTop={1} paddingLeft={4}>
          {recentLogs.map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      )}
      {finalMessage && (
        <Box marginTop={1}>
          <Text color={finalStatus === 'success' ? 'green' : 'red'} bold>
            {finalMessage}
          </Text>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Implement `src/ui/index.ts` — the InkReporter class**

```typescript
import React from 'react';
import { render, type Instance } from 'ink';
import { DeployTimeline, type TimelinePhase } from './components/DeployTimeline.js';
import type { Reporter, PhaseId } from '../orchestrator/reporter.js';

const PHASE_LABELS: Record<PhaseId, string> = {
  validate: 'Validating project configuration',
  'ensure-keys': 'Preparing SSH and age keys',
  provision: 'Provisioning cloud resources',
  'wait-ssh': 'Waiting for SSH',
  bootstrap: 'Uploading config and running nixos-rebuild',
  healthcheck: 'Waiting for hermes-agent.service',
};

const ORDERED_PHASE_IDS: PhaseId[] = [
  'validate',
  'ensure-keys',
  'provision',
  'wait-ssh',
  'bootstrap',
  'healthcheck',
];

interface InkReporterState {
  phases: TimelinePhase[];
  logLines: string[];
  finalMessage?: string;
  finalStatus?: 'success' | 'failure';
}

export function createInkReporter(): Reporter {
  let state: InkReporterState = {
    phases: ORDERED_PHASE_IDS.map(id => ({
      id,
      label: PHASE_LABELS[id],
      status: 'pending',
    })),
    logLines: [],
  };
  let instance: Instance | null = null;

  const rerender = () => {
    if (!instance) {
      instance = render(<DeployTimeline {...state} />);
    } else {
      instance.rerender(<DeployTimeline {...state} />);
    }
  };

  const updatePhase = (id: PhaseId, change: Partial<TimelinePhase>) => {
    state = {
      ...state,
      phases: state.phases.map(p => (p.id === id ? { ...p, ...change } : p)),
    };
    rerender();
  };

  return {
    phaseStart(id, label) {
      updatePhase(id as PhaseId, { label, status: 'running' });
    },
    phaseDone(id) {
      updatePhase(id as PhaseId, { status: 'done' });
    },
    phaseFail(id, error) {
      updatePhase(id as PhaseId, { status: 'failed', error });
    },
    log(line) {
      state = { ...state, logLines: [...state.logLines, line] };
      rerender();
    },
    success(summary) {
      state = { ...state, finalMessage: summary, finalStatus: 'success' };
      rerender();
      instance?.unmount();
    },
  };
}
```

- [ ] **Step 5: Test with ink-testing-library**

```typescript
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { DeployTimeline } from '../../../src/ui/components/DeployTimeline.js';

describe('<DeployTimeline />', () => {
  it('renders pending phases with a neutral marker', () => {
    const { lastFrame } = render(
      <DeployTimeline
        phases={[
          { id: 'validate', label: 'Validating', status: 'pending' },
          { id: 'provision', label: 'Provisioning', status: 'pending' },
        ]}
        logLines={[]}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Validating');
    expect(frame).toContain('Provisioning');
    expect(frame).toContain('○');
  });

  it('renders a done phase with a checkmark', () => {
    const { lastFrame } = render(
      <DeployTimeline
        phases={[{ id: 'validate', label: 'Validating', status: 'done' }]}
        logLines={[]}
      />,
    );
    expect(lastFrame() ?? '').toContain('✓');
  });

  it('renders a failure state with the error message', () => {
    const { lastFrame } = render(
      <DeployTimeline
        phases={[{ id: 'healthcheck', label: 'Healthcheck', status: 'failed', error: 'service is not active' }]}
        logLines={[]}
        finalMessage="deploy failed"
        finalStatus="failure"
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('service is not active');
    expect(frame).toContain('deploy failed');
  });

  it('shows the last 10 log lines', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line-${i}`);
    const { lastFrame } = render(
      <DeployTimeline
        phases={[{ id: 'bootstrap', label: 'Bootstrap', status: 'running' }]}
        logLines={lines}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('line-14');
    expect(frame).not.toContain('line-0');
  });
});
```

- [ ] **Step 6: Run tests — 4/4 PASS**

- [ ] **Step 7: Commit**

```bash
git add src/ui/ tests/unit/ui/ package.json package-lock.json
git commit -m "feat(ui): InkReporter with DeployTimeline + PhaseRow components"
```

#### Task H3: Wire Ink into commands

**Files:**
- Modify: `src/commands/up.ts`, `src/commands/update.ts` (use InkReporter when TTY)

- [ ] **Step 1: Update `up.ts` and `update.ts` to pick the reporter based on TTY**

Add near the top of each command:

```typescript
import { shouldUseInk } from '../ui/tty.js';
import { createInkReporter } from '../ui/index.js';
import { createPlainReporter } from '../orchestrator/reporter.js';

const reporter = shouldUseInk() ? createInkReporter() : createPlainReporter();
```

Pass `reporter` through to `runDeploy` / `runUpdate`:

```typescript
await runDeploy({
  ...,
  reporter,
});
```

- [ ] **Step 2: Build + verify**

```bash
npm run build
# Interactive: ./dist/cli.js up (in a project)
# Non-TTY: ./dist/cli.js up < /dev/null 2>&1 | cat   # should use plain reporter
HERMES_DEPLOY_NO_INK=1 ./dist/cli.js up  # env opt-out
```

Full tests + typecheck should pass.

- [ ] **Step 3: Commit**

```bash
git add src/commands/up.ts src/commands/update.ts
git commit -m "feat(ui): use InkReporter on TTY with --no-ink opt-out for up and update"
```

---

### Phase I — Documentation

#### Task I1: Update README + new docs

**Files:**
- Modify: `README.md`
- Create: `docs/getting-started.md`
- Create: `docs/schema-reference.md`
- Create: `docs/multi-machine-key-sync.md`

- [ ] **Step 1: Update `README.md`**

Replace the "Status: M1" banner at the top with:

```markdown
> **Status: M2 (AWS feature-complete).** All lifecycle commands work on AWS:
> `init`, `up`, `update`, `destroy`, `status`, `logs`, `ssh`, `ls`, `secret`, `key`.
> Ink UI on TTY. GCP coming in M3.
```

Update the "What's deferred" section to reflect M3/M4 (no more "no update", "no logs", "no Ink" — those shipped).

Add an "Ink UI" section with a sentence about `--no-ink`/`HERMES_DEPLOY_NO_INK`.

- [ ] **Step 2: Write `docs/getting-started.md`**

A 5-minute walkthrough:

1. Prereqs (Node 20+, age, sops, aws credentials)
2. `npm install -g @hermes-deploy/cli` (or `npm link` from source)
3. `mkdir my-bot && cd my-bot && hermes-deploy init`
4. Edit `hermes.toml`
5. `hermes-deploy secret set discord_bot_token <token>`
6. `hermes-deploy up`
7. `hermes-deploy logs`
8. Iterate: edit, `hermes-deploy update`
9. Tear down: `hermes-deploy destroy`

- [ ] **Step 3: Write `docs/schema-reference.md`**

A field-by-field reference for `hermes.toml`. Tables with field name, type, required/optional, default, description. Separate sections for `[cloud]`, `[network]`, `[hermes]`, `[hermes.platforms.*]`, `[[hermes.mcp_servers]]`, `[hermes.nix_extra]`.

- [ ] **Step 4: Write `docs/multi-machine-key-sync.md`**

A short guide on moving a project between machines:

1. On machine A: `hermes-deploy key export acme-bot > acme.key`
2. Copy `acme.key` securely to machine B (encrypted USB, 1Password, etc. — NOT email)
3. On machine B: `git clone` the project, `hermes-deploy key import acme-bot ./acme.key`
4. `hermes-deploy update` to pick up where you left off
5. Warning: the age key is a long-lived credential; treat it like an SSH private key

- [ ] **Step 5: Commit**

```bash
git add README.md docs/getting-started.md docs/schema-reference.md docs/multi-machine-key-sync.md
git commit -m "docs: update README for M2 and add getting-started, schema-reference, key-sync guides"
```

---

## Self-Review

After all tasks complete, verify:

### Spec coverage

Every M2-scoped item in the design spec maps to a task in this plan:

| Spec feature | Task(s) |
|---|---|
| `update` command (spec §8.2) | A1, A2, A3, A4 |
| Network rule reconciliation | A1, A2, A3 |
| `logs` command | C1, C2 |
| `ls` command (with `--watch`) | B2, H3 (dashboard is in H3 for watch mode) |
| `init` command | D1 |
| `secret` subcommands (set/get/rm/edit/list) | E1 |
| `key` export/import | F1 |
| `--name` / `--project` resolution | B1 |
| Multi-instance global state | B1, B2 (uses M1's existing store) |
| Schema migration runner | G1 |
| Ink UI (timeline, dashboard, log stream) | H1, H2, H3 |
| TTY detection + opt-out | H1, H3 |

### Commands before/after

**M1:** `up`, `destroy`, `status`, `ssh` (4 commands)
**M2:** `init`, `up`, `update`, `destroy`, `status`, `logs`, `ssh`, `ls`, `secret {set,get,rm,edit,list}`, `key {export,import,path}` (8 top-level + 2 groups with 5+3 subcommands)

### Test count target

M1 shipped with 60 tests. M2 adds:
- reconcile-network (4 tests)
- update orchestrator (3 tests)
- resolve helper (5 tests)
- ls (3 tests)
- init (3 tests)
- secret (3 tests, skipped if no sops)
- key (5 tests)
- migrations (4 tests)
- DeployTimeline (4 tests)

Total new: ~34 tests. Target M2 test count: ~94.

### Placeholder scan

Grep the plan for TBD/TODO/FIXME/XXX/"fill in"/"similar to" — none should appear in task bodies.

### Type consistency

Cross-check types defined in earlier phases are used correctly in later phases:
- `Reporter` interface (M1 `src/orchestrator/reporter.ts`) consumed by both `createPlainReporter` (M1) and `createInkReporter` (H2)
- `DeployOptions` / `UpdateOptions` accept `reporter?: Reporter`
- `ResourceLedger` narrowing in `reconcile-network.ts`, `update.ts`, `ls.ts`, `destroy.ts` all use the same `kind` discriminator

### Missing tasks audit

No spec item in M2 scope is unimplemented.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-04-09-hermes-deploy-M2-aws-feature-complete.md`. Two execution options:

**1. Subagent-driven (recommended)** — fresh subagent per task, review between tasks. Same mode that shipped M1.

**2. Inline execution** — batch tasks in the current session with checkpoints.

Which approach?
