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
