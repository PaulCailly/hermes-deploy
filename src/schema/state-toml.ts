import { z } from 'zod';

const HealthSchema = z.enum(['healthy', 'unhealthy', 'unknown']);

const AwsResourcesSchema = z.object({
  instance_id: z.string().min(1),
  security_group_id: z.string().min(1),
  key_pair_name: z.string().min(1),
  eip_allocation_id: z.string().min(1),
  region: z.string().min(1),
});

const GcpResourcesSchema = z.object({
  instance_name: z.string().min(1),
  static_ip_name: z.string().min(1),
  firewall_rule_names: z.array(z.string().min(1)),
  project_id: z.string().min(1),
  zone: z.string().min(1),
});

const BaseDeploymentSchema = z.object({
  project_path: z.string().min(1),
  region: z.string().min(1),
  created_at: z.string().datetime(),
  last_deployed_at: z.string().datetime(),
  last_config_hash: z.string().min(1),
  /**
   * Hash of the nix-relevant files only (config_file, secrets_file,
   * nix_extra, documents) — excludes hermes.toml so that changes to
   * network-only fields do NOT trigger a nixos-rebuild. Populated after
   * every successful nixos-rebuild; defaults to "sha256:unknown" on
   * migration (forces a rebuild on the first update after upgrade, which
   * is safe).
   */
  last_nix_hash: z.string().min(1).default('sha256:unknown'),
  ssh_key_path: z.string().min(1),
  age_key_path: z.string().min(1),
  health: HealthSchema,
  instance_ip: z.string().min(1),
  hermes_agent_rev: z.string().min(1).default('unknown'),
  hermes_agent_tag: z.string().default(''),
  domain_name: z.string().min(1).optional(),
  dns_record_id: z.string().min(1).optional(),
  profile_hashes: z.record(z.string(), z.string()).optional(),
});

const DeploymentSchema = z.discriminatedUnion('cloud', [
  BaseDeploymentSchema.extend({
    cloud: z.literal('aws'),
    cloud_resources: AwsResourcesSchema,
  }),
  BaseDeploymentSchema.extend({
    cloud: z.literal('gcp'),
    cloud_resources: GcpResourcesSchema,
  }),
]);

export const StateTomlSchema = z.object({
  schema_version: z.literal(4),
  deployments: z.record(z.string(), DeploymentSchema),
});

export type StateToml = z.infer<typeof StateTomlSchema>;
export type Deployment = z.infer<typeof DeploymentSchema>;
export type AwsResources = z.infer<typeof AwsResourcesSchema>;
export type GcpResources = z.infer<typeof GcpResourcesSchema>;
