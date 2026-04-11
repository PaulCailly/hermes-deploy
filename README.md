# hermes-deploy

A CLI for deploying [hermes-agent](https://hermes-agent.nousresearch.com/) to a cloud VPS in one command.

> **Status: 1.0.0.** AWS and GCP both ship as first-class providers with
> full lifecycle parity. The CLI surface, the `hermes.toml` schema, and
> the state-file format are stable and follow semver from this release on.
> See [CHANGELOG.md](./CHANGELOG.md) for what landed.

## Quick links

- **[Getting started](docs/getting-started.md)** — five-minute walkthrough from `init` to a running agent
- **[hermes.toml schema reference](docs/schema-reference.md)** — every field, every default
- **[Multi-machine key sync](docs/multi-machine-key-sync.md)** — moving a deployment between machines
- **[v1 design spec](docs/specs/2026-04-09-hermes-deploy-design.md)** — the architectural decisions
- **[CHANGELOG](./CHANGELOG.md)** — release history

## Prerequisites

On the machine running `hermes-deploy`:

- Node 20 or newer
- `age-keygen` and `sops` on PATH (`brew install age sops` on macOS)
- `ssh` and `ssh-keygen` on PATH (ships with macOS / standard on Linux)
- For AWS deployments: AWS credentials (`~/.aws/credentials` or `AWS_*` env vars)
- For GCP deployments: Application Default Credentials (`gcloud auth application-default login`)

On the AWS account (if using AWS):

- An IAM user/role with permissions to create EC2 key pairs, security groups, instances, and elastic IPs
- A region where NixOS publishes community AMIs (e.g. `us-east-1`, `eu-west-3`, `ap-southeast-1`)

On the GCP project (if using GCP):

- The Compute Engine API enabled
- A service account or user with Compute Admin (or equivalent) role
- A region/zone with the `nixos-cloud` image family available

## Install

```bash
npm install -g @hermes-deploy/cli
# or
pnpm add -g @hermes-deploy/cli
# or, one-shot:
npx @hermes-deploy/cli init
```

To install from source:

```bash
git clone git@github.com:PaulCailly/hermes-deploy.git
cd hermes-deploy
npm install
npm run build
npm link  # makes `hermes-deploy` available globally
```

## Commands at a glance

```bash
hermes-deploy init                                # scaffold a new project here
hermes-deploy up                                  # provision + configure + start
hermes-deploy update                              # push config changes to existing instance
hermes-deploy status [name]                       # show stored + live state
hermes-deploy logs [name]                         # stream journalctl until Ctrl-C
hermes-deploy ssh [name]                          # interactive shell on the box
hermes-deploy ls                                  # list all deployments across clouds
hermes-deploy destroy [name] --yes                # tear down completely
hermes-deploy adopt --name <name>                 # rebuild lost state from cloud-side tags

hermes-deploy secret set <key> <value>            # add a secret
hermes-deploy secret get <key>                    # print a secret
hermes-deploy secret list                         # list secret keys
hermes-deploy secret rm <key>                     # delete a secret
hermes-deploy secret edit                         # open the sops editor

hermes-deploy key export <name>                   # write age key to stdout
hermes-deploy key import <name> <path>            # copy an age key into config
hermes-deploy key path <name>                     # print the on-disk path
```

Every command that operates on a deployment supports `--name <name>` and `--project <path>` flags. Without either flag, the command walks up from cwd to find a `hermes.toml`.

### Scripting and JSON output

Read-only commands (`status`, `ls`, `secret list`, `key path`, `adopt`) support `--json` to emit a machine-readable payload on stdout instead of human-formatted text. Example:

```bash
hermes-deploy status acme-discord --json | jq -r .live.state
hermes-deploy ls --json | jq '.[] | select(.storedHealth == "healthy") | .name'
```

### Library import

The package also exposes a library entry point for programmatic use — useful when building higher-level tools on top of `hermes-deploy` (e.g. a managed-service control plane):

```typescript
import {
  createCloudProvider,
  runDeploy,
  StateStore,
  getStatePaths,
  adoptDeployment,
} from '@hermes-deploy/cli';
```

The library surface follows the same semver contract as the CLI.

## Five-minute walkthrough

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

See [docs/getting-started.md](docs/getting-started.md) for a longer version with explanations.

## Ink UI

`hermes-deploy up` and `hermes-deploy update` automatically render a live timeline view (phase rows with spinners + tail of `nixos-rebuild` output) when stdout is a TTY. Pipes, redirects, and CI runs get a plain stdout reporter. Force the plain reporter with `--no-ink` or `HERMES_DEPLOY_NO_INK=1`.

## Cachix substituter (optional, for faster first deploys)

The first deploy compiles hermes-agent's Python closure from source — about 10-15 minutes on a `t3.large`. To skip the build, point at a Cachix cache:

```toml
[hermes.cachix]
name       = "your-cache-name"
public_key = "your-cache-name.cachix.org-1:xxxxx"
```

Once the cache is populated (run `cachix push <name> /run/current-system` from the box after a successful first deploy), subsequent first-deploys substitute the closure instead of building it. See [docs/getting-started.md](docs/getting-started.md#optional-cachix) for the full setup.

## State and key file locations

- `~/.config/hermes-deploy/state.toml` — global state (one entry per deployment)
- `~/.config/hermes-deploy/ssh_keys/<name>` — per-deployment SSH private key
- `~/.config/hermes-deploy/age_keys/<name>` — per-deployment age private key
- `~/.cache/hermes-deploy/images.json` — 1-hour AMI lookup cache

## What's deferred to post-1.0

- **`hermes-deploy ls --watch` dashboard**
- **Pre-baked AMI / GCE image pipeline** for sub-2-minute first deploys
- **Automated Cachix population workflow** (right now you populate the cache by hand)
- **Custom VPCs, private-only networking, SSM/IAP-based SSH**

See [docs/specs/2026-04-09-hermes-deploy-design.md](docs/specs/2026-04-09-hermes-deploy-design.md) §13 for the rationale on each cut.

## License

[Apache 2.0](./LICENSE).
