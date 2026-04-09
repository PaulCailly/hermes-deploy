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
