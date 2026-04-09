# Migrating from M1/M2 to M3

The M3 schema redesign is a breaking change. Pre-production project — there's no automatic migration tool because the user count for v1 is one (Paul, with smoke-test deployments). The procedure below takes ~5 minutes per project.

## What changed

- `hermes.toml` schema rewritten:
  - Dropped: `[hermes].model`, `[hermes].soul`, `[hermes.platforms.discord]`, `[hermes.platforms.telegram]`, `[[hermes.mcp_servers]]`
  - Added: `[hermes].config_file`, `[hermes].secrets_file` (renamed from M1/M2), `[hermes.documents]`, `[hermes.environment]`
  - Renamed: `[hermes.nix_extra].file` → flat `nix_extra` string
- Secrets file: `secrets.enc.yaml` → `secrets.env.enc` (now sops-encrypted dotenv format instead of YAML)
- New file required: `config.yaml` next to `hermes.toml` (the user's hermes-agent runtime config)
- State file `schema_version` bumped from `1` to `2`. Existing v1 state files are auto-migrated by the runner — no action needed.

## Migration procedure

Per project:

1. **Tear down the existing deployment.**

   ```bash
   cd ~/clients/acme/discord-bot     # or wherever the project lives
   hermes-deploy destroy <name> --yes
   ```

2. **Remove the old M1/M2 user files.**

   ```bash
   rm -f hermes.toml secrets.enc.yaml .sops.yaml SOUL.md
   ```

   Keep any `*.md` files you don't want hermes-deploy to manage. Remove `SOUL.md` if you want `init` to scaffold a new starter version (you can keep your old content if you copy it back in after init).

3. **Re-init.**

   ```bash
   hermes-deploy init
   ```

   This produces the new file set: `hermes.toml`, `config.yaml`, `SOUL.md`, `.sops.yaml`, `secrets.env.enc`, `.gitignore`.

4. **Provide a config.yaml.** Either:

   - Copy from your local hermes install: `cp ~/.hermes/config.yaml ./config.yaml`
   - Edit the starter template that `init` generated

   The config.yaml is hermes-agent's runtime config. It controls model selection, agent behavior, terminal/browser/messaging integrations, MCP servers, etc. Inside it, you reference secrets via `${ENV_VAR}` syntax — e.g. `model.api_key: ${ANTHROPIC_API_KEY}`.

5. **Re-add secrets.**

   ```bash
   hermes-deploy secret set ANTHROPIC_API_KEY sk-...
   hermes-deploy secret set DISCORD_BOT_TOKEN MTI...
   # repeat for every secret your config.yaml references
   ```

6. **Deploy.**

   ```bash
   hermes-deploy up
   ```

After the first successful `up`, the workflow is the same as M2: edit `config.yaml` or `hermes.toml`, run `hermes-deploy update`, watch the changes propagate.

## What you shouldn't do

- Don't try to keep the old `secrets.enc.yaml` — it's YAML, M3 expects dotenv. Re-create from scratch with `secret set`.
- Don't manually edit `~/.config/hermes-deploy/state.toml`. The state migration runner handles the v1 → v2 bump automatically.
- Don't put secrets directly in `config.yaml` (defeats the point of the sops pipeline). Use `${VAR}` references and `secret set`.
- Don't put SOUL.md content into nix_extra — use `[hermes.documents]` instead. nix_extra is the escape hatch for things the schema can't express, not for files the schema already has fields for.
