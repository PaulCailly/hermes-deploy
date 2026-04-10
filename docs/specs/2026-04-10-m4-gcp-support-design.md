# M4: GCP support + polish bundle

> Design spec for hermes-deploy milestone 4.
> Approved 2026-04-10.

## Goal

Add Google Cloud Platform as a second cloud provider, reaching feature parity
with the existing AWS flow. Bundle small polish items deferred from M2/M3.
After M4, users can run `hermes-deploy init`, set `provider = "gcp"`, and get
the same `init -> secret set -> up -> update -> destroy` lifecycle they have on
AWS today.

## Approach

**Approach A (thin GCP provider, maximum code sharing).** The `CloudProvider`
interface already abstracts everything the orchestrator needs. GCP gets a new
`src/cloud/gcp/` subtree that implements the same interface using
`@google-cloud/compute`. Nothing above the provider layer changes except a new
`case 'gcp'` in the factory and a GCP branch in the orchestrator's state
persistence.

## SDK

`@google-cloud/compute` (first-party Google Cloud Node.js SDK). Auth via
Application Default Credentials (ADC) — same pattern as `@aws-sdk/client-ec2`
using the default credential chain. Users authenticate with `gcloud auth
application-default login` or a service account key file.

## Resource mapping

| AWS concept | GCP equivalent | Notes |
|---|---|---|
| EC2 key pair (`ImportKeyPairCommand`) | Instance metadata `ssh-keys` | No separate key-pair API. Public key embedded in instance metadata at creation. One fewer resource to track/destroy. |
| Security group + ingress rules | Firewall rule (`firewalls.insert`) | VPC-global, scoped to instances via target tags. One rule per deployment with multiple allowed port entries. Supports PATCH for reconciliation. |
| `RunInstancesCommand` | `instances.insert` | Includes boot disk sizing, network interface with static IP, metadata, tags, labels. |
| Elastic IP (`AllocateAddress` + `AssociateAddress`) | Static external IP (`addresses.insert`) | Regional. Assigned to instance via `networkInterfaces[0].accessConfigs[0].natIP` at creation time. |
| `waitUntilInstanceRunning` | Poll `instances.get` until `status === 'RUNNING'` | No built-in waiter in the SDK. Poll every 5s, timeout 300s. |
| NixOS AMI (`nixos/25.11*-x86_64-linux`, owner `427812963091`) | GCE image (`projects/nixos-foundation-org/global/images/nixos-25.11*`) | Global, not region-scoped. Same 1h cache strategy minus the region key. |

## GcpResources state shape

Already scaffolded in `src/schema/state-toml.ts`:

```typescript
interface GcpResources {
  instance_name: string;        // hermes-deploy-<name>
  static_ip_name: string;      // hermes-deploy-<name> (resource name for deletion)
  firewall_rule_names: string[];// ["hermes-deploy-<name>-ssh", "hermes-deploy-<name>-ports"]
  project_id: string;           // resolved from ADC or gcloud config
  zone: string;                 // e.g. europe-west1-b
}
```

Differences from the pre-scaffolded shape in `state-toml.ts` (needs update):
- `firewall_rule_name` (string) becomes `firewall_rule_names` (string[]) because
  GCP firewall rules apply their `sourceRanges` to ALL allowed ports in the
  rule. SSH (from user IP) and inbound ports (from `0.0.0.0/0`) need separate
  rules with different `sourceRanges`.
- `external_ip` (IP string) becomes `static_ip_name` (resource name) because
  `addresses.delete` takes a name, not an IP. The actual IP is already stored in
  `deployment.instance_ip` at the top level.
- No key pair field — GCP embeds SSH keys in instance metadata.

## Provisioning sequence

```
1. Resolve GCP project ID
   - Try @google-cloud/compute's auth.getProjectId()
   - Fall back to `gcloud config get-value project`
   - Store in ledger.project_id

2. Reserve static external IP (addresses.insert)
   - name: hermes-deploy-<name>
   - region: derived from zone (strip the trailing -[a-z])
   - ledger.external_ip = address.address

3. Create firewall rules (firewalls.insert x2)
   GCP firewall rules bind sourceRanges to ALL allowed ports, so SSH
   (from user IP) and inbound ports (from 0.0.0.0/0) need separate rules.

   Rule A — SSH:
   - name: hermes-deploy-<name>-ssh
   - targetTags: ["hermes-deploy-<name>"]
   - allowed: [{IPProtocol: "tcp", ports: ["22"]}]
   - sourceRanges: [sshAllowedFrom]

   Rule B — inbound ports (only if inboundPorts is non-empty):
   - name: hermes-deploy-<name>-ports
   - targetTags: ["hermes-deploy-<name>"]
   - allowed: [{IPProtocol: "tcp", ports: inboundPorts.map(String)}]
   - sourceRanges: ["0.0.0.0/0"]

   - ledger.firewall_rule_names = [ruleA.name, ruleB?.name].filter(Boolean)

4. Create instance (instances.insert)
   - name: hermes-deploy-<name>
   - zone: spec.location.zone
   - machineType: zones/<zone>/machineTypes/<SIZE_MAP_GCP[size]>
   - disks: [{initializeParams: {sourceImage: <nixos image>, diskSizeGb: spec.diskGb, diskType: pd-ssd}, boot: true, autoDelete: true}]
   - networkInterfaces: [{accessConfigs: [{natIP: reserved IP, type: "ONE_TO_ONE_NAT"}]}]
   - metadata.items: [{key: "ssh-keys", value: "root:<publicSshKey>"}]
   - tags.items: ["hermes-deploy-<name>"]
   - labels: {"managed-by": "hermes-deploy", "hermes-deploy-deployment": "<name>"}
   - ledger.instance_name = name
   - ledger.zone = zone

5. Poll instances.get until status === "RUNNING"
   - interval: 5s, timeout: 300s

6. Return { publicIp: reserved IP, sshUser: "root" }
```

Rollback on failure: `catch` block calls `destroyGcp(client, ledger)`, swallows
rollback errors, wraps original in `CloudProvisionError`. Same pattern as AWS.

## Destroy sequence

Reverse order, idempotent (swallow "not found" errors):

1. Delete instance → poll until NOT_FOUND or deleted
2. Release static IP (addresses.delete by name)
3. Delete firewall rules (firewalls.delete for each name in firewall_rule_names)
4. Clear ledger keys as each step succeeds

Instance deletion in GCP automatically detaches the static IP (unlike AWS where
you must disassociate before releasing). The static IP must still be explicitly
deleted to avoid billing for an unattached reserved IP.

## Network reconciliation

GCP firewall rules support PATCH, which is simpler than AWS's
authorize/revoke pair. Strategy:

1. Read current firewall rule by name
2. Compute desired `allowed` entries + `sourceRanges` from `spec.networkRules`
3. If they match, no-op
4. If they differ, PATCH the rule with the new values
5. If the rule doesn't exist (edge case after partial destroy), create it

Scoped to TCP single-port rules with IPv4 CIDRs only — same conservative
approach as AWS.

## NixOS image resolution on GCE

Query `projects/nixos-foundation-org/global/images` filtered by name prefix
`nixos-25.11` and architecture `X86_64`. Sort by `creationTimestamp`, pick
newest. Cache to `~/.cache/hermes-deploy/images.json` with 1h TTL. Cache key
is `"gcp"` (no region needed — GCE images are global).

## Size mapping

```typescript
const SIZE_MAP_GCP: Record<Size, string> = {
  small:  'e2-small',       // 2 vCPU, 2 GB
  medium: 'e2-medium',      // 2 vCPU, 4 GB
  large:  'e2-standard-2',  // 2 vCPU, 8 GB
};
```

Matches the AWS tiers in vCPU and RAM. The init template comment already warns
that "small" OOM-kills the first hermes-agent build.

## GCP project ID resolution

Order of precedence:

1. `GOOGLE_CLOUD_PROJECT` env var (explicit override)
2. ADC credentials' project (from `auth.getProjectId()` on the compute client)
3. `gcloud config get-value project` (shell fallback)

Resolved once at `GcpProvider` construction time and stored on the instance.
Passed into every API call that needs it.

## Factory and orchestrator changes

**Factory** (`src/cloud/factory.ts`): Add `case 'gcp'` that constructs
`GcpProvider` with zone, project (resolved), and imageCacheFile. Add `zone?`
and `project?` to `CreateProviderOptions`.

**Orchestrator** (`src/orchestrator/deploy.ts`): Add `if (ledger.kind === 'gcp')`
branch in the state persistence block, mirroring the AWS branch. Pass
`config.cloud.zone` through to the factory.

**CLI** (`src/commands/up.ts`): Remove the `throw new Error('GCP lands in M4')`
gate. Pass zone from the loaded config to the factory.

## Init template update

The init template's `hermes.toml` currently says `"gcp" (coming in M4)`. Update
the comment to reflect that GCP is now supported. Add a commented-out example
`zone = "europe-west1-b"` under the existing cloud section, matching the
existing pattern for optional fields.

## Polish bundle

Four small fixes shipped alongside GCP:

### 1. `key path` validation

`src/commands/key.ts:keyPath()` returns the path string without checking if the
deployment exists or the file is on disk. Add an `existsSync` guard matching
`keyExport()` behavior. One-line fix.

### 2. `_HERMES_DEPLOY_PLACEHOLDER` cleanup

In `secretSet()`, after writing the new key, check if
`_HERMES_DEPLOY_PLACEHOLDER` exists in the decrypted output and remove it. One
extra sops decrypt + re-encrypt cycle. Only triggers on the first real
`secret set` after `init`.

### 3. Network-only update optimization

In `runUpdate()`, after reconciling network rules, hash the generated nix output
(flake.nix + configuration.nix + hermes.nix). If the nix hash matches the
stored config hash, skip the SSH + nixos-rebuild step entirely. Print
"no config changes -- network rules updated" and return. This saves ~10-15s on
updates that only touch `inbound_ports` or `ssh_allowed_from`.

### 4. Comment and error message fixes

- `factory.ts`: update "M3" reference to current milestone
- `init-templates/hermes-toml.ts`: update GCP comment
- `up.ts`: remove or update the GCP error gate

## File structure

New files:

```
src/cloud/gcp/
  provider.ts              GcpProvider implements CloudProvider
  provision.ts             provisionGcp()
  destroy.ts               destroyGcp()
  status.ts                statusGcp()
  images.ts                resolveNixosGceImage()
  reconcile-network.ts     reconcileNetworkGcp()

tests/unit/cloud/gcp/
  provision.test.ts
  destroy.test.ts
  status.test.ts
  images.test.ts
  reconcile-network.test.ts
```

Modified files:

```
src/cloud/factory.ts          new 'gcp' branch + zone/project options
src/cloud/core.ts             SIZE_MAP_GCP export
src/orchestrator/deploy.ts    GCP state persistence branch
src/commands/up.ts            remove GCP error gate, pass zone
src/commands/key.ts           existsSync guard in keyPath()
src/commands/secret.ts        placeholder cleanup in secretSet()
src/orchestrator/update.ts    nix-hash short-circuit for network-only
src/init-templates/*          GCP comment updates
package.json                  add @google-cloud/compute dependency
```

## Testing

**Unit tests** (mocked SDK): mirror the AWS test structure. Each GCP module
gets a test file that mocks the `@google-cloud/compute` client methods and
verifies the provisioning sequence, rollback, destroy idempotency, image
caching, and network reconciliation.

**Smoke test**: real GCP project in `europe-west1-b`. Full lifecycle:
`init` (provider=gcp) -> `secret set` -> `up` -> `status` -> `ssh` -> `logs` ->
`update` (change model + rotate secret) -> `ls` (shows GCP deployment) ->
`destroy --yes`. Verify cleanup.

## Success criteria

1. `hermes-deploy up` with `provider = "gcp"` provisions a GCE VM, deploys
   hermes-agent via flake-based nixos-rebuild, and reports "hermes-agent is
   running at <IP>"
2. `hermes-deploy update` propagates config + secret changes and restarts the
   agent (restartTriggers verified in M3)
3. `hermes-deploy destroy` tears down all GCP resources with no leaks
4. `hermes-deploy ls` shows GCP deployments alongside any existing AWS ones
5. All existing AWS tests continue to pass (no regressions)
6. Polish items (`key path`, placeholder cleanup, network-only optimization)
   verified by unit tests
