/**
 * The starter hermes.toml that `hermes-deploy init` writes. Kept as a
 * function so the deployment name can be parameterized from the
 * directory name (or --name flag).
 */
export const HERMES_TOML_TEMPLATE = (name: string) => `name = "${name}"

[cloud]
provider = "aws"        # "aws" (M2) or "gcp" (coming in M3)
profile  = "default"     # AWS profile name or GCP project id
region   = "eu-west-3"
size     = "large"       # "small" | "medium" | "large"
                         # IMPORTANT: the first hermes-agent build needs
                         # ~6 GB RAM. "small" (t3.small, 2 GB) will OOM-
                         # kill nix mid-build. Stay on "large" (t3.large,
                         # 8 GB) for the first deploy; downsize later
                         # once Cachix is populated.
disk_gb  = 30            # root volume size; first hermes-agent build
                         # needs at least 20 GB free

[network]
ssh_allowed_from = "auto"   # "auto" = your current public IP, or a CIDR
inbound_ports    = []        # opt in: e.g. [443] for a webhook port

[hermes]
model        = "anthropic/claude-sonnet-4-5"
soul         = "./SOUL.md"
secrets_file = "./secrets.enc.yaml"

# Discord/Telegram platform wiring is intentionally minimal in M2 — the
# hermes.toml schema redesign in M3 will properly map these onto the
# upstream module's services.hermes-agent.settings options.
[hermes.platforms.discord]
enabled   = true
token_key = "discord_bot_token"

# Optional: faster first deploy via a Cachix binary cache. Sign up at
# cachix.org, create a cache, and paste the public key from its
# settings page. Without this set, the first deploy compiles the
# hermes-agent closure from source (~10-15 min on a t3.large).
# [hermes.cachix]
# name       = "your-cache-name"
# public_key = "your-cache-name.cachix.org-1:xxxxx"
`;
