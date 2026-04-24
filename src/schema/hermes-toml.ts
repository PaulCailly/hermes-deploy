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
    // Root disk size in GB. NixOS community AMIs default to ~5 GB,
    // which is too small to build the hermes-agent Python closure
    // from source. 30 GB is a safe floor; raise for heavier deployments.
    disk_gb: z.number().int().min(8).max(500).default(30),
    // Optional image override. When set, the image resolver is skipped
    // and this value is used directly (AMI ID for AWS, image self-link
    // or family URL for GCP). Useful when the public NixOS images have
    // permission issues (e.g., nixos-cloud on GCP) and you need to use
    // an imported image in your own project.
    image: z.string().min(1).optional(),
  })
  .refine(c => c.provider !== 'gcp' || !!c.zone, {
    message: 'cloud.zone is required when cloud.provider = "gcp"',
    path: ['zone'],
  });

const NetworkSchema = z.object({
  ssh_allowed_from: z.string().min(1).default('auto'),
  inbound_ports: z.array(z.number().int().min(1).max(65535)).default([]),
});

// [hermes.cachix] — optional binary substituter for the hermes-agent
// closure. Unchanged from M2.
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

// [[hermes.profiles]] — optional named sub-agents running alongside the
// default agent on the same VM. Each profile is an independent agent
// instance with its own config, secrets, and documents.
// Document keys are used as filenames on the remote VM.  Restrict to safe
// basenames (alphanumeric, hyphens, underscores, dots — no slashes, no "..").
const SafeFilenameKey = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, {
    message: 'document key must be a safe filename (no slashes or "..")',
  })
  .refine(k => !k.includes('..'), { message: 'document key must not contain ".."' });

const ProfileSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, {
      message: 'profile name must be lowercase alphanumeric with hyphens, 1-63 chars',
    })
    .refine(n => n !== 'default', {
      message: '"default" is reserved — the flat [hermes] section is the default profile',
    }),
  config_file: z.string().min(1),
  secrets_file: z.string().min(1),
  documents: z.record(SafeFilenameKey, z.string().min(1)).default({}),
});

export type ProfileConfig = z.infer<typeof ProfileSchema>;

// [hermes] — pure infrastructure pointers + escape hatch.
// hermes-deploy intentionally does NOT model the agent's config.yaml
// schema. The user provides config.yaml directly; we upload it and
// point services.hermes-agent.configFile at it.
const HermesSchema = z
  .object({
    config_file: z.string().min(1),
    secrets_file: z.string().min(1),
    nix_extra: z.string().min(1).optional(),
    documents: z.record(SafeFilenameKey, z.string().min(1)).default({}),
    environment: z.record(z.string().min(1), z.string()).default({}),
    cachix: CachixSchema.optional(),
    profiles: z.array(ProfileSchema).default([]),
  })
  .refine(
    h => {
      const names = h.profiles.map(p => p.name);
      return new Set(names).size === names.length;
    },
    { message: 'Duplicate profile names are not allowed', path: ['profiles'] },
  );

const DomainSchema = z.object({
  name: z.string().min(1).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/, {
    message: 'domain.name must be a valid FQDN with at least one dot (e.g., app.example.com)',
  }),
  upstream_port: z.number().int().min(1).max(65535).refine(p => p !== 80 && p !== 443, {
    message: 'upstream_port cannot be 80 or 443 — those ports are reserved for nginx',
  }),
});

export const HermesTomlSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]{0,62}$/, {
    message: 'name must be lowercase alphanumeric with hyphens, 1-63 chars',
  }),
  cloud: CloudSchema,
  network: NetworkSchema.default({ ssh_allowed_from: 'auto', inbound_ports: [] }),
  hermes: HermesSchema,
  domain: DomainSchema.optional(),
});

export type HermesTomlConfig = z.infer<typeof HermesTomlSchema>;
