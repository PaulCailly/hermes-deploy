# hermes-deploy — design

**Status:** draft v1
**Date:** 2026-04-09
**Author:** Paul Cailly

## 1. Overview

`hermes-deploy` is an open-source command-line tool that provisions and manages
[hermes-agent](https://hermes-agent.nousresearch.com/) instances on AWS and GCP
virtual machines. It is designed to make "spin up a new agent for a client" a
single-command operation, while remaining honest about the underlying NixOS
substrate that hermes-agent ships on.

The tool is written in TypeScript and renders its terminal UI with
[Ink](https://github.com/vadimdemedes/ink). It targets macOS and Linux (the
platforms that NixOS images, the cloud SDKs, and Ink all support cleanly).

## 2. Goals & non-goals

### Goals

- **One-command deploy.** From a fresh project directory, `hermes-deploy up`
  provisions a VM, applies a NixOS configuration, decrypts secrets, and starts
  the `hermes-agent` systemd service.
- **Both AWS and GCP from day 1.** Real client demand exists on both clouds;
  the abstraction must be honest, not aspirational.
- **Multi-instance, multi-client.** A single user manages many named
  deployments across many cloud accounts from one machine.
- **Per-project, version-controlled.** A deployment's configuration lives in
  the project directory it describes; cloning the repo on a new machine
  reproduces the deployment.
- **Open source, usable by people who don't know Nix.** A small TOML schema
  covers the common case; a Nix escape hatch covers everything else.
- **No state lost on partial failure.** Every operation that touches the cloud
  is either fully successful or fully rolled back.

### Non-goals (v1)

- A web dashboard, hosted backend, or any server component.
- Custom VPCs, private-only networking, peering, VPN, or Direct Connect.
- SSM Session Manager / IAP TCP forwarding for SSH.
- Pre-baked custom AMIs/GCE images via Packer.
- Cloud-native secret managers (AWS Secrets Manager, GCP Secret Manager).
- A CLI-managed cloud credential store parallel to `~/.aws/credentials` /
  `gcloud`.
- IaC engines (Pulumi, Terraform) under the hood.
- Cost projection, billing alerts, blue/green deploys, multi-region failover.
- A plugin system for additional cloud providers (Hetzner, Linode, etc.).

These are deliberate cuts. They are revisited in §13.

## 3. Decisions log

The design is the product of a sequence of forks. Each was discussed and
chosen explicitly:

| # | Decision | Choice |
|---|---|---|
| 1 | User-facing surface | Local CLI |
| 2 | Cloud scope at v1 | AWS and GCP shipped together |
| 3 | Audience | Open source, multi-user |
| 4 | What runs on the VPS | NixOS image with the hermes-agent native NixOS module |
| 5 | Image source | Community NixOS AMIs / GCE images, bootstrapped over SSH (no cloud-init secrets) |
| 6 | CLI lifecycle scope | Full lifecycle (`init`, `up`, `update`, `destroy`, `status`, `logs`, `ssh`, `ls`) with multi-instance management |
| 7 | Project layout | Per-project directory + global state index, like Terraform/Fly/Pulumi |
| 8 | Configuration UX | TOML wrapper for the common case + Nix escape hatch for power users |
| 9 | Secrets | sops-nix; CLI auto-generates and manages the age keypair |
| 10 | Cloud credentials | Standard SDK credential chain via `cloud.profile` / `cloud.project` in TOML |
| 11 | CLI language | TypeScript + Ink |
| 12 | Provisioning approach | Direct cloud SDKs (`@aws-sdk/*`, `@google-cloud/compute`); CLI-managed state |
| 13 | Networking defaults | Locked-down by default (SSH from deployer IP) + opt-in inbound ports + per-deployment generated SSH key + always-public IP |

## 4. Architecture

### 4.1 Layered shape

```
┌─────────────────────────────────────────────────────────────┐
│  hermes-deploy (TypeScript + Ink CLI, single npm package)   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐  ┌─────────────┐  ┌────────────────────────┐  │
│  │ commands │→ │ orchestrator│→ │ cloud abstraction (CP) │  │
│  │ (argv    │  │ (lifecycle  │  │  ┌──────┐  ┌──────┐    │  │
│  │  router) │  │  state      │  │  │ aws  │  │ gcp  │    │  │
│  │          │  │  machine)   │  │  └──────┘  └──────┘    │  │
│  └──────────┘  └─────────────┘  └────────────────────────┘  │
│       │              │                     │               │
│       ▼              ▼                     ▼               │
│  ┌──────────┐  ┌─────────────┐  ┌────────────────────────┐  │
│  │  ink ui  │  │ project &   │  │ remote ops             │  │
│  │ (timeline│  │ state files │  │ (ssh, sops, nixos-     │  │
│  │  logs,   │  │ (toml,      │  │  rebuild over SSH)     │  │
│  │  forms)  │  │  schema)    │  └────────────────────────┘  │
│  └──────────┘  └─────────────┘                              │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────┐
        │  remote NixOS VPS (AWS or GCP)  │
        │  ┌───────────────────────────┐  │
        │  │ /etc/nixos/               │  │
        │  │   configuration.nix       │  │
        │  │   hermes.nix (generated)  │  │
        │  │   secrets.enc.yaml        │  │
        │  └───────────────────────────┘  │
        │  ┌───────────────────────────┐  │
        │  │ systemd: hermes-agent.svc │  │
        │  └───────────────────────────┘  │
        └─────────────────────────────────┘
```

Five internal layers, each with one responsibility:

- **commands** — translate `argv` into command objects. Thin. Owns no state.
- **orchestrator** — knows what `up`, `update`, `destroy` etc. *mean* as
  sequences of phases. Owns the lifecycle state machine. Talks to the cloud
  abstraction and remote-ops layers; cloud-agnostic.
- **cloud abstraction (CP)** — the only place that knows AWS or GCP exists.
  Two implementations behind one interface. See §4.2.
- **project & state files** — TOML parsing, schema validation, global state
  file read/write, generation of `hermes.nix` from `hermes.toml`.
- **remote ops** — SSH session management, file transfer, running `sops` and
  `nixos-rebuild` on the remote box. Cloud-agnostic.

**ink ui** is a cross-cutting concern. The orchestrator emits typed events
(`PhaseStarted`, `PhaseProgress`, `PhaseFailed`, etc.) into an event sink. In
production the sink is an Ink renderer; in tests it is an in-memory recorder.
The orchestrator is fully testable without Ink.

### 4.2 The CloudProvider interface

This interface is the most consequential design decision in the project. With
both clouds shipping at v1, it must express *what* the orchestrator needs
without leaking *how* AWS or GCP do it. The danger of "design an abstraction
against two clouds in parallel before either ships" is a lowest-common-
denominator layer that loses information from both. The mitigation is the
**opaque ledger**: the interface models verbs, not resources.

```typescript
interface CloudProvider {
  readonly name: 'aws' | 'gcp';

  // Resolve the latest stable NixOS image for a given location. AWS:
  // DescribeImages filtered by NixOS owner ID. GCP: getFromFamily on the
  // nixos-cloud project. Cached locally for 1 hour.
  resolveNixosImage(loc: Location): Promise<ImageRef>;

  // Provision: VM + network rules + ssh key + public IP. Atomic from the
  // caller's POV — either returns a fully-formed Instance or rolls back
  // anything it created. Records resource IDs in `out` as it goes.
  provision(spec: ProvisionSpec, out: ResourceLedger): Promise<Instance>;

  // Apply network changes (open/close ports) on an existing instance,
  // without recreating it. Called by `update` when [network] changed.
  reconcileNetwork(ledger: ResourceLedger, rules: NetworkRules): Promise<void>;

  // Destroy: tear down everything in the ledger, idempotent, in dependency
  // order. Safe to re-run after partial failures.
  destroy(ledger: ResourceLedger): Promise<void>;

  // Status: is the instance running, what's its public IP, what's the
  // last-known healthcheck. Read-only.
  status(ledger: ResourceLedger): Promise<InstanceStatus>;
}
```

Key properties:

- **`ResourceLedger` is a JSON-serializable, provider-specific bag.** AWS
  records `{instance_id, security_group_id, key_pair_name, eip_allocation_id,
  region}`; GCP records `{instance_name, firewall_rule_name, project_id,
  external_ip}`. The orchestrator never reads the ledger's internal shape; it
  passes the right sub-tree (`ledger.aws` or `ledger.gcp`) to the right
  provider.
- **`provision()` is atomic from the caller's POV but not from the cloud's.**
  Each implementation runs its own internal sequence and writes to the ledger
  as it goes. If a step fails mid-sequence, the implementation calls its own
  `destroy(ledger)` to roll back what it has created so far, then throws. The
  orchestrator never observes a half-provisioned state.
- **No VPC creation in v1.** Both clouds have a default network in every
  region. We use it. This is the single biggest reason this abstraction is
  tractable: we model security groups / firewall rules on a default-network
  instance, not networking topology. Custom VPCs, if ever needed, get a
  *separate* interface — they are not bolted on.
- **`reconcileNetwork` is separate from `provision`** so `update` can change
  inbound port rules without recreating the instance.
- **No `ssh()` method.** SSH is cloud-agnostic — it just needs an IP and a
  private key. The remote-ops layer handles it. The CloudProvider's only job
  is to give the caller an `Instance` with a reachable IP.

### 4.3 Sequencing the GCP implementation under γ

Even though both clouds ship at v1, AWS is implemented first by a small
margin. The GCP implementation is written immediately after, *before v1
ships*, against the same `CloudProvider` interface. This means the abstraction
is shaped by AWS reality, then validated against GCP reality, then released.
That sequencing is structurally identical to "AWS-only release + zero-day-
delay GCP follow-up", which is the safest version of γ.

## 5. CLI command surface

| Command | Purpose | Reads | Writes |
|---|---|---|---|
| `hermes-deploy init` | Scaffold a new project directory. Writes a starter `hermes.toml`, an empty `SOUL.md`, an empty `secrets.enc.yaml`, a `.sops.yaml`, and a `.gitignore`. Generates the per-deployment age keypair and the per-deployment SSH keypair. | — | project files, age key, ssh key |
| `hermes-deploy up` | Provision (if new) or reconcile infra (if existing) and apply config to the box. Idempotent. | `hermes.toml`, secrets, global state | global state, remote box |
| `hermes-deploy update` | Push config-only changes (no infra changes). Faster than `up` because it skips most cloud API calls. | `hermes.toml`, secrets, global state | remote box, global state (config hash only) |
| `hermes-deploy destroy` | Tear down all cloud resources for this deployment. Removes the entry from global state. Leaves project files alone. Refuses without `--yes` or interactive confirmation. | global state | global state, cloud |
| `hermes-deploy status` | Show whether the box is running, its IP, last deploy timestamp, last applied config hash, healthcheck. Read-only. | global state, cloud, box | — |
| `hermes-deploy logs` | Stream `journalctl -u hermes-agent -f` from the box over SSH. Ink renders with syntax-aware coloring. Ctrl-C exits cleanly. | global state, box | — |
| `hermes-deploy ssh` | Open an interactive SSH session to the box using the per-deployment key. Just `exec`s `ssh` under the hood with the right `-i` and host. | global state | — |
| `hermes-deploy ls` | List all deployments across all clouds. Shows name, cloud, region, status, IP, last-deployed. Supports `--watch` for an Ink dashboard view that polls. | global state, cloud (for live status) | — |

### 5.1 Resolution rule (multi-instance UX)

Two flags every command supports:

- `--project <path>` — point at a project directory other than cwd. Default
  is to walk up from cwd looking for `hermes.toml`.
- `--name <name>` — operate on a specific named deployment from the global
  state, regardless of cwd. Mutually exclusive with `--project`.

Resolution order:

1. If `--name` is given, look it up in the global state file and use its
   recorded `project_path`.
2. Else if `--project` is given, use that path and read its `hermes.toml`
   `name` field.
3. Else walk up from cwd to find `hermes.toml`, read its `name` field.
4. If none of the above, fail with a clear error pointing at
   `hermes-deploy init` or `hermes-deploy ls`.

This means: from `~/clients/acme/discord-bot/` you can type `hermes-deploy up`
and it just works. From anywhere you can type `hermes-deploy logs
acme-discord` and it just works. Both code paths converge on the same
`(project_path, deployment_name)` tuple inside the orchestrator.

## 6. Project directory layout

Generated by `hermes-deploy init` and committed to git by the user. **This
directory is the deployment** — it can be cloned to a new machine, handed to a
coworker, or kept inside a client's repo.

```
acme-discord-bot/
├── hermes.toml             # cloud + sizing + hermes config
├── SOUL.md                 # personality (referenced from hermes.toml)
├── secrets.enc.yaml        # sops-nix encrypted, committable
├── .sops.yaml              # sops config: age recipients allowed to decrypt
├── configuration.nix.extra # OPTIONAL — Nix escape hatch
└── .gitignore              # generated; nothing excluded by default
```

### 6.1 `hermes.toml` schema (v1)

The schema is intentionally small. The Nix escape hatch handles everything
else.

```toml
# Required: unique name across the global state file.
name = "acme-discord-bot"

[cloud]
provider = "aws"            # "aws" | "gcp"
profile  = "acme"           # AWS profile name (provider=aws) OR
                            # GCP project id (provider=gcp); the CLI checks
                            # the right env var per provider.
region   = "eu-west-3"      # AWS region or GCP region
zone     = "eu-west-3a"     # GCP only; required when provider=gcp
size     = "small"          # "small" | "medium" | "large" — abstract
                            # sizes mapped to cloud-specific instance types.

[network]
ssh_allowed_from = "auto"   # "auto" = your current public IP, or CIDR
inbound_ports    = []       # opt-in additional inbound ports, e.g. [443]

[hermes]
model        = "anthropic/claude-sonnet-4-5"
soul         = "./SOUL.md"
secrets_file = "./secrets.enc.yaml"

[hermes.platforms.discord]
enabled    = true
token_key  = "discord_bot_token"   # key in secrets.enc.yaml

[hermes.platforms.telegram]
enabled    = false

[[hermes.mcp_servers]]
name     = "github"
command  = "npx"
args     = ["@modelcontextprotocol/server-github"]
env_keys = ["github_token"]        # keys in secrets → env vars

[hermes.nix_extra]
file = "./configuration.nix.extra"  # OPTIONAL escape hatch
```

### 6.2 Sizing abstraction

Abstract sizes map to cloud-specific instance types. Power users override via
the Nix escape hatch (or via `cloud.instance_type_override`, post-v1).

| Size | AWS | GCP | Approx. monthly cost |
|---|---|---|---|
| `small` | `t3.small` (2 vCPU, 2 GB) | `e2-small` (shared vCPU, 2 GB) | ~$15-18 |
| `medium` | `t3.medium` (2 vCPU, 4 GB) | `e2-medium` (shared vCPU, 4 GB) | ~$30-35 |
| `large` | `t3.large` (2 vCPU, 8 GB) | `e2-standard-2` (2 vCPU, 8 GB) | ~$60-70 |

GCP `e2-small` and `e2-medium` use shared-core CPUs that burst to 2 vCPU; the
RAM figure is the relevant capacity-planning number for hermes-agent
workloads, which are I/O-bound on LLM API calls rather than CPU-bound.

## 7. Global state file

`~/.config/hermes-deploy/state.toml`

```toml
schema_version = 1

[deployments.acme-discord-bot]
project_path     = "/Users/paul/clients/acme/discord-bot"
cloud            = "aws"
region           = "eu-west-3"
created_at       = "2026-04-09T14:23:11Z"
last_deployed_at = "2026-04-09T14:31:42Z"
last_config_hash = "sha256:abc123..."
ssh_key_path     = "/Users/paul/.config/hermes-deploy/ssh_keys/acme-discord-bot"
age_key_path     = "/Users/paul/.config/hermes-deploy/age_keys/acme-discord-bot"

  [deployments.acme-discord-bot.cloud_resources]
  # opaque to the orchestrator, owned by the AWS provider
  instance_id        = "i-0abc123..."
  security_group_id  = "sg-0def456..."
  key_pair_name      = "hermes-deploy-acme-discord-bot"
  eip_allocation_id  = "eipalloc-0ghi789..."
  region             = "eu-west-3"
```

### 7.1 Properties

- **Concurrency:** advisory file lock on `state.toml.lock` for any write. Two
  invocations on different deployments serialize cleanly. Acceptable: deploys
  are slow enough that the lock is not a bottleneck.
- **Schema migrations:** the `schema_version` field is checked on every read.
  Higher than the CLI knows → refuse with "upgrade hermes-deploy". Lower → run
  forward migrations in code before reading. v1 ships with version 1; the
  migration scaffold is exercised from day 1 via fixtures.
- **Backups:** the file is backed up to `state.toml.bak.<timestamp>` before
  every write. Last 5 backups retained.
- **Key material is not stored in the state file.** The state records the
  *paths* to the SSH key and age key under `~/.config/hermes-deploy/`. Keys
  are chmod 600.

## 8. Operational mechanics

### 8.1 Deploy flow — `hermes-deploy up` (first deploy)

**Phase 1 — local validation** *(no cloud calls yet)*

1. Resolve target deployment via the resolution rule from §5.1.
2. Parse `hermes.toml`. Validate against the Zod schema. Fail fast on missing
   fields with file:line:col errors.
3. Resolve referenced files: `SOUL.md` exists, `secrets_file` exists,
   `nix_extra.file` exists if specified.
4. Resolve cloud credentials: set `AWS_PROFILE` or `CLOUDSDK_CORE_PROJECT`,
   attempt a no-op identity call (e.g. `sts:GetCallerIdentity`). Fail with a
   clear error pointing at `aws configure --profile <x>` if absent.
5. Check the global state file. If an entry already exists *and* infra is
   reachable, branch into the update path (Phase 4). If an entry exists but
   infra is gone, warn and ask the user to clean state and re-provision.
6. Ensure per-deployment SSH key exists at
   `~/.config/hermes-deploy/ssh_keys/<name>`. Generate ed25519 if missing.
7. Ensure per-deployment age key exists at
   `~/.config/hermes-deploy/age_keys/<name>`. Generate if missing. Write the
   public key into the project's `.sops.yaml` recipients. If the recipients
   changed, run `sops updatekeys secrets.enc.yaml` so the encrypted file
   knows about the new recipient.

**Phase 2 — provision** *(cloud calls begin; Ink timeline starts rendering)*

8. Call `CloudProvider.resolveNixosImage(loc)`. Cache the result for 1 hour
   in `~/.cache/hermes-deploy/images.json`.
9. Call `CloudProvider.provision(spec, ledger)`. AWS internal sequence:
   - `ImportKeyPair` with the per-deployment public SSH key
   - `CreateSecurityGroup` named `hermes-deploy-<name>`, tagged
     `managed-by=hermes-deploy`, `deployment=<name>`
   - `AuthorizeSecurityGroupIngress` with rules from `[network]` (SSH from
     resolved-public-IP, plus any `inbound_ports`)
   - `RunInstances` with the resolved AMI, the size mapping, the SG, the
     keypair, in the default VPC's default subnet, tagged
   - `AllocateAddress`
   - `AssociateAddress`
   - Returns `Instance{ip, sshUser: 'root'}`

   GCP internal sequence (analogous):
   - Add per-deployment public SSH key to project metadata
   - `firewalls.insert` with rules from `[network]`, labeled with
     `managed-by=hermes-deploy`, `deployment=<name>`
   - `instances.insert` with the resolved family image, machine type, default
     network, the per-deployment SSH metadata, labeled
   - Reserve external static IP, attach

   On any failure mid-sequence, the implementation catches, calls
   `this.destroy(ledger)` to clean up, and re-throws. The ledger ends empty.
10. Persist the ledger to the global state file *now*, before SSH bootstrap.
    If the SSH bootstrap fails in Phase 3, the user can still
    `hermes-deploy destroy` to clean up.

**Phase 3 — wait for SSH**

11. Poll `<public-ip>:22` with backoff (1s, 2s, 4s, 8s, 8s, ...) up to
    3 minutes. NixOS community AMIs typically have sshd reachable within
    30-60 seconds of `RunInstances`. On timeout: fail with "instance is up
    but SSH didn't open in 3 minutes — `hermes-deploy ssh <name>` to
    investigate, `hermes-deploy destroy <name>` to clean up." Ledger is
    persisted; user can recover.

**Phase 4 — bootstrap NixOS configuration**

12. Open an SSH session via `ssh2` (Node lib, not shell-out — needed for
    streaming and clean error capture). Reuse this session for all of
    Phase 4.
13. Generate the NixOS files locally in a temp dir:
    - `configuration.nix` — top-level wrapper that imports the hermes-agent
      flake module and `./hermes.nix`. Pinned to a specific hermes-agent
      version via `flake.lock`.
    - `hermes.nix` — the generated module from `hermes.toml`. The CLI owns
      this file; users do not edit it. If `[hermes.nix_extra]` is set, its
      contents are imported and merged here.
    - `secrets.enc.yaml` — copied from the project dir as-is, still
      encrypted.
    - `age.key` — the age private key from
      `~/.config/hermes-deploy/age_keys/<name>`.
14. SCP the four files to the box:
    - `/etc/nixos/configuration.nix`
    - `/etc/nixos/hermes.nix`
    - `/etc/nixos/secrets.enc.yaml`
    - `/var/lib/sops-nix/age.key` (chmod 600, owned by root)

    **Why SSH and not cloud-init user-data:** AWS user-data is readable from
    inside the instance via the metadata service. Putting the age private key
    in user-data would leak it to anything that can reach IMDS, including
    misconfigured agents. SSH is the secure path.
15. Run `nixos-rebuild switch` over SSH. Stream stdout/stderr into the Ink
    timeline as a live sub-view. This step:
    - Downloads hermes-agent and dependencies from `cache.nixos.org`. This is
      the slow part on first deploy: 3-8 minutes on a small instance.
    - Builds/symlinks everything into `/nix/store`.
    - Activates the new generation.
    - sops-nix decrypts `secrets.enc.yaml` at activation and exposes values
      at `/run/secrets/<key>`.
    - Starts the `hermes-agent.service` systemd unit.
16. If `nixos-rebuild` exits non-zero: stop, show the captured tail of the
    build log, leave the box in its previous state (NixOS rolls back to the
    previous generation automatically). State `last_config_hash` is *not*
    updated; `update` will retry.

**Phase 5 — healthcheck and state update**

17. Update global state regardless of healthcheck outcome below: write
    `last_deployed_at`, `last_config_hash` (sha256 of hermes.toml + sops
    file + nix_extra), and `instance_ip`. The new config was successfully
    *applied* by `nixos-rebuild` in Phase 4 — that fact is what
    `last_config_hash` records, independent of whether the resulting service
    is healthy. This is what makes a subsequent `update` correctly
    short-circuit instead of re-applying the same config in a debug loop.
18. SSH `systemctl is-active hermes-agent.service`. Poll for up to 60s.
19. **If active:** fetch `systemctl status hermes-agent.service`, write
    `health = "healthy"` into state, render the success summary in the Ink
    UI (deployment name, public IP, SSH command, logs command, total elapsed
    time), and exit 0.
20. **If never active within 60s:** write `health = "unhealthy"` into state,
    fetch the last 50 lines from `journalctl -u hermes-agent`, render them
    in the Ink UI with a "deployment applied but service is unhealthy"
    error, point the user at `hermes-deploy logs <name>` for live tail, and
    exit non-zero.

### 8.2 Update flow — `hermes-deploy update`

Same as Phase 1 + Phase 4 + Phase 5, with two differences:

- **Skip provisioning entirely.** No cloud calls except a `DescribeInstances`
  / `compute.instances.get` to confirm the box still exists and grab the
  current public IP (in case of changes).
- **Network rule reconciliation.** Compare `inbound_ports` and
  `ssh_allowed_from` between the new TOML and the last-deployed snapshot
  stored alongside `last_config_hash`. If they differ, call
  `CloudProvider.reconcileNetwork(ledger, newRules)` to add/remove rules in
  place. This runs *before* the SSH bootstrap.

Then SCP the new generated files, run `nixos-rebuild switch`, healthcheck,
update state. Typical update time: 30-90 seconds.

**Idempotency property:** running `update` with no local changes is a
~5-second no-op (SSH connect + remote hash compare + early return). The CLI
checks `last_config_hash` first and short-circuits before opening SSH if
nothing changed.

### 8.3 Secrets flow — sops-nix age keypair lifecycle

**On `init`:**

1. Generate per-deployment age keypair via `age-keygen` (shell out — no good
   native lib).
2. Write private key to `~/.config/hermes-deploy/age_keys/<name>` (chmod 600).
3. Write public key into the project's `.sops.yaml`:
   ```yaml
   creation_rules:
     - path_regex: secrets\.enc\.yaml$
       age: age1abc...
   ```
4. Initialize an empty `secrets.enc.yaml` encrypted to that recipient.

**On `hermes-deploy secret set <key> <value>`** (and `secret get`,
`secret rm`, `secret edit`):

The CLI shells to `sops` with `SOPS_AGE_KEY_FILE` pointing at the local age
key. Sops handles the encrypt/decrypt round-trip. This is a thin ergonomic
wrapper; power users can shell to sops directly with
`SOPS_AGE_KEY_FILE=$(hermes-deploy key path) sops secrets.enc.yaml`.

**On `up` / `update`:**

- The encrypted `secrets.enc.yaml` is SCP'd to the box as-is.
- The age private key is SCP'd to `/var/lib/sops-nix/age.key`.
- The hermes-agent NixOS module declares which secrets it needs; sops-nix
  decrypts them at activation and exposes them as `/run/secrets/<key>` files
  (on tmpfs). Hermes reads them from there.
- Secret values are *never logged*, *never printed in the Ink UI*, *never
  written to state files*. The only on-disk plaintext is in tmpfs
  `/run/secrets` on the box.

**Multi-machine usage** (one user, multiple machines):

v1 ships a manual key-sync model. To use a deployment from a second machine,
the user copies `~/.config/hermes-deploy/age_keys/<name>` from machine A to
machine B at the same path. The CLI provides `hermes-deploy key export` and
`hermes-deploy key import` as thin wrappers. A trust-extension model (machine
B generates its own key, machine A signs B's key in via `sops updatekeys`) is
post-v1.

**Lost age key recovery:**

The CLI detects on `up` that an age key was generated but is no longer
present, and offers `hermes-deploy secret reset`: generates a fresh keypair,
rewrites `.sops.yaml`, clears `secrets.enc.yaml` so the user re-populates.
The box's old `/var/lib/sops-nix/age.key` is overwritten on the next `up`.

## 9. Failure modes & rollback

| Failure | When | Recovery |
|---|---|---|
| Invalid `hermes.toml` (schema) | Phase 1 | Fail with file:line:col + the schema rule that broke. No cloud calls. |
| Cloud creds missing/wrong | Phase 1 | Fail with "no AWS profile named `acme` — try `aws configure --profile acme`". No partial state. |
| Quota exceeded mid-provision | Phase 2 | `provision()` catches, calls `this.destroy(ledger)`, throws. Ledger ends empty; state file is *not* persisted. Show user the cloud quotas console URL. |
| Capacity error (`InsufficientInstanceCapacity`) | Phase 2 | Same rollback path. Suggest a different size or AZ in the error message. |
| Resource name collision (e.g. SG already exists from a previous failed run) | Phase 2 | Detect via SDK error. Reuse if it has our `managed-by=hermes-deploy` + `deployment=<name>` tags; otherwise refuse and ask the user to clean up manually. **The tag check is the safety: we never touch resources that don't carry our markers.** |
| Network blip during a single SDK call | Phase 2 | SDK built-in retries with exponential backoff. After that: rollback. |
| Instance launches but SSH never comes up | Phase 3 | 3-minute timeout. Ledger is *already persisted*. CLI exits non-zero with recovery instructions. The user chooses whether to investigate or destroy. |
| `nixos-rebuild` fails on the box | Phase 4 | NixOS keeps the previous generation active. State `last_config_hash` is *not* updated. CLI exits non-zero, prints captured build log tail. User fixes config, runs `update`. |
| `hermes-agent.service` enters a crash loop | Phase 5 | Healthcheck fails after 60s. CLI prints last 50 lines from `journalctl -u hermes-agent`. State `last_config_hash` is updated (the deployment *succeeded* in the sense that nixos-rebuild applied) but `health = "unhealthy"` is recorded. User can `logs`, fix, `update`. |
| Box unreachable mid-`update` | Update Phase 4 | SSH timeout. Exit non-zero. State unchanged. Previous good config is still on the box. Retry `update` once the box is back. |
| State file corrupted | Any command | Schema validation on every read. If validation fails, refuse to proceed and point at `state.toml.bak.<timestamp>`. |
| Concurrent CLI invocations | Any state-mutating command | Advisory `flock`. Second invocation waits up to 30s, then errors. |
| `destroy` against already-deleted resources | `destroy` | Idempotent: each cleanup step swallows "resource not found". State entry removed regardless. Warn the user. |
| User loses their age key | Any time | `secret reset` (§8.3). |
| User loses entire `~/.config/hermes-deploy` | Any time | Project files exist; cloud resources exist; state is gone. Recovery: `hermes-deploy adopt` (post-v1) re-creates the state entry from cloud-side IDs, then `secret reset`. v1 documents the manual recovery. |

**The rollback principle:** any operation that creates cloud resources is
*either* fully successful (resources exist, ledger persisted) *or* fully
rolled back (no resources, no ledger). The one exception is "instance is up
but SSH didn't open" — there we deliberately persist the ledger and ask the
user. This is a *data preservation* call: forcibly tearing down a working
instance because SSH was slow is worse than asking the user to investigate.

## 10. Testing strategy

**Unit tests** (fast, deterministic, the bulk of the suite):

- TOML schema validation (Zod parsing, every error path).
- Nix file generation: snapshot tests. Given `examples/acme.toml` → expect a
  checked-in `hermes.nix` snapshot file.
- State file read/write/migrations. Migration runner exercised from day 1
  with synthetic v0 → v1 fixtures even though v1 is the only schema today.
- The `CloudProvider` interface contract: a shared "must satisfy" test suite
  that both `cloud-aws` and `cloud-gcp` implementations run against a mock
  SDK. Catches drift between providers.
- Resolution rule for `--name` / `--project` / cwd-walk: cover all four
  cases.

**Integration tests** (slower, mock the cloud at the SDK boundary):

- `cloud-aws` against `aws-sdk-client-mock`. Full coverage of `provision` /
  `destroy` / `reconcileNetwork` / `status`. Rollback paths tested by
  injecting failures at each step in the sequence.
- `cloud-gcp` against `nock` intercepting the underlying HTTP. Same coverage.
- *Optional:* remote-ops layer against a local NixOS VM in qemu (fixture
  image, ~200 MB). Tests SCP, `nixos-rebuild`, healthcheck, sops decryption
  against a real NixOS box without touching a cloud.

**E2E tests** (slowest, hit real AWS and GCP):

- One full deploy → update → destroy cycle on AWS, one on GCP. Tiny instance
  sizes, in cheap regions. Tagged with `e2e-test-<commit-sha>` for cleanup.
- Run on every PR via GitHub Actions, gated behind cloud creds in repo
  secrets. **E2E only runs on PRs from maintainers**; community PRs run unit
  + integration only. The cost of an open OSS project running paid cloud
  tests on every drive-by PR is prohibitive.
- Cleanup safety net: a scheduled GitHub Action runs nightly and tears down
  any tagged-as-test resources older than 4 hours.

**Coverage goals:** 85%+ on the orchestrator and schema layers; 60%+ on the
cloud providers (rollback edge cases are the long tail). No coverage
requirement on Ink UI components.

## 11. Repository structure

Single package, internal directory structure mirroring the workspace
boundaries we'd want if this ever splits into a monorepo. Ship simple,
refactor when needed.

```
hermes-deploy/
├── src/
│   ├── cli.ts                  # bin entry, argv router
│   ├── commands/               # one file per command
│   ├── orchestrator/           # lifecycle state machine
│   ├── schema/                 # zod schemas for hermes.toml + state.toml
│   ├── nix-gen/                # toml → hermes.nix templates
│   ├── state/                  # global state read/write, locking, migrations
│   ├── cloud/
│   │   ├── core.ts             # CloudProvider interface, ResourceLedger
│   │   ├── aws/                # AWS implementation
│   │   └── gcp/                # GCP implementation
│   ├── remote-ops/             # SSH, SCP, sops/nix wrappers
│   ├── ui/                     # ink components
│   └── errors/                 # typed error classes used across layers
├── templates/                  # nix file templates
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/                    # live cloud, gated
│   └── fixtures/
├── examples/                   # sample hermes.toml + SOUL.md projects
├── docs/
│   ├── getting-started.md
│   ├── schema-reference.md
│   ├── multi-machine-key-sync.md
│   ├── recovery-from-lost-state.md
│   ├── specs/                  # this document and future design docs
│   └── contributing.md
├── .github/
│   └── workflows/              # lint, unit, integration, gated e2e, release
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
```

**Why single package, not monorepo:** workspaces, build orchestration, and
version coupling are overhead that does not pay back until there are multiple
consumers of `cloud-aws` outside this project. v1 has one consumer (the CLI).
The directory boundary inside `src/cloud/{aws,gcp}` is enforced by an ESLint
`no-restricted-imports` rule from day 1, so the day we *do* want to split, it
is a `git mv` per directory rather than a re-architecture.

## 12. Distribution & licensing

**Primary distribution:** npm, as `@hermes-deploy/cli`.

```
npm i -g @hermes-deploy/cli
pnpm add -g @hermes-deploy/cli
npx @hermes-deploy/cli init
```

**Supplementary:** GitHub Releases artifacts include single-file binaries
built with `bun build --compile` for `darwin-arm64`, `darwin-x64`,
`linux-x64`, `linux-arm64`. For users who do not want Node installed.

**Future:** Homebrew formula (post-v1). Nix package (post-v1, ironic but
obvious — the tool that deploys hermes-agent should itself be installable
via `nix profile install`).

**Versioning:** semver from day 1. `0.x` until the schema and CLI surface
stabilize. Bumping to `1.0` once one breaking change has shipped cleanly with
migrations. Schema migration scaffolding is in place from day 1.

**Release process:** `release-please` GitHub Action. Conventional commits.
Manual approval to publish.

**Telemetry:** none in v1. No anonymous usage stats, no opt-out — none.
Optional opt-in crash reporting (off by default, gated by an env var) is a
post-v1 consideration; the destination endpoint and provider are deferred
until that decision is actually on the table.

**License:** Apache 2.0. Reasoning: dominant license for modern OSS infra
tools (Terraform, Pulumi, kubectl, fly CLI), explicit patent grant matters
for enterprise/client adoption, GPL-compatible, preserves downstream options.
MIT would also be acceptable.

## 13. Out-of-scope items revisited

These are deliberate cuts from §2 (non-goals), listed here so they do not
get re-litigated during implementation. Each has a "what would change my mind"
trigger.

| Item | Why cut for v1 | What would unblock it |
|---|---|---|
| Custom VPCs / private-only networking | Modeling networking topology breaks the "verbs not resources" abstraction | A specific client requiring private-only deployment before v1.1 |
| SSM / IAP-based SSH | Per-cloud plumbing, IAM role attachment, different `ssh` command path | Compliance requirement that disallows public SSH |
| Pre-baked Packer images | Maintenance burden of a CI pipeline that publishes per-region per-release | First-deploy latency becomes a documented user complaint |
| Cloud Secret Manager integration | sops-nix already covers the secret-storage need cloud-agnostically | A client whose policy mandates a managed secret store |
| CLI-managed cred store | Reimplementing AWS SSO, MFA, role assumption is hard and error-prone | Real user feedback that "I don't have aws CLI installed" is a recurring blocker |
| Pulumi / Terraform under the hood | Both add a runtime dep that hurts the OSS install story | The per-deployment resource graph grows beyond ~10 resources |
| Web dashboard | Out of scope for a CLI | Never; if a dashboard is wanted, build it as a separate project consuming the same state file |
| Multi-region failover, blue/green, snapshots | Single-instance v1 | A client whose SLO requires it |
| Trust-extension multi-machine key sync | Manual copy is sufficient for 1-3 machines, 1 person | Multi-user teams sharing deployments |
| `hermes-deploy adopt` (lost state recovery) | Documented manual recovery is sufficient for v1 | First user actually loses state in production |
| Plugin system for new clouds (Hetzner, Linode, etc.) | Two clouds via a written-in-tree interface; no dynamic loading | Demand from at least three external contributors, each willing to maintain a provider |
| Cost projection / billing alerts | Static "approx monthly cost" in README is enough | Users start asking how much they're spending |
| Dynamic provider lazy-loading | Bundle both, optimize later if startup time becomes a problem | Cold-start time exceeds 200 ms |

## 14. Open risks

- **NixOS community AMI / GCE image availability per region.** v1 assumes
  the NixOS release team publishes images for every region we care about. If
  a target region has no current image, users get a clear error. *Mitigation:*
  document the supported regions in the README; revisit Packer (option B from
  the image-source decision) if this becomes a blocker.
- **First-deploy latency (3-8 min).** This is a real user-visible cost. The
  Ink timeline UI mitigates the *perception*, not the latency. If users
  consistently complain, the unblocking trigger for Packer is hit.
- **The CloudProvider abstraction has been validated against AWS reality
  during design but not against GCP reality yet.** Implementing GCP may
  surface interface gaps. *Mitigation:* implement AWS first by hours (not
  days), then GCP, both before v1 ships, with the freedom to iterate the
  interface if the GCP implementation reveals shortcomings.
- **Multi-machine age key sync is manual in v1.** Acceptable for a single
  user with 1-3 machines, awkward for any team. Triggers the trust-extension
  feature post-v1.
- **The "no custom VPCs" cut may exclude paying clients with security
  requirements.** This is the most likely v1.x escape valve. Spec says no in
  v1 to keep the abstraction tractable; if a paying client's requirements
  contradict this before v1.1 is feasible, the cut needs to move into v1.
