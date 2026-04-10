# hermes-deploy

A CLI for deploying [hermes-agent](https://hermes-agent.nousresearch.com/) to a cloud VPS in one command.

> **Status: M3 (schema redesign).** AWS-only, full lifecycle, with the
> hermes.toml schema now properly mapping to upstream's services.hermes-agent
> options. config.yaml lives next to hermes.toml and is uploaded verbatim;
> secrets are dotenv-encoded sops files. M4 brings GCP.

## Quick links

- **[Getting started](docs/getting-started.md)** — five-minute walkthrough from `init` to a running agent
- **[hermes.toml schema reference](docs/schema-reference.md)** — every field, every default
- **[Multi-machine key sync](docs/multi-machine-key-sync.md)** — moving a deployment between machines
- **[v1 design spec](docs/specs/2026-04-09-hermes-deploy-design.md)** — the architectural decisions
- **[M1 plan](docs/plans/2026-04-09-hermes-deploy-M1-aws-skateboard.md)** and **[M2 plan](docs/plans/2026-04-09-hermes-deploy-M2-aws-feature-complete.md)** — implementation breakdowns

## Prerequisites

On the machine running `hermes-deploy`:

- Node 20 or newer
- `age-keygen` and `sops` on PATH (`brew install age sops` on macOS)
- `ssh` and `ssh-keygen` on PATH (ships with macOS / standard on Linux)
- AWS credentials configured (`~/.aws/credentials` or `AWS_*` env vars)

On the AWS account:

- An IAM user/role with permissions to create EC2 key pairs, security groups, instances, and elastic IPs
- A region where NixOS publishes community AMIs (e.g. `us-east-1`, `eu-west-3`, `ap-southeast-1`)

## Install (from source for now)

```bash
git clone git@github.com:PaulCailly/hermes-deploy.git
cd hermes-deploy
npm install
npm run build
npm link  # makes `hermes-deploy` available globally
```

A proper npm release lands in M4.

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

## What's deferred to M4+

- **GCP provider implementation**
- **Pre-baked AMI pipeline** for sub-2-minute first deploys
- **Cachix population workflow** (right now you populate the cache by hand)
- **`hermes-deploy ls --watch` dashboard**
- **Network-only-update optimization** (skip nixos-rebuild when only network config changed)
- **GitHub Actions CI / release-please / npm publish**

## License

Apache 2.0.
