# Getting started with hermes-deploy

A five-minute walkthrough from "I have nothing" to "my hermes-agent is running on AWS." Assumes you've installed `hermes-deploy` per the [README](../README.md#install-from-source-for-now).

## 1. Prerequisites checklist

Run these once per machine:

```bash
brew install age sops             # macOS; on Linux use your package manager
aws configure                     # set up AWS credentials in ~/.aws/credentials
node --version                    # must be 20 or newer
hermes-deploy --version           # confirms the CLI is on PATH
```

You'll also need an IAM user (or role) with permissions to create EC2 key pairs, security groups, instances, and elastic IPs in your chosen region.

## 2. Scaffold a project

```bash
mkdir -p ~/clients/acme/discord-bot
cd ~/clients/acme/discord-bot
hermes-deploy init
```

This writes six files:

- `hermes.toml` — your deployment config (cloud, region, size, file pointers)
- `config.yaml` — hermes-agent's runtime config (model, integrations, MCP servers, etc.)
- `SOUL.md` — your agent's personality, read by hermes-agent at startup
- `.sops.yaml` — tells sops which age key to use for this project
- `secrets.env.enc` — sops-encrypted dotenv file; starts empty
- `.gitignore` — excludes hermes-deploy state files from git

The deployment name defaults to a sanitized version of your directory basename (`discord-bot` here). Override with `hermes-deploy init --name my-actual-name` if you want something different.

## 3. Edit `hermes.toml`

Open it in your editor. The defaults are usable as-is for a smoke test, but at minimum verify:

- `[cloud] region` — pick a region near your users (default: `eu-west-3`)
- `[cloud] size` — `large` is recommended for the first deploy (the build needs ~6 GB RAM); `medium` or `small` work for subsequent updates if you want to save cost
- `[hermes] config_file` — path to your config.yaml (default: `"./config.yaml"`)
- `[hermes] secrets_file` — path to your encrypted secrets (default: `"./secrets.env.enc"`)

## 4. Edit `config.yaml`

`config.yaml` is hermes-agent's runtime config. It controls model selection, agent behavior, terminal/browser/messaging integrations, MCP servers, and more. The file is uploaded verbatim to the box and pointed at by `services.hermes-agent.configFile` in the generated NixOS module.

If you already run hermes locally, the obvious starting point is:

```bash
cp ~/.hermes/config.yaml ./config.yaml
```

Inside `config.yaml` you can reference secrets via `${VAR}` syntax — for example:

```yaml
model:
  api_key: ${ANTHROPIC_API_KEY}
```

The `${VAR}` references are resolved at agent startup from the agent's environment, which includes everything in your `secrets.env.enc` file. See the "Set secrets" section below for how that chain works.

## 5. Edit `SOUL.md`

Replace the placeholder with your agent's actual personality and operating instructions. This is the file hermes reads at startup to decide who it is.

## 6. Set secrets

```bash
hermes-deploy secret set ANTHROPIC_API_KEY sk-...
hermes-deploy secret set DISCORD_BOT_TOKEN MTI...
# repeat for every secret your config.yaml references
```

Each `secret set` call writes a `KEY=value` line into `secrets.env.enc` — a sops-encrypted dotenv file. The values never appear in plaintext on disk after the initial write.

**How secrets reach the agent:**

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

## 7. Deploy

```bash
hermes-deploy up
```

You'll see a live timeline of phases:

```
✓ Validating project configuration
✓ Preparing SSH and age keys
◐ Provisioning cloud resources
○ Waiting for SSH
○ Uploading config and running nixos-rebuild
○ Waiting for hermes-agent.service
```

The bootstrap phase takes 10-15 minutes the first time (compiling hermes-agent's Python closure from source). Subsequent deploys to fresh instances of the same hermes-agent revision will hit the same delay unless you set up a [Cachix cache](#optional-cachix). Updates against an existing instance are much faster (30-90 seconds) because the rebuild is incremental.

## 8. Watch it run

```bash
hermes-deploy logs                    # streams journalctl until Ctrl-C
hermes-deploy status                  # snapshot of stored + live state
hermes-deploy ssh                     # drop into a shell on the box
```

## 9. Iterate

Edit `config.yaml` or `hermes.toml`, then:

```bash
hermes-deploy update
```

The update flow re-evaluates your config, computes a content hash, and either short-circuits (if nothing changed) or pushes the new config to the existing instance via `nixos-rebuild switch`. No reprovisioning, no SSH key rotation — your instance keeps its IP and state.

Changes to `config.yaml` propagate fully: the file is uploaded and sops-nix re-decrypts `secrets.env.enc`, so if you also ran `secret set` to update a key, the agent's next startup sees the new value. No instance replacement needed.

## 10. Tear down

```bash
hermes-deploy destroy --yes
```

This removes the instance, security group, key pair, elastic IP, the per-deployment SSH and age keys under `~/.config/hermes-deploy/`, and the project's `.sops.yaml` + `secrets.env.enc`. The next `hermes-deploy up` from the same project directory starts from a clean slate.

## Optional: Cachix

The first deploy compiles hermes-agent's Python closure from source (~10-15 min on `t3.large`). To skip the build on subsequent first-deploys of the same hermes-agent revision:

1. Sign up for [Cachix](https://app.cachix.org/) (free for OSS, $30/mo for private)
2. Create a cache (e.g. `acme-deploys`)
3. Copy the public key from the cache settings page
4. Add this block to `hermes.toml`:

   ```toml
   [hermes.cachix]
   name       = "acme-deploys"
   public_key = "acme-deploys.cachix.org-1:xxxxx..."
   ```

5. Run `hermes-deploy up` once to populate the cache (the box compiles + uploads):

   ```bash
   hermes-deploy ssh
   # on the box:
   cachix authtoken <write-token>
   cachix push acme-deploys /run/current-system
   ```

6. Subsequent first-deploys substitute the closure from cache instead of building it.

A proper push automation lands in M4.

## Multiple deployments

Each project directory is one deployment. To manage multiple:

```bash
mkdir -p ~/clients/beta/telegram-bot && cd ~/clients/beta/telegram-bot
hermes-deploy init --name beta-telegram
$EDITOR hermes.toml
$EDITOR config.yaml
hermes-deploy up

# from anywhere:
hermes-deploy ls                     # see all deployments
hermes-deploy status acme-discord    # by name
hermes-deploy logs beta-telegram     # by name
```

The `--name` flag works on every command and looks up the project path from the global state file at `~/.config/hermes-deploy/state.toml`.

## Going to a different machine

See [multi-machine-key-sync.md](multi-machine-key-sync.md).
