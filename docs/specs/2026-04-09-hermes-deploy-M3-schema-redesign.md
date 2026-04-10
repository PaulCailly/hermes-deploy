# hermes-deploy M3 — Schema Redesign Design

## Goal

Replace the M1/M2 `hermes.toml` schema with one that maps cleanly to upstream's actual `services.hermes-agent.*` option surface. After M3, every field in `hermes.toml` reaches the running agent. The `update` command becomes genuinely useful for iteration. AWS deployments do real work (real API keys, real Discord/Telegram tokens, real MCP servers, real personality docs) instead of starting empty and logging "no platforms configured."

This is a breaking schema change. Pre-production project — no v1 deployments to preserve. Existing smoke-test projects re-`init` from scratch.

## Why M3 exists

The M1 brainstorm produced a `hermes.toml` schema that was *imagined* — `model`, `soul`, `platforms.discord`, `platforms.telegram`, `mcp_servers`, `secrets_file`, `nix_extra`. None of these mapped to real upstream options. M2 shipped with the same schema; the generator silently ignored every field except `model` (which it incorrectly mapped to `services.hermes-agent.settings.model.default`, missing the rest of the upstream `model.*` shape).

The smoke tests during M1 and M2 both succeeded in deploying a *running* hermes-agent process. But that process started with an effectively empty config, no API keys, no platforms, no personality. Useful as proof that the deploy pipeline works. Not useful for any actual client deployment.

The fix is not "add more fields to the schema." It's "stop modeling hermes-agent's config schema in hermes-deploy at all." Upstream's `services.hermes-agent` module already accepts a config.yaml directly via `configFile`, and Paul has a 426-line `~/.hermes/config.yaml` he's been iterating on for months. The right thing is for hermes-deploy to **point at the user's config.yaml** rather than try to model the 30+ top-level config keys it would need to mirror.

## Core architectural decision

**hermes-deploy stops being a config schema. It becomes pure infrastructure plumbing.**

- **`hermes.toml`** owns: `name`, `[cloud]`, `[network]`, file pointers (`config_file`, `secrets_file`), bundled-files-on-the-box (`[hermes.documents]`), non-secret env vars (`[hermes.environment]`), Cachix substituter (`[hermes.cachix]`), and the Nix escape hatch (`nix_extra`).
- **`config.yaml`** (user-provided, sibling to `hermes.toml`) owns: everything hermes-agent reads at startup. Model, providers, agent behavior, terminal, browser, compression, MCP servers, messaging platforms, skills, all of it. hermes-deploy uploads this file verbatim to `/etc/nixos/config.yaml` and points `services.hermes-agent.configFile` at it.
- **`secrets.env.enc`** (sops-encrypted dotenv, sibling to `hermes.toml`) owns: API keys, tokens, anything secret. sops-nix decrypts it at activation, the activation script merges it into `$HERMES_HOME/.env`, hermes-agent loads it via `load_hermes_dotenv()`, and any `${VAR}` references inside `config.yaml` resolve from those env vars at config-load time.

The chain is: **encrypted dotenv → sops-nix → environmentFiles → /var/lib/hermes/.env → os.environ → ${VAR} substitution in config.yaml at startup**.

This was already the upstream-supported design. M1/M2 just didn't connect the wires. M3 connects them.

## The M3 `hermes.toml` shape

```toml
name = "acme-discord-bot"

[cloud]
provider = "aws"          # "aws" | "gcp"
profile  = "default"
region   = "eu-west-3"
zone     = "europe-west1-b"   # GCP only
size     = "large"
disk_gb  = 30

[network]
ssh_allowed_from = "auto"
inbound_ports    = []

[hermes]
config_file  = "./config.yaml"
secrets_file = "./secrets.env.enc"
nix_extra    = "./hermes.extra.nix"   # OPTIONAL

[hermes.documents]                     # OPTIONAL
"SOUL.md" = "./SOUL.md"

[hermes.environment]                   # OPTIONAL
LOG_LEVEL = "info"

[hermes.cachix]                        # OPTIONAL
name       = "acme-deploys"
public_key = "acme-deploys.cachix.org-1:..."
```

### Field-by-field

| Field | Type | Required | Default | Maps to |
|---|---|---|---|---|
| `name` | string (lowercase alphanumeric + hyphens, 1-63 chars) | yes | — | deployment identity, tag values, key file basenames |
| `[cloud].provider` | `"aws"` \| `"gcp"` | yes | — | which `CloudProvider` to instantiate |
| `[cloud].profile` | string | yes | — | `AWS_PROFILE` env var (or GCP project id when `provider=gcp`) |
| `[cloud].region` | string | yes | — | `EC2Client({ region })` |
| `[cloud].zone` | string | required when `provider=gcp` | — | GCP zone within region |
| `[cloud].size` | `"small"` \| `"medium"` \| `"large"` | yes | — | `SIZE_MAP_AWS` / `SIZE_MAP_GCP` lookup |
| `[cloud].disk_gb` | int (8-500) | no | 30 | `RunInstances` BlockDeviceMappings root volume size |
| `[network].ssh_allowed_from` | string | no | `"auto"` | SG rule on port 22; `"auto"` resolves to `<deployer-ip>/32` |
| `[network].inbound_ports` | int[] | no | `[]` | additional SG ingress rules from `0.0.0.0/0` |
| `[hermes].config_file` | string (path relative to project dir) | yes | — | uploaded to `/etc/nixos/config.yaml`; `services.hermes-agent.configFile = ./config.yaml` |
| `[hermes].secrets_file` | string (path relative to project dir) | yes | — | uploaded to `/etc/nixos/secrets.env.enc`; sops-nix `secrets."hermes-env" = { format = "dotenv"; sopsFile = ./secrets.env.enc; }` |
| `[hermes].nix_extra` | string (path relative to project dir) | no | — | uploaded to `/etc/nixos/hermes.extra.nix`; appears in the flake's modules list |
| `[hermes.documents]` | attrset of string→string (filename → relative path) | no | `{}` | each entry uploaded to `/etc/nixos/<filename>`; `services.hermes-agent.documents = { "<filename>" = ./<filename>; ... }` |
| `[hermes.environment]` | attrset of string→string | no | `{}` | `services.hermes-agent.environment = { ... }` (non-secret env vars, merged into `.env` at activation) |
| `[hermes.cachix].name` | string (lowercase alphanumeric + hyphens) | yes when `[hermes.cachix]` present | — | `https://<name>.cachix.org/` substituter in configuration.nix |
| `[hermes.cachix].public_key` | string matching `<name>.cachix.org-1:<base64>` | yes when `[hermes.cachix]` present | — | `nix.settings.trusted-public-keys` entry |

### Cut from M2

- `[hermes].model` — moves into config.yaml's `model.default`
- `[hermes].soul` — drops; SOUL.md becomes a `[hermes.documents]` entry
- `[hermes.platforms.discord]`, `[hermes.platforms.telegram]` — moves into config.yaml's existing platform sections
- `[[hermes.mcp_servers]]` — moves into config.yaml's MCP config
- `[hermes.nix_extra].file` table form — flattened to a plain string field

### Unchanged from M2

- `name`, `[cloud]`, `[network]`, `[hermes.cachix]`

## Generated files on the box

For a deployment with the above `hermes.toml`, hermes-deploy uploads to `/etc/nixos/`:

```
/etc/nixos/
├── flake.nix           # generated, declares inputs (nixpkgs, sops-nix, hermes-agent)
├── configuration.nix   # generated, host-level config (amazon-image, sshd, sops, cachix)
├── hermes.nix          # generated from hermes.toml (the schema fields above)
├── hermes.extra.nix    # uploaded verbatim from $project_dir/hermes.extra.nix (if nix_extra is set)
├── config.yaml         # uploaded verbatim from $project_dir/config.yaml
├── secrets.env.enc     # uploaded verbatim from $project_dir/secrets.env.enc
└── <documents...>      # uploaded verbatim, one per [hermes.documents] entry
```

Plus `/var/lib/sops-nix/age.key` (chmod 600) for sops-nix to decrypt the secrets file.

### `hermes.nix` (the generator's output)

Example for the schema above:

```nix
{ config, pkgs, lib, ... }:
{
  services.hermes-agent = {
    enable = true;
    configFile = ./config.yaml;
    environmentFiles = [ config.sops.secrets."hermes-env".path ];
    environment = {
      LOG_LEVEL = "info";
    };
    documents = {
      "SOUL.md" = ./SOUL.md;
    };
  };
}
```

When `[hermes.environment]` is empty, the `environment = { };` block is omitted.
When `[hermes.documents]` is empty, the `documents = { };` block is omitted.
When `nix_extra` is set, the file is uploaded but referenced from `flake.nix`'s modules list, not via `imports` in `hermes.nix` (cleaner separation).

### `configuration.nix` (the template change)

The M2 `configuration.nix` had:

```nix
sops = {
  defaultSopsFile = ./secrets.enc.yaml;
  age.keyFile = "/var/lib/sops-nix/age.key";
  secrets."placeholder" = { };   # M1.1 workaround
};
```

M3 changes this to:

```nix
sops = {
  defaultSopsFile = ./secrets.env.enc;
  age.keyFile = "/var/lib/sops-nix/age.key";
  secrets."hermes-env" = {
    format = "dotenv";
    owner = config.services.hermes-agent.user;
    group = config.services.hermes-agent.group;
  };
};
```

The placeholder secret from M1.1 (workaround for upstream's hardcoded `setupSecrets` activation dep) goes away because we now have a real secret declaration. `format = "dotenv"` tells sops-nix that the decrypted content is `KEY=value` lines, which it exposes at `config.sops.secrets."hermes-env".path` as a single file. `owner`/`group` make the decrypted file readable by the hermes user (otherwise it's root-only, which would block the activation script merging it into `.env`).

### `flake.nix` (small change)

The M2 flake had `modules = [ ./configuration.nix ./hermes.nix sops-nix.nixosModules.sops hermes-agent.nixosModules.default ]`. M3 conditionally appends `./hermes.extra.nix` when `nix_extra` is set:

```nix
modules = [
  ./configuration.nix
  ./hermes.nix
  sops-nix.nixosModules.sops
  hermes-agent.nixosModules.default
] ++ lib.optional (builtins.pathExists ./hermes.extra.nix) ./hermes.extra.nix;
```

The `pathExists` guard means the same generated `flake.nix` works whether or not `nix_extra` is present.

## Secrets pipeline (end-to-end)

1. User runs `hermes-deploy init`. Init creates `secrets.env.enc` as an empty sops-encrypted dotenv file (encrypted with the freshly-generated per-deployment age public key).
2. User runs `hermes-deploy secret set ANTHROPIC_API_KEY sk-...`. This decrypts the file via sops, mutates the in-memory dotenv (adds/updates the line `ANTHROPIC_API_KEY=sk-...`), re-encrypts in place.
3. User runs `hermes-deploy up`. The orchestrator SCPs `secrets.env.enc` to `/etc/nixos/secrets.env.enc` and the age private key to `/var/lib/sops-nix/age.key`.
4. `nixos-rebuild switch --flake /etc/nixos#default` evaluates the flake.
5. sops-nix's activation script reads `/etc/nixos/secrets.env.enc`, decrypts it with the age key, writes the decrypted dotenv content to `/run/secrets/hermes-env` (chmod 0440, owner=hermes).
6. hermes-agent's own activation script (the one that fires after `setupSecrets`) reads each path in `services.hermes-agent.environmentFiles` and merges the contents into `/var/lib/hermes/.env`.
7. The hermes-agent.service systemd unit starts the agent process, which calls `load_hermes_dotenv()` early in startup. This populates `os.environ` with the dotenv keys.
8. The agent loads `/etc/nixos/config.yaml`, recursively expanding `${VAR}` references via `os.environ.get(VAR, original)` (verified at `hermes_cli/config.py:1892-1901` in upstream). API keys, tokens, etc. resolve to their decrypted values.

The user-side workflow for adding a new secret:

```bash
# Add the secret
hermes-deploy secret set DISCORD_BOT_TOKEN MTIzN...

# Reference it in config.yaml (one-time, when first wiring up Discord)
$EDITOR config.yaml
# add e.g.
#   discord:
#     enabled: true
#     bot_token: ${DISCORD_BOT_TOKEN}

# Push the change
hermes-deploy update
```

The `update` command's content-hash short-circuit (from M2 Phase A3) catches the case where only `secrets.env.enc` changed but `hermes.toml` and `config.yaml` did not — the hash includes both files, so any secret edit triggers a real rebuild.

## Documents pipeline

`[hermes.documents]` is an attrset where each entry is `<filename-on-box> = <relative-path-on-disk>`. The orchestrator:

1. Resolves each value to an absolute path under the project directory.
2. Validates the file exists at upload time (errors clearly if missing — the M2 nix-gen path-validation already catches characters invalid in Nix path literals; M3 adds existence check).
3. SCPs each document to `/etc/nixos/<filename>` (the key from the attrset).
4. Generates the `services.hermes-agent.documents` block in `hermes.nix` with `<filename> = ./<filename>` entries (the leading `./` makes them Nix path literals relative to `hermes.nix`).
5. Hermes-agent's activation script copies them into `$HERMES_HOME/documents/`.

`init` scaffolds a starter `SOUL.md` and a `[hermes.documents]` entry pointing at it, so out-of-the-box `hermes-deploy up` puts SOUL.md on the box without the user having to know about the documents wiring.

## Init command (the new scaffolding)

`hermes-deploy init` produces:

```
~/clients/acme/discord-bot/
├── hermes.toml          # NEW shape (per "M3 hermes.toml shape" above)
├── config.yaml          # starter config from a bundled template
├── secrets.env.enc      # empty sops-encrypted dotenv
├── .sops.yaml           # records the deployment's age public key as recipient
├── SOUL.md              # starter agent personality
└── .gitignore           # commented to explain that secrets.env.enc is safe to commit
```

The starter `config.yaml` is a minimal but working hermes config — enough to start the agent without errors but with no real platforms enabled. Users replace it with their own config (or copy from `~/.hermes/config.yaml` if they have one). The starter is bundled as a string literal in `src/init-templates/config-yaml.ts` (same pattern M2 used for the existing templates).

## State migration (`schema_version = 1` → `2`)

The state file shape (`~/.config/hermes-deploy/state.toml`) is **unchanged**. Only `hermes.toml`'s shape changed; the deployment metadata schema (`cloud_resources`, `ssh_key_path`, `age_key_path`, `last_config_hash`, etc.) is identical.

The migration is one line in `src/state/migrations.ts`:

```typescript
migrations[2] = (input: unknown) => {
  const v1 = input as { schema_version: number; deployments: Record<string, unknown> };
  return { ...v1, schema_version: 2 };
};
```

`CURRENT_SCHEMA_VERSION` bumps from 1 to 2. The Phase G migration runner picks this up automatically. Existing v1 state files get bumped to v2 transparently the next time `StateStore.read()` is called.

## User-file migration (manual, documented)

There is no tooling to migrate v1 `hermes.toml` files into v2 shape. The user count for v1 is "Paul, with smoke-test deployments that have already been destroyed." The migration story is a 5-line procedure documented in `docs/migrating-from-m2.md`:

1. `hermes-deploy destroy <name> --yes` (cleans up cloud + local keys + sops files)
2. `cd <project> && rm -f hermes.toml secrets.enc.yaml .sops.yaml SOUL.md`
3. `hermes-deploy init` (scaffolds the new shape)
4. Copy your `~/.hermes/config.yaml` (or similar) into `./config.yaml`, edit if needed
5. `hermes-deploy secret set <key> <value>` for each secret, then `hermes-deploy up`

Validation failure when running M3 against a v1 `hermes.toml` is intentional — zod errors with `hermes.config_file: Required` and `hermes.secrets_file: Required`, which tells the user what's missing. The migration doc explains the fix.

## File structure changes

### New files

- `src/init-templates/config-yaml.ts` — starter `config.yaml` template
- `docs/migrating-from-m2.md` — manual migration procedure

### Modified files (from M2)

- `src/schema/hermes-toml.ts` — replace the schema per "M3 `hermes.toml` shape" above
- `src/nix-gen/templates.ts` — `configurationNix` updates the sops block (dotenv format, real secret declaration, drop placeholder)
- `src/nix-gen/generate.ts` — `generateHermesNix` rewrites against the new schema fields
- `src/orchestrator/deploy.ts` and `src/orchestrator/shared.ts` — `uploadAndRebuild` uploads `config.yaml`, `secrets.env.enc` (renamed), each document, and the optional `hermes.extra.nix`
- `src/state/migrations.ts` — add the `migrations[2]` no-op bump, update `CURRENT_SCHEMA_VERSION`
- `src/state/hash.ts` — the config hash now needs to include `config.yaml` and the documents files in addition to `hermes.toml` and `secrets.env.enc`
- `src/sops/bootstrap.ts` — `ensureSopsBootstrap` creates `secrets.env.enc` (renamed) as a dotenv-format sops file with `format = "dotenv"` semantics
- `src/commands/secret.ts` — `secretSet/Get/Rm/List` work on dotenv format instead of YAML; `secretEdit` opens the dotenv file via `sops` directly
- `src/commands/init.ts` — scaffolds the new file set (config.yaml + SOUL.md + secrets.env.enc + .sops.yaml + .gitignore + new hermes.toml)
- `src/init-templates/hermes-toml.ts` — new template matching M3 shape
- `src/init-templates/gitignore.ts` — comment refers to `secrets.env.enc` instead of `secrets.enc.yaml`
- `README.md`, `docs/getting-started.md`, `docs/schema-reference.md` — update for M3
- All affected unit tests

## Tests

### What needs new test coverage in M3

- Schema parser for the new `hermes.toml` shape (replaces existing schema tests)
- Generator output for `hermes.nix` with the new `services.hermes-agent` options (snapshot tests via Vitest's `toMatchFileSnapshot`, replacing existing snapshots)
- `configuration.nix` template emits the dotenv-format sops secret declaration
- `flake.nix` conditionally includes `./hermes.extra.nix` (existing tests cover the no-`nix_extra` path; add a test with `nix_extra` set)
- sops bootstrap creates a dotenv-format file (replaces existing yaml-format test)
- `secret set/get/rm/list` work on dotenv format (existing tests need their fixtures updated)
- `[hermes.documents]` validation: missing files at upload time error clearly
- `[hermes.environment]` round-trip: schema → generator → snapshot
- State migration v1 → v2: existing v1 state files come back as v2 unchanged
- Init command produces a project that parses cleanly through the new schema

### What stays the same

- All cloud / orchestrator / remote-ops / Ink UI tests are unaffected (the schema redesign doesn't touch those layers)
- M2's `update` flow tests pass unchanged once the fakes use the new schema fixtures
- M2's `ls`, `logs`, `key`, resolver, migration-runner tests are unaffected

## Out of scope for M3

- **GCP provider implementation** — slated for M4. The new schema is provider-agnostic; GCP just needs a `CloudProvider` implementation against the existing interface plus a `gcp/` subdir with provision/destroy/network/etc. handlers. M4.
- **Cachix population workflow** — the substituter wiring is already in M2 (and unchanged in M3); the question of "how do users actually populate the cache" is a separate design question that doesn't belong here.
- **Pre-baked AMI pipeline** — separate effort, M5 or later.
- **`ls --watch` live Ink dashboard** — M2 leftover, not coupled to M3.
- **`update` skipping rebuild on network-only changes** — M2 leftover optimization.
- **Renaming the project to something other than hermes-deploy** — out of scope, also it's a fine name.
- **Accepting raw YAML inside `hermes.toml`** — the whole point of M3 is `config.yaml` is a separate file. Don't relitigate.

## Risks and mitigations

### Risk 1: hermes-agent's `${VAR}` substitution doesn't cover all the places users put secrets

Verified at `hermes_cli/config.py:1892-1901`: substitution is *recursive* and applies to all string values in the config tree. Should cover any reasonable secret placement (model API keys, platform tokens, OAuth client secrets, MCP server env keys).

**Mitigation if it doesn't:** users can also put secrets directly in their plain config.yaml (no substitution needed) and rely on the file's `0440 owner=hermes` mode for protection. Less defensible than the substitution path but works if needed.

### Risk 2: sops-nix's `format = "dotenv"` semantics

Verified by reading sops-nix docs: when `format = "dotenv"`, sops-nix expects the decrypted content to be `KEY=value` lines and exposes the whole file as a single secret. This matches what hermes-agent's `environmentFiles` consumes.

**Mitigation if there's a quirk:** fall back to `format = "binary"` and accept that the file extension lies — sops doesn't actually inspect the format for binary mode, it just decrypts opaque bytes. The activation script works either way.

### Risk 3: hermes-agent's NixOS module changes between now and M3 ship

The activation-script `setupSecrets` dep we worked around in M1.1 still exists upstream as of the latest fetch. If upstream lands the conditional fix Paul drafted, our placeholder workaround can go away — but we don't depend on it because M3 declares a real secret (`hermes-env`) which satisfies `setupSecrets` regardless.

**Mitigation:** none needed. The real secret declaration replaces the placeholder cleanly.

### Risk 4: hermes-agent's `documents` option doesn't behave the way I think it does

Verified shape (`attrsOf (either str path)`) but I haven't actually exercised it in a real deploy. The first M3 smoke test will be the first time `documents` actually flows through.

**Mitigation:** the `[hermes.documents]` field is *optional*. If `documents` turns out to be broken or weird, the fallback is dropping the field from M3 and having users wire SOUL.md via `nix_extra` (one extra concept, but works). We don't lock in a hard dependency on this option until the smoke test proves it works.

### Risk 5: Users with existing `~/.hermes/config.yaml` content that's incompatible with hermes-agent's flake-built version

Paul's local config.yaml is from his locally-installed hermes-agent. The flake input pins `hermes-agent.url = github:NousResearch/hermes-agent`. If Paul's local hermes is on a newer commit than the flake input, his config.yaml might reference fields the flake-version doesn't understand.

**Mitigation:** the `flake.nix` already accepts `inputs.hermes-agent.follows` updates. Users on bleeding-edge hermes can pin a specific commit or `main` and update their flake.lock. Documented in the migration guide.

## What ships in M3

- New `hermes.toml` schema
- Rewritten `nix-gen` (templates + generator)
- Updated configuration.nix template (dotenv sops secret, drop placeholder)
- Updated flake.nix template (conditional `nix_extra` inclusion)
- Updated `init` command + templates
- Updated `secret` subcommands (dotenv format)
- Updated sops bootstrap
- Updated config hash (includes config.yaml + documents)
- State migration (v1 → v2 no-op bump)
- Updated docs (README, getting-started, schema-reference, migration guide)
- All affected tests rewritten

Estimated scope: similar to M2 (~25-30 implementation tasks). The mechanical work is concentrated in `nix-gen` and the schema; everything else is downstream effects.

## Success criteria

After M3 ships:

1. `hermes-deploy init` scaffolds a project that deploys without manual SSH-and-edit-files-on-the-box steps.
2. `secret set ANTHROPIC_API_KEY <real-key>` followed by `update` results in an agent that can call Anthropic.
3. Editing `config.yaml` to enable Discord with `bot_token: ${DISCORD_BOT_TOKEN}` followed by `secret set DISCORD_BOT_TOKEN <real-token>` followed by `update` results in an agent that connects to Discord.
4. Smoke test passes end-to-end from `init` through `update` to a working production-shaped deployment, not just a "hermes-agent.service is active" placeholder.
5. The user-facing schema in `docs/schema-reference.md` is short enough to read in one sitting and complete enough to wire any real client deployment without dropping to `nix_extra`.

The bar is "hermes-deploy is usable for real client work on AWS today, no manual editing required." If smoke test #4 doesn't get there, M3 isn't done yet.
