# `hermes.toml` schema reference

Every field accepted by `hermes-deploy`'s parser. Fields marked **(M3)** are accepted today but ignored by the generator until the M3 schema redesign wires them through to upstream's real options.

## Top level

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Deployment name. Lowercase alphanumeric with hyphens, 1-63 chars. Must match `^[a-z0-9][a-z0-9-]*$`. |

## `[cloud]`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `provider` | `"aws"` \| `"gcp"` | yes | — | Cloud provider. M2 supports `aws` only; `gcp` lands in M3. |
| `profile` | string | yes | — | AWS profile name (when `provider=aws`) or GCP project ID (when `provider=gcp`). The CLI sets `AWS_PROFILE` / `CLOUDSDK_CORE_PROJECT` from this value. |
| `region` | string | yes | — | Cloud region. Pick one with NixOS community AMIs (`us-east-1`, `eu-west-3`, `ap-southeast-1`, etc.). |
| `zone` | string | required when `provider=gcp` | — | GCP zone within the region. Ignored on AWS. |
| `size` | `"small"` \| `"medium"` \| `"large"` | yes | — | Abstract instance size. Maps to `t3.small` / `t3.medium` / `t3.large` on AWS. `large` recommended for first deploys (the build needs ~6 GB RAM). |
| `disk_gb` | int | no | `30` | Root volume size in GB. Min 8, max 500. NixOS AMIs ship with ~5 GB which is too small for the hermes-agent build; raise this if you have many MCP servers or large documents. |

## `[network]`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `ssh_allowed_from` | string | no | `"auto"` | CIDR allowed to SSH (port 22). `"auto"` resolves your machine's current public IP at provision time and pins it as `<ip>/32`. Set to a custom CIDR (e.g. `"10.0.0.0/8"`) to override. |
| `inbound_ports` | int[] | no | `[]` | Additional inbound TCP ports to open from `0.0.0.0/0`. Use for webhooks (e.g. `[443]`). Don't put SSH here — it's already covered by `ssh_allowed_from`. |

## `[hermes]`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `model` | string | yes | — | LLM model identifier (e.g. `"anthropic/claude-sonnet-4-5"`). Currently flows into `services.hermes-agent.settings.model.default`. |
| `soul` | string | yes | — | **(M3)** Path to a SOUL.md file. Currently parsed but not emitted into the NixOS module. |
| `secrets_file` | string | yes | — | **(M3)** Path to the sops-encrypted secrets file. Currently parsed but not emitted into the NixOS module. |

## `[hermes.platforms.*]` **(M3)**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `discord.enabled` | bool | no | `false` | Enable Discord platform integration. Currently ignored by the generator. |
| `discord.token_key` | string | no | — | Key in `secrets_file` containing the Discord bot token. Currently ignored. |
| `telegram.enabled` | bool | no | `false` | Enable Telegram platform integration. Currently ignored. |
| `telegram.token_key` | string | no | — | Key in `secrets_file` containing the Telegram bot token. Currently ignored. |

## `[[hermes.mcp_servers]]` **(M3)**

Array of MCP server entries. Currently parsed but not emitted into the NixOS module.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | yes | — | MCP server name (used as the attribute key in `services.hermes-agent.mcpServers`). |
| `command` | string | yes | — | Command to run for stdio transport (e.g. `"npx"`). |
| `args` | string[] | no | `[]` | CLI args for the command. |
| `env_keys` | string[] | no | `[]` | Keys in `secrets_file` to expose as environment variables to the MCP server process. |

## `[hermes.nix_extra]`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `file` | string | yes | — | Path to a Nix file that gets imported alongside `hermes.nix` on the box. Use this as an escape hatch to set any `services.hermes-agent.*` option that isn't covered by the wrapper schema. The file must use only `[A-Za-z0-9._+-/]` characters in its path (Nix path literal restrictions). |

## `[hermes.cachix]` (optional)

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | yes | — | Cachix cache name (the part before `.cachix.org`). Must match `^[a-z0-9][a-z0-9-]*$`. |
| `public_key` | string | yes | — | The cache's public key, in the form `<name>.cachix.org-1:<base64>`. Copy from the Cachix cache settings page. |

When set, `hermes-deploy` adds the cache as a Nix substituter on the box, so `nixos-rebuild` substitutes the hermes-agent closure from cache instead of compiling it from source. See [getting-started.md](getting-started.md#optional-cachix) for setup.

## Validation

`hermes-deploy` validates the entire file before any cloud calls happen. If a field is wrong, you get a `cloud.provider: invalid enum value` style error pointing at the exact path — not a cryptic crash 10 minutes into provisioning.

You can validate without deploying by running any read-only command against the project (`hermes-deploy status`, `hermes-deploy ls`) — they parse the toml as a side effect.
