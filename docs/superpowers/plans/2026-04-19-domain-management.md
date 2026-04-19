# Domain Management & Health Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add domain management (DNS + nginx + TLS) and health verification to hermes-deploy so users can wire up custom domains via `hermes.toml` and verify them from the CLI and dashboard.

**Architecture:** New `[domain]` config section triggers DNS record creation (Route53/Cloud DNS), NixOS nginx+ACME config generation, and cloud firewall port 80/443 opening during deploy/update. A new domain-check module runs SSH-based and external health checks, exposed via CLI status and dashboard InfraTab.

**Tech Stack:** AWS SDK (`@aws-sdk/client-route-53`), GCP Cloud DNS (`@google-cloud/dns`), Zod schemas, NixOS nix-gen templates, React dashboard components.

---

### Task 1: Schema — Add `[domain]` to `hermes.toml`

**Files:**
- Modify: `src/schema/hermes-toml.ts`
- Create: `tests/fixtures/hermes-toml/m3-domain.toml`
- Modify: `tests/unit/schema/hermes-toml.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/schema/hermes-toml.test.ts`:

```typescript
it('accepts a config with [domain] section', () => {
  const raw = loadFixture('m3-domain.toml');
  const result = HermesTomlSchema.safeParse(raw);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.domain?.name).toBe('jarvis.backresto.com');
    expect(result.data.domain?.upstream_port).toBe(3000);
  }
});

it('rejects domain with invalid upstream_port', () => {
  const result = HermesTomlSchema.safeParse({
    name: 'bad-domain',
    cloud: { provider: 'aws', profile: 'd', region: 'eu-west-3', size: 'small' },
    hermes: { config_file: './c.yaml', secrets_file: './s.env.enc' },
    domain: { name: 'foo.example.com', upstream_port: 99999 },
  });
  expect(result.success).toBe(false);
});

it('accepts config without [domain] (optional)', () => {
  const raw = loadFixture('m3-minimal.toml');
  const result = HermesTomlSchema.safeParse(raw);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.domain).toBeUndefined();
  }
});
```

- [ ] **Step 2: Create the test fixture**

Create `tests/fixtures/hermes-toml/m3-domain.toml`:

```toml
name = "test-m3-domain"

[cloud]
provider = "aws"
profile = "default"
region = "eu-west-3"
size = "small"

[network]
ssh_allowed_from = "auto"

[hermes]
config_file = "./config.yaml"
secrets_file = "./secrets.env.enc"

[domain]
name = "jarvis.backresto.com"
upstream_port = 3000
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/schema/hermes-toml.test.ts`
Expected: FAIL — `domain` is not in the schema

- [ ] **Step 4: Add DomainSchema to hermes-toml.ts**

In `src/schema/hermes-toml.ts`, add before `HermesTomlSchema`:

```typescript
const DomainSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/, {
    message: 'domain.name must be a valid FQDN (lowercase alphanumeric, dots, hyphens)',
  }),
  upstream_port: z.number().int().min(1).max(65535),
});
```

Add `domain` to `HermesTomlSchema`:

```typescript
export const HermesTomlSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]{0,62}$/, {
    message: 'name must be lowercase alphanumeric with hyphens, 1-63 chars',
  }),
  cloud: CloudSchema,
  network: NetworkSchema.default({ ssh_allowed_from: 'auto', inbound_ports: [] }),
  hermes: HermesSchema,
  domain: DomainSchema.optional(),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/schema/hermes-toml.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/schema/hermes-toml.ts tests/fixtures/hermes-toml/m3-domain.toml tests/unit/schema/hermes-toml.test.ts
git commit -m "feat(schema): add optional [domain] section to hermes.toml"
```

---

### Task 2: Schema — Add domain fields to state.toml

**Files:**
- Modify: `src/schema/state-toml.ts`
- Modify: `tests/unit/schema/state-toml.test.ts` (if exists, otherwise `tests/unit/state/store.test.ts`)

- [ ] **Step 1: Write the failing test**

Add to the state schema test file:

```typescript
it('accepts a deployment with domain_name and dns_record_id', () => {
  const state = {
    schema_version: 3,
    deployments: {
      test: {
        project_path: '/tmp/test',
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-01-01T00:00:00Z',
        last_deployed_at: '2026-01-01T00:00:00Z',
        last_config_hash: 'sha256:abc',
        last_nix_hash: 'sha256:def',
        ssh_key_path: '/tmp/key',
        age_key_path: '/tmp/age',
        health: 'healthy',
        instance_ip: '1.2.3.4',
        domain_name: 'jarvis.backresto.com',
        dns_record_id: 'Z1234/jarvis.backresto.com',
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
  const result = StateTomlSchema.safeParse(state);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.deployments.test.domain_name).toBe('jarvis.backresto.com');
    expect(result.data.deployments.test.dns_record_id).toBe('Z1234/jarvis.backresto.com');
  }
});

it('accepts a deployment without domain fields (backward compat)', () => {
  const state = {
    schema_version: 3,
    deployments: {
      test: {
        project_path: '/tmp/test',
        cloud: 'aws',
        region: 'eu-west-3',
        created_at: '2026-01-01T00:00:00Z',
        last_deployed_at: '2026-01-01T00:00:00Z',
        last_config_hash: 'sha256:abc',
        last_nix_hash: 'sha256:def',
        ssh_key_path: '/tmp/key',
        age_key_path: '/tmp/age',
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
  const result = StateTomlSchema.safeParse(state);
  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schema/state-toml.test.ts` (or the relevant state test file)
Expected: FAIL — `domain_name` not in schema

- [ ] **Step 3: Add domain fields to BaseDeploymentSchema**

In `src/schema/state-toml.ts`, add to `BaseDeploymentSchema`:

```typescript
domain_name: z.string().min(1).optional(),
dns_record_id: z.string().min(1).optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/schema/state-toml.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/schema/state-toml.ts tests/unit/schema/state-toml.test.ts
git commit -m "feat(schema): add domain_name and dns_record_id to state"
```

---

### Task 3: Schema — Add domain check types to DTO

**Files:**
- Modify: `src/schema/dto.ts`

- [ ] **Step 1: Add DomainCheckDto schema and extend StatusPayloadDtoSchema**

In `src/schema/dto.ts`, add before the `StatusPayloadDtoSchema`:

```typescript
// ---------- Domain health checks ----------

export const DomainCheckDtoSchema = z.object({
  name: z.string(),
  checks: z.object({
    dns: z.object({
      ok: z.boolean(),
      resolvedIp: z.string().nullable(),
      expectedIp: z.string(),
      matches: z.boolean(),
    }),
    tls: z.object({
      ok: z.boolean(),
      valid: z.boolean(),
      expiresAt: z.string().nullable(),
      daysRemaining: z.number().nullable(),
    }),
    nginx: z.object({
      ok: z.boolean(),
      active: z.boolean(),
      configValid: z.boolean(),
    }),
    upstream: z.object({
      ok: z.boolean(),
      httpStatus: z.number().nullable(),
    }),
    https: z.object({
      ok: z.boolean(),
      httpStatus: z.number().nullable(),
    }),
  }),
});
export type DomainCheckDto = z.infer<typeof DomainCheckDtoSchema>;
```

Add `domain` field to `StatusPayloadDtoSchema`:

```typescript
export const StatusPayloadDtoSchema = z.object({
  name: z.string(),
  found: z.boolean(),
  stored: z.object({
    cloud: z.enum(['aws', 'gcp']),
    region: z.string(),
    instance_ip: z.string(),
    last_config_hash: z.string(),
    last_nix_hash: z.string(),
    last_deployed_at: z.string(),
    health: z.enum(['healthy', 'unhealthy', 'unknown']),
    ssh_key_path: z.string(),
    age_key_path: z.string(),
  }).optional(),
  live: InstanceStatusDtoSchema.optional(),
  domain: DomainCheckDtoSchema.optional(),
});
```

- [ ] **Step 2: Add `dns` phase to PhaseIdSchema**

In `src/schema/dto.ts`, update:

```typescript
export const PhaseIdSchema = z.enum([
  'validate',
  'ensure-keys',
  'provision',
  'dns',
  'wait-ssh',
  'bootstrap',
  'healthcheck',
]);
```

- [ ] **Step 3: Update reporter.ts PhaseId type**

In `src/orchestrator/reporter.ts`, add `'dns'` to the PhaseId union:

```typescript
export type PhaseId =
  | 'validate'
  | 'ensure-keys'
  | 'provision'
  | 'dns'
  | 'wait-ssh'
  | 'bootstrap'
  | 'healthcheck';
```

- [ ] **Step 4: Commit**

```bash
git add src/schema/dto.ts src/orchestrator/reporter.ts
git commit -m "feat(schema): add domain check DTO types and dns phase"
```

---

### Task 4: AWS DNS — Route53 A record CRUD

**Files:**
- Create: `src/cloud/aws/dns.ts`
- Create: `tests/unit/cloud/aws/dns.test.ts`

- [ ] **Step 1: Install AWS Route53 SDK**

Run: `npm install @aws-sdk/client-route-53`

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/cloud/aws/dns.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  Route53Client,
  ListHostedZonesByNameCommand,
  ChangeResourceRecordSetsCommand,
} from '@aws-sdk/client-route-53';
import { upsertDnsRecordAws, deleteDnsRecordAws, findHostedZoneAws } from '../../../src/cloud/aws/dns.js';

const r53Mock = mockClient(Route53Client);

beforeEach(() => {
  r53Mock.reset();
});

describe('findHostedZoneAws', () => {
  it('finds the hosted zone matching the parent domain', async () => {
    r53Mock.on(ListHostedZonesByNameCommand).resolves({
      HostedZones: [
        { Id: '/hostedzone/Z1234', Name: 'backresto.com.', Config: { PrivateZone: false } },
      ],
      IsTruncated: false,
    });
    const zone = await findHostedZoneAws(r53Mock as any, 'jarvis.backresto.com');
    expect(zone).toEqual({ zoneId: 'Z1234', zoneName: 'backresto.com.' });
  });

  it('throws when no matching zone is found', async () => {
    r53Mock.on(ListHostedZonesByNameCommand).resolves({
      HostedZones: [],
      IsTruncated: false,
    });
    await expect(findHostedZoneAws(r53Mock as any, 'jarvis.unknown.com')).rejects.toThrow(
      /No DNS zone found/,
    );
  });
});

describe('upsertDnsRecordAws', () => {
  it('creates an A record with UPSERT action', async () => {
    r53Mock.on(ChangeResourceRecordSetsCommand).resolves({});
    await upsertDnsRecordAws(r53Mock as any, 'Z1234', 'jarvis.backresto.com', '13.39.38.162');
    const call = r53Mock.commandCalls(ChangeResourceRecordSetsCommand)[0];
    const changeBatch = call.args[0].input.ChangeBatch!;
    expect(changeBatch.Changes![0].Action).toBe('UPSERT');
    expect(changeBatch.Changes![0].ResourceRecordSet!.Name).toBe('jarvis.backresto.com');
    expect(changeBatch.Changes![0].ResourceRecordSet!.Type).toBe('A');
    expect(changeBatch.Changes![0].ResourceRecordSet!.ResourceRecords![0].Value).toBe('13.39.38.162');
    expect(changeBatch.Changes![0].ResourceRecordSet!.TTL).toBe(300);
  });
});

describe('deleteDnsRecordAws', () => {
  it('deletes the A record with DELETE action', async () => {
    r53Mock.on(ChangeResourceRecordSetsCommand).resolves({});
    await deleteDnsRecordAws(r53Mock as any, 'Z1234', 'jarvis.backresto.com', '13.39.38.162');
    const call = r53Mock.commandCalls(ChangeResourceRecordSetsCommand)[0];
    const changeBatch = call.args[0].input.ChangeBatch!;
    expect(changeBatch.Changes![0].Action).toBe('DELETE');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/cloud/aws/dns.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 4: Implement aws/dns.ts**

Create `src/cloud/aws/dns.ts`:

```typescript
import {
  Route53Client,
  ListHostedZonesByNameCommand,
  ChangeResourceRecordSetsCommand,
} from '@aws-sdk/client-route-53';

export interface HostedZoneRef {
  zoneId: string;
  zoneName: string;
}

/**
 * Find the Route53 hosted zone that matches the parent domain of the
 * given FQDN. E.g., "jarvis.backresto.com" → zone for "backresto.com".
 */
export async function findHostedZoneAws(
  r53: Route53Client,
  fqdn: string,
): Promise<HostedZoneRef> {
  // Walk up domain labels: jarvis.backresto.com → backresto.com → com
  const parts = fqdn.split('.');
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join('.') + '.';
    const result = await r53.send(
      new ListHostedZonesByNameCommand({ DNSName: candidate, MaxItems: '1' }),
    );
    for (const zone of result.HostedZones ?? []) {
      if (zone.Name === candidate && !zone.Config?.PrivateZone) {
        const zoneId = zone.Id!.replace('/hostedzone/', '');
        return { zoneId, zoneName: zone.Name };
      }
    }
  }
  const parentDomain = parts.slice(1).join('.');
  throw new Error(
    `No DNS zone found for "${parentDomain}" in your AWS account. ` +
    'Create the hosted zone in Route53 first, then re-run.',
  );
}

export async function upsertDnsRecordAws(
  r53: Route53Client,
  zoneId: string,
  fqdn: string,
  ip: string,
): Promise<void> {
  await r53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: fqdn,
              Type: 'A',
              TTL: 300,
              ResourceRecords: [{ Value: ip }],
            },
          },
        ],
      },
    }),
  );
}

export async function deleteDnsRecordAws(
  r53: Route53Client,
  zoneId: string,
  fqdn: string,
  ip: string,
): Promise<void> {
  await r53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'DELETE',
            ResourceRecordSet: {
              Name: fqdn,
              Type: 'A',
              TTL: 300,
              ResourceRecords: [{ Value: ip }],
            },
          },
        ],
      },
    }),
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/cloud/aws/dns.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cloud/aws/dns.ts tests/unit/cloud/aws/dns.test.ts package.json package-lock.json
git commit -m "feat(aws): add Route53 DNS A record CRUD"
```

---

### Task 5: GCP DNS — Cloud DNS A record CRUD

**Files:**
- Create: `src/cloud/gcp/dns.ts`
- Create: `tests/unit/cloud/gcp/dns.test.ts`

- [ ] **Step 1: Install GCP DNS SDK**

Run: `npm install @google-cloud/dns`

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/cloud/gcp/dns.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findManagedZoneGcp, upsertDnsRecordGcp, deleteDnsRecordGcp } from '../../../src/cloud/gcp/dns.js';

// Mock the @google-cloud/dns module
const mockGetZones = vi.fn();
const mockCreateChange = vi.fn();
const mockGetRecords = vi.fn();

vi.mock('@google-cloud/dns', () => ({
  DNS: vi.fn().mockImplementation(() => ({
    getZones: mockGetZones,
    zone: vi.fn((name: string) => ({
      name,
      createChange: mockCreateChange,
      getRecords: mockGetRecords,
    })),
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findManagedZoneGcp', () => {
  it('finds the managed zone matching the parent domain', async () => {
    mockGetZones.mockResolvedValue([[
      { metadata: { name: 'backresto-com', dnsName: 'backresto.com.' } },
    ]]);
    const zone = await findManagedZoneGcp('my-project', 'jarvis.backresto.com');
    expect(zone).toEqual({ zoneName: 'backresto-com', dnsName: 'backresto.com.' });
  });

  it('throws when no matching zone is found', async () => {
    mockGetZones.mockResolvedValue([[]]);
    await expect(findManagedZoneGcp('my-project', 'jarvis.unknown.com')).rejects.toThrow(
      /No DNS zone found/,
    );
  });
});

describe('upsertDnsRecordGcp', () => {
  it('creates an A record (no existing record)', async () => {
    mockGetRecords.mockResolvedValue([[]]);
    mockCreateChange.mockResolvedValue([{}]);
    await upsertDnsRecordGcp('my-project', 'backresto-com', 'jarvis.backresto.com', '13.39.38.162');
    expect(mockCreateChange).toHaveBeenCalledWith({
      add: { name: 'jarvis.backresto.com.', type: 'A', ttl: 300, data: ['13.39.38.162'] },
    });
  });
});

describe('deleteDnsRecordGcp', () => {
  it('deletes an existing A record', async () => {
    const existing = { name: 'jarvis.backresto.com.', type: 'A', ttl: 300, data: ['13.39.38.162'] };
    mockGetRecords.mockResolvedValue([[existing]]);
    mockCreateChange.mockResolvedValue([{}]);
    await deleteDnsRecordGcp('my-project', 'backresto-com', 'jarvis.backresto.com');
    expect(mockCreateChange).toHaveBeenCalledWith({ delete: existing });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/cloud/gcp/dns.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 4: Implement gcp/dns.ts**

Create `src/cloud/gcp/dns.ts`:

```typescript
import { DNS } from '@google-cloud/dns';

export interface ManagedZoneRef {
  zoneName: string;
  dnsName: string;
}

/**
 * Find the Cloud DNS managed zone matching the parent domain.
 * E.g., "jarvis.backresto.com" → zone with dnsName "backresto.com."
 */
export async function findManagedZoneGcp(
  project: string,
  fqdn: string,
): Promise<ManagedZoneRef> {
  const dns = new DNS({ projectId: project });
  const [zones] = await dns.getZones();

  const parts = fqdn.split('.');
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join('.') + '.';
    const match = zones.find(
      (z: any) => z.metadata?.dnsName === candidate,
    );
    if (match) {
      return { zoneName: match.metadata.name, dnsName: match.metadata.dnsName };
    }
  }

  const parentDomain = parts.slice(1).join('.');
  throw new Error(
    `No DNS zone found for "${parentDomain}" in your GCP project "${project}". ` +
    'Create the managed zone in Cloud DNS first, then re-run.',
  );
}

export async function upsertDnsRecordGcp(
  project: string,
  zoneName: string,
  fqdn: string,
  ip: string,
): Promise<void> {
  const dns = new DNS({ projectId: project });
  const zone = dns.zone(zoneName);
  const fqdnDot = fqdn.endsWith('.') ? fqdn : fqdn + '.';

  // Check for existing record to replace
  const [records] = await zone.getRecords({ name: fqdnDot, type: 'A' });
  const change: any = {
    add: { name: fqdnDot, type: 'A', ttl: 300, data: [ip] },
  };
  if (records.length > 0) {
    change.delete = records[0];
  }
  await zone.createChange(change);
}

export async function deleteDnsRecordGcp(
  project: string,
  zoneName: string,
  fqdn: string,
): Promise<void> {
  const dns = new DNS({ projectId: project });
  const zone = dns.zone(zoneName);
  const fqdnDot = fqdn.endsWith('.') ? fqdn : fqdn + '.';

  const [records] = await zone.getRecords({ name: fqdnDot, type: 'A' });
  if (records.length > 0) {
    await zone.createChange({ delete: records[0] });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/cloud/gcp/dns.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cloud/gcp/dns.ts tests/unit/cloud/gcp/dns.test.ts package.json package-lock.json
git commit -m "feat(gcp): add Cloud DNS A record CRUD"
```

---

### Task 6: NixOS config generation — nginx + ACME

**Files:**
- Modify: `src/nix-gen/templates.ts`
- Modify: `src/nix-gen/generate.ts`
- Create: `tests/unit/nix-gen/domain.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/nix-gen/domain.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateConfigurationNix } from '../../../src/nix-gen/generate.js';
import type { HermesTomlConfig } from '../../../src/schema/hermes-toml.js';

function baseConfig(domain?: { name: string; upstream_port: number }): HermesTomlConfig {
  return {
    name: 'test',
    cloud: { provider: 'aws', profile: 'default', region: 'eu-west-3', size: 'small', disk_gb: 30 },
    network: { ssh_allowed_from: 'auto', inbound_ports: [] },
    hermes: {
      config_file: './config.yaml',
      secrets_file: './secrets.env.enc',
      documents: {},
      environment: {},
    },
    domain,
  };
}

describe('configurationNix with domain', () => {
  it('includes nginx and ACME config when domain is set', () => {
    const nix = generateConfigurationNix(baseConfig({ name: 'jarvis.backresto.com', upstream_port: 3000 }));
    expect(nix).toContain('services.nginx.enable = true');
    expect(nix).toContain('jarvis.backresto.com');
    expect(nix).toContain('http://127.0.0.1:3000');
    expect(nix).toContain('security.acme');
    expect(nix).toContain('networking.firewall.allowedTCPPorts');
    expect(nix).toContain('80');
    expect(nix).toContain('443');
  });

  it('does NOT include nginx config when domain is absent', () => {
    const nix = generateConfigurationNix(baseConfig());
    expect(nix).not.toContain('services.nginx');
    expect(nix).not.toContain('security.acme');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/nix-gen/domain.test.ts`
Expected: FAIL — no nginx config generated

- [ ] **Step 3: Update configurationNix in templates.ts**

In `src/nix-gen/templates.ts`, update the `configurationNix` function signature to accept domain config:

```typescript
export interface DomainConfig {
  name: string;
  upstream_port: number;
}

export function configurationNix(
  provider: 'aws' | 'gcp',
  sshPublicKey?: string,
  cachix?: CachixConfig,
  domain?: DomainConfig,
): string {
```

Before the closing `}` of the returned string, add the domain block (after the sops block):

```typescript
  const domainBlock = domain
    ? `
  # --- Domain: nginx reverse proxy + Let's Encrypt TLS ---
  networking.firewall.allowedTCPPorts = [ 80 443 ];

  security.acme = {
    acceptTerms = true;
    defaults.email = "acme@${domain.name}";
  };

  services.nginx = {
    enable = true;
    recommendedProxySettings = true;
    recommendedTlsSettings = true;
    virtualHosts."${domain.name}" = {
      enableACME = true;
      forceSSL = true;
      locations."/" = {
        proxyPass = "http://127.0.0.1:${domain.upstream_port}";
        proxyWebsockets = true;
      };
    };
  };
`
    : '';
```

Insert `${domainBlock}` before the closing of the template string (after the sops block, before the final `}`).

- [ ] **Step 4: Update generate.ts to pass domain config**

In `src/nix-gen/generate.ts`, update `generateConfigurationNix`:

```typescript
import { configurationNix, FLAKE_NIX, type DomainConfig } from './templates.js';

export function generateConfigurationNix(config: HermesTomlConfig, sshPublicKey?: string): string {
  const domain: DomainConfig | undefined = config.domain
    ? { name: config.domain.name, upstream_port: config.domain.upstream_port }
    : undefined;
  return configurationNix(config.cloud.provider, sshPublicKey, config.hermes.cachix, domain);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/nix-gen/domain.test.ts`
Expected: PASS

- [ ] **Step 6: Run all existing nix-gen tests to verify no regressions**

Run: `npx vitest run tests/unit/nix-gen/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/nix-gen/templates.ts src/nix-gen/generate.ts tests/unit/nix-gen/domain.test.ts
git commit -m "feat(nix-gen): generate nginx + ACME config when [domain] is set"
```

---

### Task 7: Cloud firewall — auto-add ports 80/443

**Files:**
- Modify: `src/cloud/aws/reconcile-network.ts`
- Modify: `src/cloud/gcp/reconcile-network.ts`
- Modify: `tests/unit/cloud/aws/reconcile-network.test.ts`
- Modify: `tests/unit/cloud/gcp/reconcile-network.test.ts`

- [ ] **Step 1: Update NetworkRules type to include domain flag**

In `src/cloud/core.ts`, update the `NetworkRules` interface:

```typescript
export interface NetworkRules {
  sshAllowedFrom: string; // CIDR
  inboundPorts: number[];
  /** When true, ports 80 and 443 are automatically added for nginx/ACME. */
  hasDomain?: boolean;
}
```

- [ ] **Step 2: Write failing test for AWS**

Add to `tests/unit/cloud/aws/reconcile-network.test.ts`:

```typescript
it('adds ports 80 and 443 when hasDomain is true', async () => {
  // Setup mock with existing SG (SSH only)
  // ... (follow existing test pattern in the file)
  await reconcileNetworkAws(ec2Mock as any, ledger, {
    sshAllowedFrom: '1.2.3.4/32',
    inboundPorts: [3000],
    hasDomain: true,
  });
  // Verify AuthorizeSecurityGroupIngressCommand was called for ports 80 and 443
  const addCalls = ec2Mock.commandCalls(AuthorizeSecurityGroupIngressCommand);
  const addedPorts = addCalls.map(c => c.args[0].input.IpPermissions![0].FromPort);
  expect(addedPorts).toContain(80);
  expect(addedPorts).toContain(443);
});
```

- [ ] **Step 3: Update AWS reconcile-network.ts**

In `src/cloud/aws/reconcile-network.ts`, update the `desired` array construction:

```typescript
const desired: DesiredRule[] = [
  { port: 22, cidr: rules.sshAllowedFrom },
  ...rules.inboundPorts.map(port => ({ port, cidr: '0.0.0.0/0' })),
];
if (rules.hasDomain) {
  if (!desired.some(d => d.port === 80)) desired.push({ port: 80, cidr: '0.0.0.0/0' });
  if (!desired.some(d => d.port === 443)) desired.push({ port: 443, cidr: '0.0.0.0/0' });
}
```

- [ ] **Step 4: Update GCP reconcile-network.ts similarly**

In `src/cloud/gcp/reconcile-network.ts`, when building the ports list for the firewall rule, merge in 80 and 443 when `rules.hasDomain` is true:

```typescript
const allInboundPorts = [...rules.inboundPorts];
if (rules.hasDomain) {
  if (!allInboundPorts.includes(80)) allInboundPorts.push(80);
  if (!allInboundPorts.includes(443)) allInboundPorts.push(443);
}
const wantsPorts = allInboundPorts.length > 0;
```

Then use `allInboundPorts` throughout instead of `rules.inboundPorts`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/cloud/aws/reconcile-network.test.ts tests/unit/cloud/gcp/reconcile-network.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cloud/core.ts src/cloud/aws/reconcile-network.ts src/cloud/gcp/reconcile-network.ts tests/unit/cloud/aws/reconcile-network.test.ts tests/unit/cloud/gcp/reconcile-network.test.ts
git commit -m "feat(cloud): auto-add ports 80/443 in firewall when domain is configured"
```

---

### Task 8: DNS integration into CloudProvider interface

**Files:**
- Modify: `src/cloud/core.ts`
- Modify: `src/cloud/aws/provider.ts`
- Modify: `src/cloud/gcp/provider.ts`

- [ ] **Step 1: Extend CloudProvider interface**

In `src/cloud/core.ts`, add DNS methods to the `CloudProvider` interface:

```typescript
export interface DnsRecord {
  zoneId: string;
  fqdn: string;
}

export interface CloudProvider {
  // ... existing methods ...

  /**
   * Create or update a DNS A record pointing fqdn → ip.
   * Returns an identifier that can be used for deletion.
   */
  upsertDnsRecord?(fqdn: string, ip: string): Promise<DnsRecord>;

  /**
   * Delete a DNS A record previously created by upsertDnsRecord.
   */
  deleteDnsRecord?(record: DnsRecord, ip: string): Promise<void>;
}
```

- [ ] **Step 2: Implement in AwsProvider**

In `src/cloud/aws/provider.ts`, add:

```typescript
import { Route53Client } from '@aws-sdk/client-route-53';
import { findHostedZoneAws, upsertDnsRecordAws, deleteDnsRecordAws } from './dns.js';
import type { DnsRecord } from '../core.js';
```

Add to the class:

```typescript
private readonly r53: Route53Client;

constructor(private readonly opts: AwsProviderOptions) {
  if (opts.profile) process.env.AWS_PROFILE = opts.profile;
  this.ec2 = new EC2Client({ region: opts.region });
  this.r53 = new Route53Client({ region: opts.region });
}

async upsertDnsRecord(fqdn: string, ip: string): Promise<DnsRecord> {
  const zone = await findHostedZoneAws(this.r53, fqdn);
  await upsertDnsRecordAws(this.r53, zone.zoneId, fqdn, ip);
  return { zoneId: zone.zoneId, fqdn };
}

async deleteDnsRecord(record: DnsRecord, ip: string): Promise<void> {
  try {
    await deleteDnsRecordAws(this.r53, record.zoneId, record.fqdn, ip);
  } catch {
    // Best-effort cleanup
  }
}
```

- [ ] **Step 3: Implement in GcpProvider**

In `src/cloud/gcp/provider.ts`, add:

```typescript
import { findManagedZoneGcp, upsertDnsRecordGcp, deleteDnsRecordGcp } from './dns.js';
import type { DnsRecord } from '../core.js';
```

Add to the class:

```typescript
async upsertDnsRecord(fqdn: string, ip: string): Promise<DnsRecord> {
  const project = await this.getProject();
  const zone = await findManagedZoneGcp(project, fqdn);
  await upsertDnsRecordGcp(project, zone.zoneName, fqdn, ip);
  return { zoneId: zone.zoneName, fqdn };
}

async deleteDnsRecord(record: DnsRecord, _ip: string): Promise<void> {
  const project = await this.getProject();
  try {
    await deleteDnsRecordGcp(project, record.zoneId, record.fqdn);
  } catch {
    // Best-effort cleanup
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/cloud/core.ts src/cloud/aws/provider.ts src/cloud/gcp/provider.ts
git commit -m "feat(cloud): add DNS upsert/delete to CloudProvider interface"
```

---

### Task 9: Orchestrator — wire DNS into deploy flow

**Files:**
- Modify: `src/orchestrator/deploy.ts`
- Modify: `src/orchestrator/shared.ts`
- Modify: `tests/unit/orchestrator/deploy.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/orchestrator/deploy.test.ts` — update `fakeProvider()` to include DNS stubs:

```typescript
function fakeProvider(): CloudProvider {
  return {
    // ... existing mocks ...
    upsertDnsRecord: vi.fn(async () => ({ zoneId: 'Z1234', fqdn: 'test.example.com' })),
    deleteDnsRecord: vi.fn(async () => {}),
  };
}
```

Add a new test:

```typescript
it('creates DNS record and stores domain state when [domain] is configured', async () => {
  // Write a hermes.toml with [domain] section
  writeFileSync(join(projectDir, 'hermes.toml'), `
name = "test"
[cloud]
provider = "aws"
profile = "default"
region = "eu-west-3"
size = "small"
[hermes]
config_file = "./config.yaml"
secrets_file = "./secrets.env.enc"
[domain]
name = "test.example.com"
upstream_port = 3000
`);

  const provider = fakeProvider();
  await runDeploy({ /* ... same opts with the domain-enabled toml ... */ });

  // DNS upsert should have been called
  expect(provider.upsertDnsRecord).toHaveBeenCalledWith('test.example.com', '203.0.113.42');

  // State should have domain fields
  const state = await new StateStore(getStatePaths()).read();
  expect(state.deployments.test.domain_name).toBe('test.example.com');
  expect(state.deployments.test.dns_record_id).toBe('Z1234/test.example.com');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/orchestrator/deploy.test.ts`
Expected: FAIL

- [ ] **Step 3: Add DNS phase to deploy.ts**

In `src/orchestrator/deploy.ts`, after the provision phase (after the state is persisted with the public IP), add:

```typescript
// === Phase 2.5 — DNS ===
if (config.domain) {
  reporter.phaseStart('dns', `Configuring DNS: ${config.domain.name} → ${instance.publicIp}`);
  if (opts.provider.upsertDnsRecord) {
    const dnsRecord = await opts.provider.upsertDnsRecord(config.domain.name, instance.publicIp);
    // Persist DNS info to state
    await store.update(state => {
      const d = state.deployments[config.name]!;
      d.domain_name = config.domain!.name;
      d.dns_record_id = `${dnsRecord.zoneId}/${dnsRecord.fqdn}`;
    });
  }
  reporter.phaseDone('dns');
}
```

- [ ] **Step 4: Pass hasDomain to network rules in provision spec**

In the ProvisionSpec construction:

```typescript
const spec: ProvisionSpec = {
  // ... existing fields ...
  networkRules: {
    sshAllowedFrom,
    inboundPorts: config.network.inbound_ports,
    hasDomain: !!config.domain,
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/orchestrator/deploy.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/deploy.ts tests/unit/orchestrator/deploy.test.ts
git commit -m "feat(orchestrator): wire DNS provisioning into deploy flow"
```

---

### Task 10: Orchestrator — wire DNS into update flow

**Files:**
- Modify: `src/orchestrator/update.ts`
- Modify: `tests/unit/orchestrator/update.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/orchestrator/update.test.ts`:

```typescript
it('updates DNS record when domain is added', async () => {
  // Pre-seed state without domain, then update with a hermes.toml that has [domain]
  const provider = fakeProvider();
  await runUpdate({ /* opts */ });
  expect(provider.upsertDnsRecord).toHaveBeenCalled();
});

it('removes DNS record when domain is removed', async () => {
  // Pre-seed state WITH domain, then update with a hermes.toml WITHOUT [domain]
  const provider = fakeProvider();
  await runUpdate({ /* opts */ });
  expect(provider.deleteDnsRecord).toHaveBeenCalled();
});
```

- [ ] **Step 2: Implement domain handling in update.ts**

After the network reconciliation phase in `runUpdate`, add domain logic:

```typescript
// === Domain DNS reconciliation ===
if (config.domain && opts.provider.upsertDnsRecord) {
  reporter.phaseStart('dns', `Configuring DNS: ${config.domain.name} → ${deployment.instance_ip}`);
  const dnsRecord = await opts.provider.upsertDnsRecord(config.domain.name, deployment.instance_ip);
  await store.update(state => {
    const d = state.deployments[opts.deploymentName]!;
    d.domain_name = config.domain!.name;
    d.dns_record_id = `${dnsRecord.zoneId}/${dnsRecord.fqdn}`;
  });
  reporter.phaseDone('dns');
} else if (!config.domain && deployment.domain_name && opts.provider.deleteDnsRecord) {
  // Domain was removed from config
  reporter.phaseStart('dns', `Removing DNS record for ${deployment.domain_name}`);
  const [zoneId, fqdn] = (deployment.dns_record_id ?? '').split('/');
  if (zoneId && fqdn) {
    await opts.provider.deleteDnsRecord({ zoneId, fqdn }, deployment.instance_ip);
  }
  await store.update(state => {
    const d = state.deployments[opts.deploymentName]!;
    delete d.domain_name;
    delete d.dns_record_id;
  });
  reporter.phaseDone('dns');
}
```

Also pass `hasDomain` to network rules:

```typescript
const rules: NetworkRules = {
  sshAllowedFrom,
  inboundPorts: config.network.inbound_ports,
  hasDomain: !!config.domain,
};
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/unit/orchestrator/update.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/update.ts tests/unit/orchestrator/update.test.ts
git commit -m "feat(orchestrator): handle domain add/change/remove in update flow"
```

---

### Task 11: Orchestrator — DNS cleanup on destroy

**Files:**
- Modify: `src/orchestrator/destroy.ts`
- Modify: `tests/unit/orchestrator/destroy.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/orchestrator/destroy.test.ts`:

```typescript
it('deletes DNS record on destroy when domain was configured', async () => {
  // Pre-seed state with domain_name and dns_record_id
  const provider = fakeProvider();
  await runDestroy({ deploymentName: 'test', provider });
  expect(provider.deleteDnsRecord).toHaveBeenCalledWith(
    { zoneId: 'Z1234', fqdn: 'test.example.com' },
    '203.0.113.42',
  );
});
```

- [ ] **Step 2: Add DNS cleanup to destroy.ts**

In `src/orchestrator/destroy.ts`, before the cloud destroy call, add:

```typescript
// Clean up DNS record if one was configured
if (deployment.domain_name && deployment.dns_record_id && opts.provider.deleteDnsRecord) {
  const [zoneId, fqdn] = deployment.dns_record_id.split('/');
  if (zoneId && fqdn) {
    try {
      await opts.provider.deleteDnsRecord({ zoneId, fqdn }, deployment.instance_ip);
    } catch {
      // Best-effort — DNS cleanup failure shouldn't block destroy
    }
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/unit/orchestrator/destroy.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/destroy.ts tests/unit/orchestrator/destroy.test.ts
git commit -m "feat(orchestrator): clean up DNS records on destroy"
```

---

### Task 12: Domain health checks — remote (SSH-based)

**Files:**
- Create: `src/remote-ops/domain-check.ts`
- Create: `tests/unit/remote-ops/domain-check.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/remote-ops/domain-check.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runRemoteDomainChecks } from '../../../src/remote-ops/domain-check.js';
import type { SshSession } from '../../../src/remote-ops/session.js';

function fakeSession(responses: Record<string, { exitCode: number; stdout: string; stderr: string }>): SshSession {
  return {
    exec: vi.fn(async (cmd: string) => {
      for (const [pattern, result] of Object.entries(responses)) {
        if (cmd.includes(pattern)) return result;
      }
      return { exitCode: 1, stdout: '', stderr: 'unknown command' };
    }),
    execStream: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    execStreamUntil: vi.fn(async () => ({ aborted: false, exitCode: 0 })),
    uploadFile: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

describe('runRemoteDomainChecks', () => {
  it('returns all-ok when nginx is active and upstream responds', async () => {
    const session = fakeSession({
      'systemctl is-active nginx': { exitCode: 0, stdout: 'active\n', stderr: '' },
      'nginx -t': { exitCode: 0, stdout: '', stderr: 'syntax is ok\nconfiguration test is successful' },
      '/var/lib/acme': { exitCode: 0, stdout: '2026-07-10T15:30:00Z\n', stderr: '' },
      'curl': { exitCode: 0, stdout: '200', stderr: '' },
    });
    const result = await runRemoteDomainChecks(session, 'jarvis.backresto.com', 3000);
    expect(result.nginx.active).toBe(true);
    expect(result.nginx.configValid).toBe(true);
    expect(result.upstream.ok).toBe(true);
    expect(result.upstream.httpStatus).toBe(200);
  });

  it('returns nginx inactive when systemctl fails', async () => {
    const session = fakeSession({
      'systemctl is-active nginx': { exitCode: 3, stdout: 'inactive\n', stderr: '' },
      'nginx -t': { exitCode: 1, stdout: '', stderr: 'error' },
      '/var/lib/acme': { exitCode: 1, stdout: '', stderr: '' },
      'curl': { exitCode: 7, stdout: '', stderr: '' },
    });
    const result = await runRemoteDomainChecks(session, 'test.example.com', 3000);
    expect(result.nginx.active).toBe(false);
    expect(result.nginx.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/remote-ops/domain-check.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement domain-check.ts**

Create `src/remote-ops/domain-check.ts`:

```typescript
import type { SshSession } from './session.js';

export interface RemoteDomainChecks {
  nginx: { ok: boolean; active: boolean; configValid: boolean };
  tls: { ok: boolean; expiresAt: string | null; daysRemaining: number | null };
  upstream: { ok: boolean; httpStatus: number | null };
}

export async function runRemoteDomainChecks(
  session: SshSession,
  domainName: string,
  upstreamPort: number,
): Promise<RemoteDomainChecks> {
  // 1. nginx status
  const nginxActive = await session.exec('systemctl is-active nginx');
  const isActive = nginxActive.exitCode === 0 && nginxActive.stdout.trim() === 'active';

  // 2. nginx config test
  const nginxTest = await session.exec('nginx -t 2>&1');
  const configValid = nginxTest.exitCode === 0;

  // 3. TLS cert expiry
  let expiresAt: string | null = null;
  let daysRemaining: number | null = null;
  const certCheck = await session.exec(
    `openssl x509 -enddate -noout -in /var/lib/acme/${domainName}/cert.pem 2>/dev/null | sed 's/notAfter=//'`,
  );
  if (certCheck.exitCode === 0 && certCheck.stdout.trim()) {
    const dateStr = certCheck.stdout.trim();
    const expiry = new Date(dateStr);
    if (!isNaN(expiry.getTime())) {
      expiresAt = expiry.toISOString();
      daysRemaining = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
    }
  }
  const tlsOk = expiresAt !== null && (daysRemaining ?? 0) > 0;

  // 4. Upstream health
  const upstreamCheck = await session.exec(
    `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${upstreamPort} 2>/dev/null`,
  );
  const httpStatus = upstreamCheck.exitCode === 0 ? parseInt(upstreamCheck.stdout.trim(), 10) : null;
  const upstreamOk = httpStatus !== null && httpStatus >= 200 && httpStatus < 500;

  return {
    nginx: { ok: isActive && configValid, active: isActive, configValid },
    tls: { ok: tlsOk, expiresAt, daysRemaining },
    upstream: { ok: upstreamOk, httpStatus },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/remote-ops/domain-check.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/remote-ops/domain-check.ts tests/unit/remote-ops/domain-check.test.ts
git commit -m "feat(remote-ops): add SSH-based domain health checks"
```

---

### Task 13: Domain health checks — external (client-side)

**Files:**
- Create: `src/domain/external-check.ts`
- Create: `tests/unit/domain/external-check.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/domain/external-check.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runExternalDomainChecks } from '../../../src/domain/external-check.js';
import * as dns from 'node:dns/promises';
import * as https from 'node:https';

vi.mock('node:dns/promises', () => ({
  resolve4: vi.fn(),
}));

describe('runExternalDomainChecks', () => {
  it('reports DNS match when resolved IP matches expected', async () => {
    vi.mocked(dns.resolve4).mockResolvedValue(['13.39.38.162']);
    const result = await runExternalDomainChecks('jarvis.backresto.com', '13.39.38.162');
    expect(result.dns.ok).toBe(true);
    expect(result.dns.resolvedIp).toBe('13.39.38.162');
    expect(result.dns.matches).toBe(true);
  });

  it('reports DNS mismatch when IP differs', async () => {
    vi.mocked(dns.resolve4).mockResolvedValue(['1.2.3.4']);
    const result = await runExternalDomainChecks('jarvis.backresto.com', '13.39.38.162');
    expect(result.dns.ok).toBe(true);
    expect(result.dns.matches).toBe(false);
  });

  it('reports DNS failure when resolution fails', async () => {
    vi.mocked(dns.resolve4).mockRejectedValue(new Error('ENOTFOUND'));
    const result = await runExternalDomainChecks('bad.example.com', '1.2.3.4');
    expect(result.dns.ok).toBe(false);
    expect(result.dns.resolvedIp).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/domain/external-check.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement external-check.ts**

Create `src/domain/external-check.ts`:

```typescript
import { resolve4 } from 'node:dns/promises';
import https from 'node:https';
import tls from 'node:tls';

export interface ExternalDomainChecks {
  dns: { ok: boolean; resolvedIp: string | null; expectedIp: string; matches: boolean };
  tls: { ok: boolean; valid: boolean; expiresAt: string | null; daysRemaining: number | null };
  https: { ok: boolean; httpStatus: number | null };
}

export async function runExternalDomainChecks(
  domainName: string,
  expectedIp: string,
): Promise<ExternalDomainChecks> {
  // 1. DNS resolution
  let resolvedIp: string | null = null;
  let dnsOk = false;
  try {
    const ips = await resolve4(domainName);
    resolvedIp = ips[0] ?? null;
    dnsOk = resolvedIp !== null;
  } catch {
    // DNS resolution failed
  }
  const dnsMatches = resolvedIp === expectedIp;

  // 2. TLS check
  let tlsValid = false;
  let tlsExpiresAt: string | null = null;
  let tlsDaysRemaining: number | null = null;
  try {
    const cert = await getTlsCert(domainName);
    if (cert) {
      const expiry = new Date(cert.valid_to);
      if (!isNaN(expiry.getTime())) {
        tlsExpiresAt = expiry.toISOString();
        tlsDaysRemaining = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
        tlsValid = tlsDaysRemaining > 0;
      }
    }
  } catch {
    // TLS connection failed
  }

  // 3. HTTPS check
  let httpsStatus: number | null = null;
  try {
    httpsStatus = await getHttpsStatus(domainName);
  } catch {
    // HTTPS request failed
  }

  return {
    dns: { ok: dnsOk, resolvedIp, expectedIp, matches: dnsMatches },
    tls: { ok: tlsValid, valid: tlsValid, expiresAt: tlsExpiresAt, daysRemaining: tlsDaysRemaining },
    https: { ok: httpsStatus !== null && httpsStatus >= 200 && httpsStatus < 500, httpStatus: httpsStatus },
  };
}

function getTlsCert(hostname: string): Promise<tls.PeerCertificate | null> {
  return new Promise((resolve) => {
    const socket = tls.connect(443, hostname, { servername: hostname }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert && cert.subject ? cert : null);
    });
    socket.setTimeout(5000);
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
    socket.on('error', () => resolve(null));
  });
}

function getHttpsStatus(hostname: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://${hostname}`, { timeout: 10000 }, (res) => {
      res.resume(); // drain
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/domain/external-check.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/external-check.ts tests/unit/domain/external-check.test.ts
git commit -m "feat(domain): add external DNS/TLS/HTTPS health checks"
```

---

### Task 14: CLI status — display domain checks

**Files:**
- Modify: `src/commands/status.ts`

- [ ] **Step 1: Update StatusPayload type**

Add to the `StatusPayload` interface in `src/commands/status.ts`:

```typescript
import type { DomainCheckDto } from '../schema/dto.js';

export interface StatusPayload {
  // ... existing fields ...
  domain?: DomainCheckDto;
}
```

- [ ] **Step 2: Add domain check logic to statusCommand**

After the `live` status is fetched, add:

```typescript
// Domain checks (when domain is configured)
let domainCheck: DomainCheckDto | undefined;
if (deployment.domain_name) {
  const { loadHermesToml } = await import('../schema/load.js');
  let upstreamPort = 3000; // fallback
  try {
    const config = loadHermesToml(join(deployment.project_path, 'hermes.toml'));
    if (config.domain) upstreamPort = config.domain.upstream_port;
  } catch { /* use fallback */ }

  const { runExternalDomainChecks } = await import('../domain/external-check.js');
  const external = await runExternalDomainChecks(deployment.domain_name, deployment.instance_ip);

  // SSH-based checks (only if instance is reachable)
  let nginxCheck = { ok: false, active: false, configValid: false };
  let remoteTls = { ok: false, expiresAt: null as string | null, daysRemaining: null as number | null };
  let upstreamCheck = { ok: false, httpStatus: null as number | null };

  if (live.state === 'running') {
    try {
      const { readFileSync } = await import('node:fs');
      const { createSshSession } = await import('../remote-ops/session.js');
      const { runRemoteDomainChecks } = await import('../remote-ops/domain-check.js');
      const privateKey = readFileSync(deployment.ssh_key_path, 'utf-8');
      const session = await createSshSession({ host: deployment.instance_ip, username: 'root', privateKey });
      try {
        const remote = await runRemoteDomainChecks(session, deployment.domain_name, upstreamPort);
        nginxCheck = remote.nginx;
        remoteTls = remote.tls;
        upstreamCheck = remote.upstream;
      } finally {
        await session.dispose();
      }
    } catch { /* SSH failed, use defaults */ }
  }

  domainCheck = {
    name: deployment.domain_name,
    checks: {
      dns: external.dns,
      tls: external.tls.ok ? external.tls : { ok: remoteTls.ok, valid: remoteTls.ok, expiresAt: remoteTls.expiresAt, daysRemaining: remoteTls.daysRemaining },
      nginx: nginxCheck,
      upstream: upstreamCheck,
      https: external.https,
    },
  };
}
```

Include `domainCheck` in the payload:

```typescript
const payload: StatusPayload = {
  // ... existing fields ...
  domain: domainCheck,
};
```

- [ ] **Step 3: Add domain section to CLI output**

After the existing console.log lines in the non-JSON output path:

```typescript
if (domainCheck) {
  const c = domainCheck.checks;
  console.log('');
  console.log(`  Domain:      ${domainCheck.name}`);
  console.log(`  DNS:         ${c.dns.ok ? 'ok' : 'FAIL'} — ${c.dns.resolvedIp ?? '(unresolved)'}${c.dns.matches ? ' (matches)' : ` (expected ${c.dns.expectedIp})`}`);
  console.log(`  TLS:         ${c.tls.ok ? 'ok' : 'FAIL'} — ${c.tls.expiresAt ? `expires ${c.tls.expiresAt.slice(0, 10)} (${c.tls.daysRemaining}d)` : '(no cert)'}`);
  console.log(`  nginx:       ${c.nginx.ok ? 'ok' : 'FAIL'} — ${c.nginx.active ? 'active' : 'inactive'}, config ${c.nginx.configValid ? 'valid' : 'invalid'}`);
  console.log(`  Upstream:    ${c.upstream.ok ? 'ok' : 'FAIL'} — ${c.upstream.httpStatus !== null ? `HTTP ${c.upstream.httpStatus}` : '(unreachable)'}`);
  console.log(`  HTTPS:       ${c.https.ok ? 'ok' : 'FAIL'} — ${c.https.httpStatus !== null ? `HTTP ${c.https.httpStatus}` : '(unreachable)'}`);
}
```

- [ ] **Step 4: Run existing status tests to verify no regressions**

Run: `npx vitest run tests/unit/commands/status.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/status.ts
git commit -m "feat(cli): show domain health checks in status output"
```

---

### Task 15: Dashboard API — include domain checks

**Files:**
- Modify: `src/server/routes/deployments.ts`

- [ ] **Step 1: Add domain checks to GET /api/deployments/:name**

In the `GET /api/deployments/:name` handler, after the `live` status fetch, add domain check logic (similar to Task 14 but using the loadHermesToml + external checks):

```typescript
// Domain health checks
let domain;
if (deployment.domain_name) {
  let upstreamPort = 3000;
  try {
    const { loadHermesToml } = await import('../../schema/load.js');
    const config = loadHermesToml(`${deployment.project_path}/hermes.toml`);
    if (config.domain) upstreamPort = config.domain.upstream_port;
  } catch { /* fallback */ }

  const { runExternalDomainChecks } = await import('../../domain/external-check.js');
  const external = await runExternalDomainChecks(deployment.domain_name, deployment.instance_ip);

  let nginxCheck = { ok: false, active: false, configValid: false };
  let remoteTls = { ok: false, expiresAt: null as string | null, daysRemaining: null as number | null };
  let upstreamCheck = { ok: false, httpStatus: null as number | null };

  if (live.state === 'running') {
    try {
      const { readFileSync } = await import('node:fs');
      const { createSshSession } = await import('../../remote-ops/session.js');
      const { runRemoteDomainChecks } = await import('../../remote-ops/domain-check.js');
      const privateKey = readFileSync(deployment.ssh_key_path, 'utf-8');
      const session = await createSshSession({ host: deployment.instance_ip, username: 'root', privateKey });
      try {
        const remote = await runRemoteDomainChecks(session, deployment.domain_name, upstreamPort);
        nginxCheck = remote.nginx;
        remoteTls = remote.tls;
        upstreamCheck = remote.upstream;
      } finally {
        await session.dispose();
      }
    } catch { /* SSH failed */ }
  }

  domain = {
    name: deployment.domain_name,
    checks: {
      dns: external.dns,
      tls: external.tls.ok ? external.tls : { ok: remoteTls.ok, valid: remoteTls.ok, expiresAt: remoteTls.expiresAt, daysRemaining: remoteTls.daysRemaining },
      nginx: nginxCheck,
      upstream: upstreamCheck,
      https: external.https,
    },
  };
}
```

Add `domain` to the returned object.

- [ ] **Step 2: Commit**

```bash
git add src/server/routes/deployments.ts
git commit -m "feat(server): include domain health checks in deployment API"
```

---

### Task 16: Dashboard UI — Domain health card in InfraTab

**Files:**
- Modify: `web/src/features/agent/InfraTab.tsx`

- [ ] **Step 1: Add DomainCheckDto import and domain card**

Add import at top of InfraTab.tsx:

```typescript
import type { StatusPayloadDto, DomainCheckDto } from '@hermes/dto';
```

Add a `DomainCard` component inside the file:

```typescript
function CheckRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className="text-slate-500 text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
        <span className="text-slate-200 text-sm font-mono">{detail}</span>
      </div>
    </div>
  );
}

function DomainCard({ domain }: { domain: DomainCheckDto }) {
  const c = domain.checks;
  return (
    <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
      <h3 className="text-sm font-semibold text-slate-200 mb-3">
        <i className="fa-solid fa-globe mr-2 text-indigo-500" />Domain
      </h3>
      <InfoRow label="Domain" value={domain.name} />
      <CheckRow
        label="DNS"
        ok={c.dns.ok && c.dns.matches}
        detail={c.dns.resolvedIp ? `${c.dns.resolvedIp}${c.dns.matches ? '' : ' (mismatch)'}` : 'unresolved'}
      />
      <CheckRow
        label="TLS"
        ok={c.tls.ok}
        detail={c.tls.expiresAt ? `expires ${c.tls.expiresAt.slice(0, 10)} (${c.tls.daysRemaining}d)` : 'no cert'}
      />
      <CheckRow
        label="nginx"
        ok={c.nginx.ok}
        detail={`${c.nginx.active ? 'active' : 'inactive'}, config ${c.nginx.configValid ? 'valid' : 'invalid'}`}
      />
      <CheckRow
        label="Upstream"
        ok={c.upstream.ok}
        detail={c.upstream.httpStatus !== null ? `HTTP ${c.upstream.httpStatus}` : 'unreachable'}
      />
      <CheckRow
        label="HTTPS"
        ok={c.https.ok}
        detail={c.https.httpStatus !== null ? `HTTP ${c.https.httpStatus}` : 'unreachable'}
      />
    </div>
  );
}
```

- [ ] **Step 2: Render the DomainCard in InfraTab**

In the `InfraTab` component, add the domain card after the "Deployment Info / Live State" grid:

```typescript
const domain = (status as any)?.domain as DomainCheckDto | undefined;
```

Add to the JSX, after the first grid:

```tsx
{domain && (
  <div className="grid grid-cols-2 gap-4 mb-6">
    <DomainCard domain={domain} />
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/features/agent/InfraTab.tsx
git commit -m "feat(dashboard): add domain health card to InfraTab"
```

---

### Task 17: Full integration — run all tests + typecheck

**Files:** (none — verification only)

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Build the project**

Run: `npm run build:server`
Expected: Clean build

- [ ] **Step 4: Commit any fixes from integration issues**

If any fixes were needed, commit them:

```bash
git commit -m "fix: resolve integration issues from domain feature"
```
