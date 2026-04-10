# M4: GCP Support + Polish Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GCP as a second cloud provider with full feature parity to AWS, plus bundle four polish items from M2/M3.

**Architecture:** Thin `GcpProvider` implementing the existing `CloudProvider` interface. Six new files under `src/cloud/gcp/` mirror the AWS structure. Nothing above the provider layer changes except factory wiring + orchestrator state persistence. Uses `@google-cloud/compute` SDK with ADC auth.

**Tech Stack:** TypeScript, `@google-cloud/compute` v4+, vitest, `vi.fn()` mocks (no `aws-sdk-client-mock` equivalent for GCP)

---

### Task 1: Install `@google-cloud/compute` and update state schema

**Files:**
- Modify: `package.json` (add dependency)
- Modify: `src/schema/state-toml.ts:12-17` (update GcpResourcesSchema)
- Modify: `src/cloud/core.ts:58-62` (add SIZE_MAP_GCP)

- [ ] **Step 1: Install the GCP compute SDK**

```bash
cd ~/hermes-deploy && npm install @google-cloud/compute
```

- [ ] **Step 2: Update GcpResourcesSchema in state-toml.ts**

The current schema has `firewall_rule_name: string` and `external_ip: string`. Per the spec, GCP needs `firewall_rule_names: string[]` (SSH and inbound are separate rules with different sourceRanges) and `static_ip_name: string` (addresses.delete takes a name, not an IP).

Replace lines 12-17 in `src/schema/state-toml.ts`:

```typescript
const GcpResourcesSchema = z.object({
  instance_name: z.string().min(1),
  static_ip_name: z.string().min(1),
  firewall_rule_names: z.array(z.string().min(1)),
  project_id: z.string().min(1),
  zone: z.string().min(1),
});
```

- [ ] **Step 3: Add SIZE_MAP_GCP to core.ts**

After `SIZE_MAP_AWS` (line 62), add:

```typescript
export const SIZE_MAP_GCP: Record<Size, string> = {
  small: 'e2-small',        // 2 vCPU, 2 GB
  medium: 'e2-medium',      // 2 vCPU, 4 GB
  large: 'e2-standard-2',   // 2 vCPU, 8 GB
};
```

- [ ] **Step 4: Run tests to verify no regressions**

```bash
npx vitest run
```

Expected: 112 passing. The state schema change is backward-compatible because state.toml files with GCP entries don't exist yet in any real deployment.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/schema/state-toml.ts src/cloud/core.ts
git commit -m "feat(cloud): add @google-cloud/compute dep + update GcpResources schema + SIZE_MAP_GCP"
```

---

### Task 2: GCP image resolution with caching

**Files:**
- Create: `src/cloud/gcp/images.ts`
- Create: `tests/unit/cloud/gcp/images.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/cloud/gcp/images.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock @google-cloud/compute before importing our module
const mockList = vi.fn();
vi.mock('@google-cloud/compute', () => ({
  ImagesClient: vi.fn().mockImplementation(() => ({ list: mockList })),
}));

import { resolveNixosGceImage } from '../../../../src/cloud/gcp/images.js';

describe('resolveNixosGceImage', () => {
  let cacheFile: string;

  beforeEach(() => {
    mockList.mockReset();
    cacheFile = join(mkdtempSync(join(tmpdir(), 'hermes-gcp-img-')), 'images.json');
  });

  afterEach(() => {
    if (existsSync(cacheFile)) rmSync(cacheFile, { recursive: true });
  });

  it('queries GCE images and returns the newest one', async () => {
    mockList.mockResolvedValueOnce([[
      { name: 'nixos-25-11-old', selfLink: 'projects/nixos-foundation-org/global/images/nixos-25-11-old', creationTimestamp: '2026-01-01T00:00:00Z' },
      { name: 'nixos-25-11-new', selfLink: 'projects/nixos-foundation-org/global/images/nixos-25-11-new', creationTimestamp: '2026-06-01T00:00:00Z' },
    ]]);
    const ref = await resolveNixosGceImage(cacheFile);
    expect(ref.id).toContain('nixos-25-11-new');
    expect(ref.description).toContain('nixos-25-11-new');
  });

  it('returns the cached value on a second call within TTL', async () => {
    mockList.mockResolvedValueOnce([[
      { name: 'nixos-cached', selfLink: 'projects/nixos-foundation-org/global/images/nixos-cached', creationTimestamp: '2026-06-01T00:00:00Z' },
    ]]);
    await resolveNixosGceImage(cacheFile);
    expect(mockList).toHaveBeenCalledTimes(1);
    await resolveNixosGceImage(cacheFile);
    expect(mockList).toHaveBeenCalledTimes(1); // not re-called
  });

  it('throws when no images are returned', async () => {
    mockList.mockResolvedValueOnce([[]]);
    await expect(resolveNixosGceImage(cacheFile)).rejects.toThrow(/no NixOS GCE image/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/cloud/gcp/images.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/cloud/gcp/images.ts
import { ImagesClient } from '@google-cloud/compute';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ImageRef } from '../core.js';

const NIXOS_PROJECT = 'nixos-foundation-org';
const NIXOS_NAME_PREFIX = 'nixos-25-11';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedImage {
  cloud: string;
  imageId: string;
  description: string;
  fetchedAt: number;
}

interface ImageCache {
  entries: CachedImage[];
}

export async function resolveNixosGceImage(
  cacheFile: string,
): Promise<ImageRef> {
  const now = Date.now();

  const cache = readCache(cacheFile);
  const hit = cache.entries.find(
    e => e.cloud === 'gcp' && now - e.fetchedAt < CACHE_TTL_MS,
  );
  if (hit) {
    return { id: hit.imageId, description: hit.description };
  }

  const client = new ImagesClient();
  const [images] = await client.list({
    project: NIXOS_PROJECT,
    filter: `name = "${NIXOS_NAME_PREFIX}*"`,
  });

  const matching = (images ?? []).filter(
    img => img.name?.startsWith(NIXOS_NAME_PREFIX),
  );
  if (matching.length === 0) {
    throw new Error(`no NixOS GCE image found matching ${NIXOS_NAME_PREFIX}*`);
  }

  const sorted = [...matching].sort((a, b) => {
    const da = new Date(a.creationTimestamp ?? 0).getTime();
    const db = new Date(b.creationTimestamp ?? 0).getTime();
    return db - da;
  });
  const latest = sorted[0]!;

  const ref: ImageRef = {
    id: latest.selfLink!,
    description: latest.name ?? 'nixos',
  };

  cache.entries = cache.entries.filter(e => e.cloud !== 'gcp');
  cache.entries.push({
    cloud: 'gcp',
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
    return JSON.parse(readFileSync(path, 'utf-8')) as ImageCache;
  } catch {
    return { entries: [] };
  }
}

function writeCache(path: string, cache: ImageCache): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/cloud/gcp/images.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/cloud/gcp/images.ts tests/unit/cloud/gcp/images.test.ts
git commit -m "feat(cloud/gcp): NixOS GCE image resolution with 1h cache"
```

---

### Task 3: GCP destroy

**Files:**
- Create: `src/cloud/gcp/destroy.ts`
- Create: `tests/unit/cloud/gcp/destroy.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/cloud/gcp/destroy.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { ResourceLedger } from '../../../../src/cloud/core.js';

const mockInstancesDelete = vi.fn();
const mockInstancesGet = vi.fn();
const mockAddressesDelete = vi.fn();
const mockFirewallsDelete = vi.fn();

vi.mock('@google-cloud/compute', () => ({
  InstancesClient: vi.fn().mockImplementation(() => ({
    delete: mockInstancesDelete,
    get: mockInstancesGet,
  })),
  AddressesClient: vi.fn().mockImplementation(() => ({
    delete: mockAddressesDelete,
  })),
  FirewallsClient: vi.fn().mockImplementation(() => ({
    delete: mockFirewallsDelete,
  })),
}));

import { destroyGcp } from '../../../../src/cloud/gcp/destroy.js';

describe('destroyGcp', () => {
  beforeEach(() => {
    mockInstancesDelete.mockReset();
    mockInstancesGet.mockReset();
    mockAddressesDelete.mockReset();
    mockFirewallsDelete.mockReset();
  });

  it('deletes resources in reverse dependency order', async () => {
    mockInstancesDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockAddressesDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockFirewallsDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockFirewallsDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);

    const ledger: ResourceLedger = {
      kind: 'gcp',
      resources: {
        instance_name: 'hermes-deploy-test',
        static_ip_name: 'hermes-deploy-test',
        firewall_rule_names: ['hermes-deploy-test-ssh', 'hermes-deploy-test-ports'],
        project_id: 'my-project',
        zone: 'europe-west1-b',
      },
    };
    await destroyGcp(ledger);
    expect(mockInstancesDelete).toHaveBeenCalledTimes(1);
    expect(mockAddressesDelete).toHaveBeenCalledTimes(1);
    expect(mockFirewallsDelete).toHaveBeenCalledTimes(2);
  });

  it('is idempotent against already-deleted resources', async () => {
    mockInstancesDelete.mockRejectedValueOnce(new Error('NOT_FOUND'));
    mockAddressesDelete.mockRejectedValueOnce(new Error('NOT_FOUND'));
    mockFirewallsDelete.mockRejectedValueOnce(new Error('NOT_FOUND'));

    const ledger: ResourceLedger = {
      kind: 'gcp',
      resources: {
        instance_name: 'hermes-deploy-test',
        static_ip_name: 'hermes-deploy-test',
        firewall_rule_names: ['hermes-deploy-test-ssh'],
        project_id: 'my-project',
        zone: 'europe-west1-b',
      },
    };
    await expect(destroyGcp(ledger)).resolves.toBeUndefined();
  });

  it('skips steps for missing ledger fields', async () => {
    const ledger: ResourceLedger = { kind: 'gcp', resources: {} };
    await destroyGcp(ledger);
    expect(mockInstancesDelete).not.toHaveBeenCalled();
    expect(mockAddressesDelete).not.toHaveBeenCalled();
    expect(mockFirewallsDelete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/cloud/gcp/destroy.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/cloud/gcp/destroy.ts
import { InstancesClient, AddressesClient, FirewallsClient } from '@google-cloud/compute';
import type { ResourceLedger } from '../core.js';

export async function destroyGcp(ledger: ResourceLedger): Promise<void> {
  if (ledger.kind !== 'gcp') throw new Error(`expected gcp ledger, got ${ledger.kind}`);
  const r = ledger.resources;
  const project = r.project_id;
  const zone = r.zone;

  // Order: instance → static IP → firewall rules (reverse of provision deps)
  if (r.instance_name && project && zone) {
    try {
      const client = new InstancesClient();
      const [op] = await client.delete({ project, zone, instance: r.instance_name });
      await op.promise();
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    delete r.instance_name;
  }

  if (r.static_ip_name && project && zone) {
    const region = zoneToRegion(zone);
    try {
      const client = new AddressesClient();
      const [op] = await client.delete({ project, region, address: r.static_ip_name });
      await op.promise();
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    delete r.static_ip_name;
  }

  if (r.firewall_rule_names && project) {
    const client = new FirewallsClient();
    for (const name of r.firewall_rule_names) {
      try {
        const [op] = await client.delete({ project, firewall: name });
        await op.promise();
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    }
    delete r.firewall_rule_names;
  }
}

export function zoneToRegion(zone: string): string {
  // europe-west1-b → europe-west1
  return zone.replace(/-[a-z]$/, '');
}

function isNotFound(e: unknown): boolean {
  const msg = (e as Error).message ?? '';
  return /NOT_FOUND|not found|does not exist|notFound/i.test(msg);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/cloud/gcp/destroy.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/cloud/gcp/destroy.ts tests/unit/cloud/gcp/destroy.test.ts
git commit -m "feat(cloud/gcp): destroy with idempotent not-found handling"
```

---

### Task 4: GCP status

**Files:**
- Create: `src/cloud/gcp/status.ts`
- Create: `tests/unit/cloud/gcp/status.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/cloud/gcp/status.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('@google-cloud/compute', () => ({
  InstancesClient: vi.fn().mockImplementation(() => ({ get: mockGet })),
}));

import { statusGcp } from '../../../../src/cloud/gcp/status.js';
import type { ResourceLedger } from '../../../../src/cloud/core.js';

describe('statusGcp', () => {
  beforeEach(() => mockGet.mockReset());

  it('returns running and the public ip', async () => {
    mockGet.mockResolvedValueOnce([{
      status: 'RUNNING',
      networkInterfaces: [{ accessConfigs: [{ natIP: '34.78.1.2' }] }],
    }]);
    const ledger: ResourceLedger = {
      kind: 'gcp',
      resources: { instance_name: 'i-1', project_id: 'p', zone: 'z' },
    };
    const result = await statusGcp(ledger);
    expect(result.state).toBe('running');
    expect(result.publicIp).toBe('34.78.1.2');
  });

  it('returns unknown if instance_name is missing', async () => {
    const ledger: ResourceLedger = { kind: 'gcp', resources: { project_id: 'p', zone: 'z' } };
    const result = await statusGcp(ledger);
    expect(result.state).toBe('unknown');
    expect(result.publicIp).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/cloud/gcp/status.test.ts
```

- [ ] **Step 3: Write the implementation**

```typescript
// src/cloud/gcp/status.ts
import { InstancesClient } from '@google-cloud/compute';
import type { InstanceStatus, ResourceLedger } from '../core.js';

const GCE_STATE_MAP: Record<string, InstanceStatus['state']> = {
  PROVISIONING: 'pending',
  STAGING: 'pending',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  TERMINATED: 'terminated',
  SUSPENDING: 'stopping',
  SUSPENDED: 'stopped',
};

export async function statusGcp(ledger: ResourceLedger): Promise<InstanceStatus> {
  if (ledger.kind !== 'gcp') throw new Error('expected gcp ledger');
  const { instance_name, project_id, zone } = ledger.resources;
  if (!instance_name || !project_id || !zone) {
    return { state: 'unknown', publicIp: null };
  }

  try {
    const client = new InstancesClient();
    const [instance] = await client.get({ project: project_id, zone, instance: instance_name });
    const state = GCE_STATE_MAP[instance.status ?? ''] ?? 'unknown';
    const publicIp = instance.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP ?? null;
    return { state, publicIp };
  } catch {
    return { state: 'unknown', publicIp: null };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/cloud/gcp/status.test.ts
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/cloud/gcp/status.ts tests/unit/cloud/gcp/status.test.ts
git commit -m "feat(cloud/gcp): instance status with GCE state mapping"
```

---

### Task 5: GCP provisioning

**Files:**
- Create: `src/cloud/gcp/provision.ts`
- Create: `tests/unit/cloud/gcp/provision.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/cloud/gcp/provision.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProvisionSpec, ResourceLedger } from '../../../../src/cloud/core.js';

const mockAddressesInsert = vi.fn();
const mockFirewallsInsert = vi.fn();
const mockInstancesInsert = vi.fn();
const mockInstancesGet = vi.fn();
const mockInstancesDelete = vi.fn();
const mockAddressesDelete = vi.fn();
const mockFirewallsDelete = vi.fn();

vi.mock('@google-cloud/compute', () => ({
  AddressesClient: vi.fn().mockImplementation(() => ({
    insert: mockAddressesInsert,
    delete: mockAddressesDelete,
  })),
  FirewallsClient: vi.fn().mockImplementation(() => ({
    insert: mockFirewallsInsert,
    delete: mockFirewallsDelete,
  })),
  InstancesClient: vi.fn().mockImplementation(() => ({
    insert: mockInstancesInsert,
    get: mockInstancesGet,
    delete: mockInstancesDelete,
  })),
}));

import { provisionGcp } from '../../../../src/cloud/gcp/provision.js';

describe('provisionGcp', () => {
  beforeEach(() => {
    mockAddressesInsert.mockReset();
    mockFirewallsInsert.mockReset();
    mockInstancesInsert.mockReset();
    mockInstancesGet.mockReset();
    mockInstancesDelete.mockReset();
    mockAddressesDelete.mockReset();
    mockFirewallsDelete.mockReset();
  });

  const spec: ProvisionSpec = {
    deploymentName: 'test',
    location: { region: 'europe-west1', zone: 'europe-west1-b' },
    size: 'large',
    diskGb: 30,
    image: { id: 'projects/nixos-foundation-org/global/images/nixos-img', description: 'nixos' },
    publicSshKey: 'ssh-ed25519 AAAA test',
    networkRules: { sshAllowedFrom: '203.0.113.1/32', inboundPorts: [443] },
  };

  it('runs the full sequence and returns an instance', async () => {
    // Reserve static IP
    mockAddressesInsert.mockResolvedValueOnce([{
      promise: () => Promise.resolve(),
      metadata: { targetLink: 'https://compute.googleapis.com/compute/v1/projects/my-project/regions/europe-west1/addresses/hermes-deploy-test' },
    }]);
    // The insert returns an operation; we also need to get the IP afterwards.
    // Actually, for the address, the IP is returned in the operation metadata
    // or we call get. Let's mock the response to include the IP directly.
    // Simplification: provisionGcp will call addresses.get after insert to retrieve the IP.

    // Create SSH firewall rule
    mockFirewallsInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    // Create inbound firewall rule
    mockFirewallsInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    // Create instance
    mockInstancesInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    // Poll for running
    mockInstancesGet.mockResolvedValueOnce([{
      status: 'RUNNING',
      networkInterfaces: [{ accessConfigs: [{ natIP: '34.78.1.2' }] }],
    }]);

    const ledger: ResourceLedger = { kind: 'gcp', resources: {} };
    const instance = await provisionGcp('my-project', spec, ledger);

    expect(instance.publicIp).toBe('34.78.1.2');
    expect(instance.sshUser).toBe('root');
    expect(ledger.kind === 'gcp' && ledger.resources.instance_name).toBe('hermes-deploy-test');
    expect(ledger.kind === 'gcp' && ledger.resources.static_ip_name).toBe('hermes-deploy-test');
    expect(ledger.kind === 'gcp' && ledger.resources.firewall_rule_names).toEqual([
      'hermes-deploy-test-ssh',
      'hermes-deploy-test-ports',
    ]);
  });

  it('rolls back resources created so far if instance insert fails', async () => {
    mockAddressesInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockFirewallsInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockFirewallsInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockInstancesInsert.mockRejectedValueOnce(new Error('QUOTA_EXCEEDED'));
    // Rollback calls
    mockAddressesDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockFirewallsDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);
    mockFirewallsDelete.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);

    const ledger: ResourceLedger = { kind: 'gcp', resources: {} };
    await expect(provisionGcp('my-project', spec, ledger)).rejects.toThrow(/QUOTA_EXCEEDED/);

    // After rollback, ledger should be empty
    expect(ledger.kind === 'gcp' && ledger.resources.instance_name).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/cloud/gcp/provision.test.ts
```

- [ ] **Step 3: Write the implementation**

```typescript
// src/cloud/gcp/provision.ts
import {
  InstancesClient,
  AddressesClient,
  FirewallsClient,
} from '@google-cloud/compute';
import type { ProvisionSpec, ResourceLedger, Instance } from '../core.js';
import { SIZE_MAP_GCP } from '../core.js';
import { destroyGcp, zoneToRegion } from './destroy.js';
import { CloudProvisionError } from '../../errors/index.js';

const LABEL_MANAGED_BY = 'managed-by';
const LABEL_DEPLOYMENT = 'hermes-deploy-deployment';
const LABEL_VALUE = 'hermes-deploy';

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 300_000;

export async function provisionGcp(
  project: string,
  spec: ProvisionSpec,
  ledger: ResourceLedger,
): Promise<Instance> {
  if (ledger.kind !== 'gcp') throw new Error(`expected gcp ledger, got ${ledger.kind}`);
  const r = ledger.resources;
  const zone = spec.location.zone!;
  const region = zoneToRegion(zone);
  const name = `hermes-deploy-${spec.deploymentName}`;

  r.project_id = project;
  r.zone = zone;

  try {
    // 1. Reserve static external IP
    const addressesClient = new AddressesClient();
    const [addressOp] = await addressesClient.insert({
      project,
      region,
      addressResource: {
        name,
        addressType: 'EXTERNAL',
        networkTier: 'PREMIUM',
      },
    });
    await addressOp.promise();
    r.static_ip_name = name;

    // Retrieve the allocated IP address
    const [addressInfo] = await addressesClient.get({ project, region, address: name });
    const publicIp = addressInfo.address!;

    // 2. Create firewall rules
    const firewallsClient = new FirewallsClient();
    const ruleNames: string[] = [];

    // Rule A: SSH from user IP
    const sshRuleName = `${name}-ssh`;
    const [sshOp] = await firewallsClient.insert({
      project,
      firewallResource: {
        name: sshRuleName,
        network: `projects/${project}/global/networks/default`,
        direction: 'INGRESS',
        allowed: [{ IPProtocol: 'tcp', ports: ['22'] }],
        sourceRanges: [spec.networkRules.sshAllowedFrom],
        targetTags: [name],
      },
    });
    await sshOp.promise();
    ruleNames.push(sshRuleName);

    // Rule B: inbound ports (only if non-empty)
    if (spec.networkRules.inboundPorts.length > 0) {
      const portsRuleName = `${name}-ports`;
      const [portsOp] = await firewallsClient.insert({
        project,
        firewallResource: {
          name: portsRuleName,
          network: `projects/${project}/global/networks/default`,
          direction: 'INGRESS',
          allowed: [{ IPProtocol: 'tcp', ports: spec.networkRules.inboundPorts.map(String) }],
          sourceRanges: ['0.0.0.0/0'],
          targetTags: [name],
        },
      });
      await portsOp.promise();
      ruleNames.push(portsRuleName);
    }
    r.firewall_rule_names = ruleNames;

    // 3. Create instance
    const instancesClient = new InstancesClient();
    const [instanceOp] = await instancesClient.insert({
      project,
      zone,
      instanceResource: {
        name,
        machineType: `zones/${zone}/machineTypes/${SIZE_MAP_GCP[spec.size]}`,
        disks: [{
          initializeParams: {
            sourceImage: spec.image.id,
            diskSizeGb: String(spec.diskGb),
            diskType: `zones/${zone}/diskTypes/pd-ssd`,
          },
          boot: true,
          autoDelete: true,
        }],
        networkInterfaces: [{
          network: `projects/${project}/global/networks/default`,
          accessConfigs: [{
            name: 'External NAT',
            natIP: publicIp,
            type: 'ONE_TO_ONE_NAT',
          }],
        }],
        metadata: {
          items: [{ key: 'ssh-keys', value: `root:${spec.publicSshKey}` }],
        },
        tags: { items: [name] },
        labels: {
          [LABEL_MANAGED_BY]: LABEL_VALUE,
          [LABEL_DEPLOYMENT]: spec.deploymentName,
        },
      },
    });
    await instanceOp.promise();
    r.instance_name = name;

    // 4. Poll until RUNNING
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const [inst] = await instancesClient.get({ project, zone, instance: name });
      if (inst.status === 'RUNNING') {
        return { publicIp, sshUser: 'root' };
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(`instance ${name} did not reach RUNNING within ${POLL_TIMEOUT_MS / 1000}s`);
  } catch (e) {
    try {
      await destroyGcp(ledger);
    } catch {
      // Swallow rollback errors; surface the original
    }
    throw new CloudProvisionError(
      `GCP provisioning failed: ${(e as Error).message}`,
      e,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/cloud/gcp/provision.test.ts
```

Expected: 2 passing. The test may need adjustment if the mock interaction for `addresses.get` doesn't match — update the mock setup to also mock `AddressesClient.get` for the IP retrieval step.

- [ ] **Step 5: Commit**

```bash
git add src/cloud/gcp/provision.ts tests/unit/cloud/gcp/provision.test.ts
git commit -m "feat(cloud/gcp): provisioning with static IP, firewall rules, instance, and rollback"
```

---

### Task 6: GCP network reconciliation

**Files:**
- Create: `src/cloud/gcp/reconcile-network.ts`
- Create: `tests/unit/cloud/gcp/reconcile-network.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/cloud/gcp/reconcile-network.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResourceLedger } from '../../../../src/cloud/core.js';

const mockFirewallsGet = vi.fn();
const mockFirewallsPatch = vi.fn();
const mockFirewallsInsert = vi.fn();
const mockFirewallsDelete = vi.fn();

vi.mock('@google-cloud/compute', () => ({
  FirewallsClient: vi.fn().mockImplementation(() => ({
    get: mockFirewallsGet,
    patch: mockFirewallsPatch,
    insert: mockFirewallsInsert,
    delete: mockFirewallsDelete,
  })),
}));

import { reconcileNetworkGcp } from '../../../../src/cloud/gcp/reconcile-network.js';

describe('reconcileNetworkGcp', () => {
  beforeEach(() => {
    mockFirewallsGet.mockReset();
    mockFirewallsPatch.mockReset();
    mockFirewallsInsert.mockReset();
    mockFirewallsDelete.mockReset();
  });

  const ledger: ResourceLedger = {
    kind: 'gcp',
    resources: {
      instance_name: 'hermes-deploy-test',
      project_id: 'my-project',
      zone: 'europe-west1-b',
      firewall_rule_names: ['hermes-deploy-test-ssh'],
    },
  };

  it('patches the SSH rule when the CIDR changes', async () => {
    mockFirewallsGet.mockResolvedValueOnce([{
      name: 'hermes-deploy-test-ssh',
      allowed: [{ IPProtocol: 'tcp', ports: ['22'] }],
      sourceRanges: ['1.1.1.1/32'],
    }]);
    mockFirewallsPatch.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);

    await reconcileNetworkGcp(ledger, {
      sshAllowedFrom: '2.2.2.2/32',
      inboundPorts: [],
    });

    expect(mockFirewallsPatch).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when rules already match', async () => {
    mockFirewallsGet.mockResolvedValueOnce([{
      name: 'hermes-deploy-test-ssh',
      allowed: [{ IPProtocol: 'tcp', ports: ['22'] }],
      sourceRanges: ['1.2.3.4/32'],
    }]);

    await reconcileNetworkGcp(ledger, {
      sshAllowedFrom: '1.2.3.4/32',
      inboundPorts: [],
    });

    expect(mockFirewallsPatch).not.toHaveBeenCalled();
    expect(mockFirewallsInsert).not.toHaveBeenCalled();
    expect(mockFirewallsDelete).not.toHaveBeenCalled();
  });

  it('creates a ports rule when inboundPorts are added', async () => {
    mockFirewallsGet.mockResolvedValueOnce([{
      name: 'hermes-deploy-test-ssh',
      allowed: [{ IPProtocol: 'tcp', ports: ['22'] }],
      sourceRanges: ['1.2.3.4/32'],
    }]);
    mockFirewallsInsert.mockResolvedValueOnce([{ promise: () => Promise.resolve() }]);

    const mutableLedger: ResourceLedger = {
      kind: 'gcp',
      resources: {
        ...ledger.resources,
        firewall_rule_names: ['hermes-deploy-test-ssh'],
      },
    };

    await reconcileNetworkGcp(mutableLedger, {
      sshAllowedFrom: '1.2.3.4/32',
      inboundPorts: [443, 8080],
    });

    expect(mockFirewallsInsert).toHaveBeenCalledTimes(1);
    if (mutableLedger.kind === 'gcp') {
      expect(mutableLedger.resources.firewall_rule_names).toContain('hermes-deploy-test-ports');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/cloud/gcp/reconcile-network.test.ts
```

- [ ] **Step 3: Write the implementation**

```typescript
// src/cloud/gcp/reconcile-network.ts
import { FirewallsClient } from '@google-cloud/compute';
import type { ResourceLedger, NetworkRules } from '../core.js';

export async function reconcileNetworkGcp(
  ledger: ResourceLedger,
  rules: NetworkRules,
): Promise<void> {
  if (ledger.kind !== 'gcp') throw new Error(`expected gcp ledger, got ${ledger.kind}`);
  const r = ledger.resources;
  const project = r.project_id;
  if (!project || !r.instance_name) {
    throw new Error('reconcileNetworkGcp: ledger missing project_id or instance_name');
  }

  const client = new FirewallsClient();
  const baseName = r.instance_name; // hermes-deploy-<name>
  const sshRuleName = `${baseName}-ssh`;
  const portsRuleName = `${baseName}-ports`;
  const ruleNames = r.firewall_rule_names ?? [];

  // --- SSH rule ---
  if (ruleNames.includes(sshRuleName)) {
    const [current] = await client.get({ project, firewall: sshRuleName });
    const currentCidr = current.sourceRanges?.[0];
    if (currentCidr !== rules.sshAllowedFrom) {
      const [op] = await client.patch({
        project,
        firewall: sshRuleName,
        firewallResource: { sourceRanges: [rules.sshAllowedFrom] },
      });
      await op.promise();
    }
  }

  // --- Ports rule ---
  const hasPortsRule = ruleNames.includes(portsRuleName);
  const wantsPorts = rules.inboundPorts.length > 0;

  if (wantsPorts && !hasPortsRule) {
    // Create the ports rule
    const [op] = await client.insert({
      project,
      firewallResource: {
        name: portsRuleName,
        network: `projects/${project}/global/networks/default`,
        direction: 'INGRESS',
        allowed: [{ IPProtocol: 'tcp', ports: rules.inboundPorts.map(String) }],
        sourceRanges: ['0.0.0.0/0'],
        targetTags: [baseName],
      },
    });
    await op.promise();
    r.firewall_rule_names = [...ruleNames, portsRuleName];
  } else if (wantsPorts && hasPortsRule) {
    // Patch existing ports rule if ports changed
    const [current] = await client.get({ project, firewall: portsRuleName });
    const currentPorts = current.allowed?.[0]?.ports ?? [];
    const desiredPorts = rules.inboundPorts.map(String).sort();
    if (JSON.stringify([...currentPorts].sort()) !== JSON.stringify(desiredPorts)) {
      const [op] = await client.patch({
        project,
        firewall: portsRuleName,
        firewallResource: {
          allowed: [{ IPProtocol: 'tcp', ports: desiredPorts }],
        },
      });
      await op.promise();
    }
  } else if (!wantsPorts && hasPortsRule) {
    // Delete the ports rule
    const [op] = await client.delete({ project, firewall: portsRuleName });
    await op.promise();
    r.firewall_rule_names = ruleNames.filter(n => n !== portsRuleName);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/cloud/gcp/reconcile-network.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/cloud/gcp/reconcile-network.ts tests/unit/cloud/gcp/reconcile-network.test.ts
git commit -m "feat(cloud/gcp): firewall rule reconciliation with PATCH support"
```

---

### Task 7: GcpProvider class + factory wiring

**Files:**
- Create: `src/cloud/gcp/provider.ts`
- Modify: `src/cloud/factory.ts`

- [ ] **Step 1: Write GcpProvider**

```typescript
// src/cloud/gcp/provider.ts
import { execFileSync } from 'node:child_process';
import type {
  CloudProvider,
  ImageRef,
  Instance,
  InstanceStatus,
  Location,
  NetworkRules,
  ProvisionSpec,
  ResourceLedger,
} from '../core.js';
import { resolveNixosGceImage } from './images.js';
import { provisionGcp } from './provision.js';
import { reconcileNetworkGcp } from './reconcile-network.js';
import { destroyGcp } from './destroy.js';
import { statusGcp } from './status.js';

export interface GcpProviderOptions {
  zone: string;
  project?: string; // resolved lazily if not provided
  imageCacheFile: string;
}

export class GcpProvider implements CloudProvider {
  readonly name = 'gcp' as const;
  private resolvedProject: string | undefined;

  constructor(private readonly opts: GcpProviderOptions) {
    this.resolvedProject = opts.project;
  }

  private async getProject(): Promise<string> {
    if (this.resolvedProject) return this.resolvedProject;

    // 1. GOOGLE_CLOUD_PROJECT env var
    if (process.env.GOOGLE_CLOUD_PROJECT) {
      this.resolvedProject = process.env.GOOGLE_CLOUD_PROJECT;
      return this.resolvedProject;
    }

    // 2. gcloud config
    try {
      const result = execFileSync('gcloud', ['config', 'get-value', 'project'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (result && result !== '(unset)') {
        this.resolvedProject = result;
        return this.resolvedProject;
      }
    } catch {
      // gcloud not installed or not configured
    }

    throw new Error(
      'Could not determine GCP project. Set GOOGLE_CLOUD_PROJECT env var or run `gcloud config set project <id>`.',
    );
  }

  async resolveNixosImage(_loc: Location): Promise<ImageRef> {
    return resolveNixosGceImage(this.opts.imageCacheFile);
  }

  async provision(spec: ProvisionSpec, ledger: ResourceLedger): Promise<Instance> {
    const project = await this.getProject();
    return provisionGcp(project, spec, ledger);
  }

  async reconcileNetwork(ledger: ResourceLedger, rules: NetworkRules): Promise<void> {
    return reconcileNetworkGcp(ledger, rules);
  }

  destroy(ledger: ResourceLedger): Promise<void> {
    return destroyGcp(ledger);
  }

  status(ledger: ResourceLedger): Promise<InstanceStatus> {
    return statusGcp(ledger);
  }
}
```

- [ ] **Step 2: Update factory.ts**

Replace the entire file:

```typescript
// src/cloud/factory.ts
import type { CloudProvider } from './core.js';
import { AwsProvider } from './aws/provider.js';
import { GcpProvider } from './gcp/provider.js';

export interface CreateProviderOptions {
  provider: 'aws' | 'gcp';
  region: string;
  zone?: string;
  profile?: string;
  imageCacheFile: string;
}

export function createCloudProvider(opts: CreateProviderOptions): CloudProvider {
  switch (opts.provider) {
    case 'aws':
      return new AwsProvider({
        region: opts.region,
        profile: opts.profile,
        imageCacheFile: opts.imageCacheFile,
      });
    case 'gcp':
      if (!opts.zone) {
        throw new Error('cloud.zone is required when provider = "gcp"');
      }
      return new GcpProvider({
        zone: opts.zone,
        imageCacheFile: opts.imageCacheFile,
      });
  }
}
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all passing (new GCP tests + existing AWS tests).

- [ ] **Step 4: Commit**

```bash
git add src/cloud/gcp/provider.ts src/cloud/factory.ts
git commit -m "feat(cloud/gcp): GcpProvider class + factory wiring"
```

---

### Task 8: Orchestrator + CLI wiring

**Files:**
- Modify: `src/orchestrator/deploy.ts` (add GCP ledger persistence)
- Modify: `src/commands/up.ts` (remove GCP gate, pass zone)
- Modify: `src/orchestrator/update.ts` (add GCP ledger reconstruction if needed)

- [ ] **Step 1: Add GCP branch to deploy.ts ledger persistence**

After the existing `if (ledger.kind === 'aws') { ... }` block (around line 118), add:

```typescript
  if (ledger.kind === 'gcp') {
    await store.update(state => {
      const now = new Date().toISOString();
      state.deployments[config.name] = {
        project_path: opts.projectDir,
        cloud: 'gcp',
        region: config.cloud.region,
        created_at: state.deployments[config.name]?.created_at ?? now,
        last_deployed_at: now,
        last_config_hash: 'pending',
        ssh_key_path: sshKeyPath,
        age_key_path: ageKeyPath,
        health: 'unknown',
        instance_ip: instance.publicIp,
        cloud_resources: {
          instance_name: ledger.resources.instance_name!,
          static_ip_name: ledger.resources.static_ip_name!,
          firewall_rule_names: ledger.resources.firewall_rule_names!,
          project_id: ledger.resources.project_id!,
          zone: ledger.resources.zone!,
        },
      };
    });
  }
```

- [ ] **Step 2: Remove GCP gate in up.ts**

Delete lines 30-32 in `src/commands/up.ts`:

```typescript
// DELETE THESE LINES:
  if (config.cloud.provider !== 'aws') {
    throw new Error(`hermes-deploy currently supports cloud.provider = "aws" only (got "${config.cloud.provider}"). GCP lands in M4.`);
  }
```

And update the factory call (around line 35-40) to pass `zone`:

```typescript
  const provider = createCloudProvider({
    provider: config.cloud.provider,
    region: config.cloud.region,
    zone: config.cloud.zone,
    profile: config.cloud.profile,
    imageCacheFile: paths.imageCacheFile,
  });
```

- [ ] **Step 3: Check update.ts for GCP ledger reconstruction**

Look at the ledger reconstruction in `src/orchestrator/update.ts`. It likely has a `deployment.cloud === 'aws'` branch to reconstruct the `ResourceLedger`. Add a GCP branch:

```typescript
  const ledger: ResourceLedger = deployment.cloud === 'aws'
    ? { kind: 'aws', resources: { ...deployment.cloud_resources } }
    : { kind: 'gcp', resources: { ...deployment.cloud_resources } };
```

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: all passing.

- [ ] **Step 5: Build and verify CLI**

```bash
npm run build && hermes-deploy --help
```

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/deploy.ts src/commands/up.ts src/orchestrator/update.ts
git commit -m "feat(cli): wire GCP through orchestrator and remove provider gate"
```

---

### Task 9: Init template + comment updates

**Files:**
- Modify: `src/init-templates/hermes-toml.ts`

- [ ] **Step 1: Update the GCP comment**

In `src/init-templates/hermes-toml.ts`, change:

```
provider = "aws"        # "aws" (M2/M3) or "gcp" (coming in M4)
```

to:

```
provider = "aws"        # "aws" or "gcp"
```

Add a commented-out zone example after the region line:

```
region   = "eu-west-3"
# zone   = "europe-west1-b"  # required when provider = "gcp"
```

- [ ] **Step 2: Run tests + build**

```bash
npx vitest run && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/init-templates/hermes-toml.ts
git commit -m "docs(init): update template to reflect GCP support"
```

---

### Task 10: Polish — `key path` validation

**Files:**
- Modify: `src/commands/key.ts:49-54`

- [ ] **Step 1: Verify the fix is already in place**

Read `src/commands/key.ts` — the M3 fix at commit `7ebd97e` may have already added the `existsSync` guard. Check lines 49-54.

If the guard is already there (the explore output showed it at lines 49-54 with `existsSync`), skip this task — it's already fixed.

If NOT there, add:

```typescript
export async function keyPath(opts: { name: string }): Promise<string> {
  const keyPathStr = getStatePaths().ageKeyForDeployment(opts.name);
  if (!existsSync(keyPathStr)) {
    throw new Error(`no age key for deployment "${opts.name}" at ${keyPathStr}`);
  }
  return keyPathStr;
}
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run tests/unit/commands/key.test.ts
```

- [ ] **Step 3: Commit (if changed)**

```bash
git add src/commands/key.ts
git commit -m "fix(cli): key path validates deployment exists"
```

---

### Task 11: Polish — placeholder cleanup in secretSet

**Files:**
- Modify: `src/commands/secret.ts` (secretSet function)

- [ ] **Step 1: Update secretSet to remove placeholder after first real secret**

In `src/commands/secret.ts`, update the `secretSet` function (around line 122-129):

```typescript
export async function secretSet(
  opts: SecretRefOptions & { key: string; value: string },
): Promise<void> {
  const ctx = await getContext(opts.name, opts.projectPath);
  const data = await readSecrets(ctx);
  data[opts.key] = opts.value;

  // Remove the bootstrap placeholder once a real secret is set.
  // It's harmless but clutters `secret list` and leaks into the
  // agent's environment.
  if (opts.key !== '_HERMES_DEPLOY_PLACEHOLDER') {
    delete data['_HERMES_DEPLOY_PLACEHOLDER'];
  }

  writeSecrets(ctx, data);
}
```

- [ ] **Step 2: Write a test**

Add to the existing `tests/unit/commands/secret.test.ts` (or the relevant test file):

```typescript
it('removes _HERMES_DEPLOY_PLACEHOLDER when setting a real secret', async () => {
  // Setup: create a sops file with the placeholder
  // ... (use the existing test pattern for secret set/get)
  await secretSet({ key: 'ANTHROPIC_API_KEY', value: 'sk-test' });
  const list = await secretList({});
  expect(list).not.toContain('_HERMES_DEPLOY_PLACEHOLDER');
  expect(list).toContain('ANTHROPIC_API_KEY');
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/unit/commands/secret.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/secret.ts tests/unit/commands/secret.test.ts
git commit -m "fix(cli): remove placeholder secret after first real secret set"
```

---

### Task 12: Polish — network-only update optimization

**Files:**
- Modify: `src/orchestrator/update.ts`

- [ ] **Step 1: Understand the current flow**

In `update.ts`, after reconcileNetwork, the code always proceeds to `uploadAndRebuild`. The optimization: hash the generated nix output and compare against the stored config hash. If nix output hasn't changed, skip the SSH+rebuild.

- [ ] **Step 2: Add nix-hash short-circuit**

After the reconcileNetwork call but before uploadAndRebuild, insert:

```typescript
  // Network-only optimization: if the nix-impactful config hasn't changed
  // (only network rules did), skip the expensive SSH + nixos-rebuild.
  const nixHash = computeConfigHash(
    [
      tomlPath,
      pathResolve(deployment.project_path, config.hermes.config_file),
      pathResolve(deployment.project_path, config.hermes.secrets_file),
      config.hermes.nix_extra
        ? pathResolve(deployment.project_path, config.hermes.nix_extra)
        : '',
      ...documentPaths,
    ].filter(Boolean),
    true,
  );
  if (nixHash === deployment.last_config_hash) {
    reporter.success(`network rules updated — ${opts.deploymentName} config unchanged`);
    return {
      health: deployment.health === 'healthy' ? 'healthy' : 'unhealthy',
      publicIp: deployment.instance_ip,
      skipped: false,
    };
  }
```

Note: this requires moving the hash computation BEFORE the `uploadAndRebuild` call, which may require rearranging the function. Check the exact flow in update.ts before editing.

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/unit/orchestrator/update.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/update.ts
git commit -m "perf(orchestrator): skip nixos-rebuild when only network rules changed"
```

---

### Task 13: Final — full test suite + build + version bump

**Files:**
- Modify: `package.json` (version bump to 0.4.0-m4)

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all passing (112 existing + ~15 new GCP tests).

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Version bump**

In `package.json`, change `"version": "0.3.0-m3"` to `"version": "0.4.0-m4"`.

- [ ] **Step 4: Run build + link + verify**

```bash
npm run build && npm link && hermes-deploy --version
```

Expected: `0.4.0-m4`

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 0.4.0-m4"
```
