# `hermes.toml` schema reference

Every field accepted by `hermes-deploy`'s parser. Every field reaches the running agent — there are no more "parser-accepted but generator-ignored" fields after the M3 redesign.

## Top level

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Deployment name. Lowercase alphanumeric with hyphens, 1-63 chars. Must match `^[a-z0-9][a-z0-9-]*$`. |

## `[cloud]`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `provider` | `"aws"` \| `"gcp"` | yes | — | Cloud provider. M3 supports `aws` only; `gcp` lands in M4. |
| `profile` | string | yes | — | AWS profile name (when `provider=aws`) or GCP project ID. |
| `region` | string | yes | — | Cloud region. Must be one with NixOS community AMIs. |
| `zone` | string | required when `provider=gcp` | — | GCP zone within the region. |
| `size` | `"small"` \| `"medium"` \| `"large"` | yes | — | Instance size. `large` (t3.large, 8 GB RAM) recommended for first deploys. |
| `disk_gb` | int | no | `30` | Root volume size in GB. Min 8, max 500. |

## `[network]`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `ssh_allowed_from` | string | no | `"auto"` | CIDR allowed to SSH on port 22. `"auto"` resolves your machine's current public IP. |
| `inbound_ports` | int[] | no | `[]` | Additional inbound TCP ports to open from `0.0.0.0/0`. |

## `[hermes]`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `config_file` | string (relative path) | yes | — | Path to the user's hermes config.yaml. Uploaded verbatim to the box and pointed at by `services.hermes-agent.configFile`. |
| `secrets_file` | string (relative path) | yes | — | Path to the sops-encrypted dotenv file. Decrypted at activation by sops-nix and merged into `$HERMES_HOME/.env`. |
| `nix_extra` | string (relative path) | no | — | Optional Nix file with extra `services.hermes-agent.*` settings or whole-system config. Imported by the generated flake.nix when present. |

## `[hermes.documents]`

Attrset of `<filename-on-box>` → `<relative-path-in-project-dir>`. Each entry is uploaded to `/etc/nixos/<filename>` and exposed via `services.hermes-agent.documents = { ... }`. The agent's activation script copies them into `$HERMES_HOME/documents/`.

```toml
[hermes.documents]
"SOUL.md" = "./SOUL.md"
"persona.md" = "./behaviors/persona-v3.md"
```

The key is the destination filename on the box; the value is where to find the source file in the project directory. The default is `{}` (no documents).

## `[hermes.environment]`

Attrset of `KEY` → `string`. Non-secret environment variables for the agent process. Maps directly to `services.hermes-agent.environment`. Use this for things like `LOG_LEVEL=debug` or `RUST_BACKTRACE=1` — anything you want to flip without re-encrypting the secrets file.

```toml
[hermes.environment]
LOG_LEVEL = "debug"
RUST_BACKTRACE = "1"
```

The default is `{}`.

## `[hermes.cachix]` (optional)

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | yes | — | Cachix cache name (the part before `.cachix.org`). |
| `public_key` | string | yes | — | Cache public key in `<name>.cachix.org-1:<base64>` form. |

When set, the box adds the cache as a Nix substituter so `nixos-rebuild` substitutes the hermes-agent closure from cache instead of compiling it from source.

## Validation

`hermes-deploy` validates the entire file before any cloud calls happen. Missing required fields produce errors like `hermes.config_file: Required` pointing at the exact path. Invalid enum values, missing GCP zones, malformed cachix keys, and Nix-incompatible characters in document filenames are all caught at toml-load time.
