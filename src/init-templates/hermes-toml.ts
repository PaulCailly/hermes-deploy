export const HERMES_TOML_TEMPLATE = (name: string) => `name = "${name}"

[cloud]
provider = "aws"        # "aws" or "gcp"
profile  = "default"     # AWS profile name or GCP project id
region   = "eu-west-3"
# zone   = "europe-west1-b"  # required when provider = "gcp"
size     = "large"       # "small" | "medium" | "large"
                         # IMPORTANT: the first hermes-agent build needs
                         # ~6 GB RAM. "small" (t3.small, 2 GB) will OOM-
                         # kill nix mid-build. Stay on "large" (t3.large,
                         # 8 GB) for the first deploy; downsize later
                         # once Cachix is populated.
disk_gb  = 30            # root volume size; first hermes-agent build
                         # needs at least 20 GB free
# image  = "..."         # optional: override the NixOS image.
                         # AWS: ami-xxx  GCP: projects/<proj>/global/images/<name>
                         # If unset, hermes-deploy resolves the latest NixOS 25.11 image.
                         # Set this if the public NixOS images have permission issues.

[network]
ssh_allowed_from = "auto"   # "auto" = your current public IP, or a CIDR
inbound_ports    = []        # opt in: e.g. [443] for a webhook port

[hermes]
config_file  = "./config.yaml"      # the agent's runtime config (uploaded verbatim)
secrets_file = "./secrets.env.enc"  # sops-encrypted dotenv (managed via \`secret\` subcommands)

# Optional: documents the agent reads at startup (e.g. SOUL.md). The keys
# are filenames on the box; the values are paths in this project dir.
[hermes.documents]
"SOUL.md" = "./SOUL.md"

# Optional: non-secret environment variables for the agent process.
# [hermes.environment]
# LOG_LEVEL = "info"

# Optional: faster first deploy via a Cachix binary cache. Sign up at
# cachix.org, create a cache, and paste the public key from its
# settings page. Without this set, the first deploy compiles the
# hermes-agent closure from source (~10-15 min on a t3.large).
# [hermes.cachix]
# name       = "your-cache-name"
# public_key = "your-cache-name.cachix.org-1:xxxxx"

# Optional escape hatch: a Nix file with extra services.hermes-agent.*
# settings or whole-system NixOS config. Imported by the generated
# flake.nix when present.
# nix_extra = "./hermes.extra.nix"
`;
