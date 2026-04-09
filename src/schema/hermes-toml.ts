import { z } from 'zod';

const SizeSchema = z.enum(['small', 'medium', 'large']);
const ProviderSchema = z.enum(['aws', 'gcp']);

const CloudSchema = z
  .object({
    provider: ProviderSchema,
    profile: z.string().min(1),
    region: z.string().min(1),
    zone: z.string().min(1).optional(),
    size: SizeSchema,
    // Root disk size in GB. NixOS community AMIs default to ~5 GB, which
    // is too small to build the hermes-agent Python closure from source
    // (first deploy OOMs the disk on pynacl/pyproject wheels). 30 GB is
    // a safe floor with headroom; raise via hermes.toml for heavier
    // deployments.
    disk_gb: z.number().int().min(8).max(500).default(30),
  })
  .refine(c => c.provider !== 'gcp' || !!c.zone, {
    message: 'cloud.zone is required when cloud.provider = "gcp"',
    path: ['zone'],
  });

const NetworkSchema = z.object({
  ssh_allowed_from: z.string().min(1).default('auto'),
  inbound_ports: z.array(z.number().int().min(1).max(65535)).default([]),
});

const PlatformDiscordSchema = z.object({
  enabled: z.boolean(),
  token_key: z.string().min(1).optional(),
});

const PlatformTelegramSchema = z.object({
  enabled: z.boolean(),
  token_key: z.string().min(1).optional(),
});

const McpServerSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env_keys: z.array(z.string()).default([]),
});

const NixExtraSchema = z.object({
  file: z.string().min(1),
});

// Optional Cachix binary cache for substituting hermes-agent's closure
// instead of building it from source. When set, configuration.nix on the
// box adds <name>.cachix.org as a substituter and trusts <public_key>.
// First deploy still has to build (and ideally push to the cache); every
// subsequent first-deploy of the same hermes-agent rev pulls from cache.
const CachixSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, {
      message: 'cachix.name must be lowercase alphanumeric with hyphens',
    }),
  public_key: z.string().regex(/^[a-z0-9-]+\.cachix\.org-1:[A-Za-z0-9+/=]+$/, {
    message:
      'cachix.public_key must look like "<name>.cachix.org-1:<base64>" — copy it from your cache settings page',
  }),
});

const HermesSchema = z.object({
  model: z.string().min(1),
  soul: z.string().min(1),
  secrets_file: z.string().min(1),
  platforms: z.object({
    discord: PlatformDiscordSchema.optional(),
    telegram: PlatformTelegramSchema.optional(),
  }),
  mcp_servers: z.array(McpServerSchema).default([]),
  nix_extra: NixExtraSchema.optional(),
  cachix: CachixSchema.optional(),
});

export const HermesTomlSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]{0,62}$/, {
    message: 'name must be lowercase alphanumeric with hyphens, 1-63 chars',
  }),
  cloud: CloudSchema,
  network: NetworkSchema.default({ ssh_allowed_from: 'auto', inbound_ports: [] }),
  hermes: HermesSchema,
});

export type HermesTomlConfig = z.infer<typeof HermesTomlSchema>;
