import { z } from 'zod';

// ---------- Reporter events (WS wire format) ----------

export const PhaseIdSchema = z.enum([
  'validate', 'ensure-keys', 'provision', 'dns',
  'wait-ssh', 'bootstrap', 'flake-update', 'healthcheck',
]);
export type PhaseIdDto = z.infer<typeof PhaseIdSchema>;

export const ReporterEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('phase-start'), id: PhaseIdSchema, label: z.string() }),
  z.object({ type: z.literal('phase-done'), id: PhaseIdSchema }),
  z.object({ type: z.literal('phase-fail'), id: PhaseIdSchema, error: z.string() }),
  z.object({ type: z.literal('log'), line: z.string() }),
  z.object({ type: z.literal('success'), summary: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type ReporterEvent = z.infer<typeof ReporterEventSchema>;

// ---------- Job tracking ----------

export const JobStatusSchema = z.enum(['running', 'done', 'failed']);

export const JobDtoSchema = z.object({
  jobId: z.string(),
  deploymentName: z.string(),
  kind: z.enum(['up', 'update', 'destroy', 'adopt', 'upgrade']),
  status: JobStatusSchema,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  events: z.array(ReporterEventSchema),
});
export type JobDto = z.infer<typeof JobDtoSchema>;

// ---------- Deployment summaries (GET /api/deployments) ----------

export const DeploymentSummaryDtoSchema = z.object({
  name: z.string(),
  cloud: z.enum(['aws', 'gcp']),
  region: z.string(),
  instanceIp: z.string(),
  storedHealth: z.enum(['healthy', 'unhealthy', 'unknown']),
  lastDeployedAt: z.string(),
  liveState: z.string().optional(),
  livePublicIp: z.string().nullable().optional(),
});
export type DeploymentSummaryDto = z.infer<typeof DeploymentSummaryDtoSchema>;

// ---------- Domain health checks ----------

export const DomainCheckDtoSchema = z.object({
  name: z.string(),
  checks: z.object({
    dns: z.object({
      ok: z.boolean(),
      resolvedIp: z.string().nullable(),
      expectedIp: z.string(),
      matches: z.boolean(),
    }),
    tls: z.object({
      ok: z.boolean(),
      valid: z.boolean(),
      expiresAt: z.string().nullable(),
      daysRemaining: z.number().nullable(),
    }),
    nginx: z.object({
      ok: z.boolean(),
      active: z.boolean(),
      configValid: z.boolean(),
    }),
    upstream: z.object({
      ok: z.boolean(),
      httpStatus: z.number().nullable(),
    }),
    https: z.object({
      ok: z.boolean(),
      httpStatus: z.number().nullable(),
    }),
  }),
});
export type DomainCheckDto = z.infer<typeof DomainCheckDtoSchema>;

// ---------- Status (GET /api/deployments/:name) ----------

export const InstanceStatusDtoSchema = z.object({
  state: z.enum([
    'pending', 'running', 'shutting-down', 'stopping',
    'stopped', 'terminated', 'unknown',
  ]),
  publicIp: z.string().nullable(),
});

export const StatusPayloadDtoSchema = z.object({
  name: z.string(),
  found: z.boolean(),
  stored: z.object({
    cloud: z.enum(['aws', 'gcp']),
    region: z.string(),
    instance_ip: z.string(),
    last_config_hash: z.string(),
    last_nix_hash: z.string(),
    last_deployed_at: z.string(),
    health: z.enum(['healthy', 'unhealthy', 'unknown']),
    ssh_key_path: z.string(),
    age_key_path: z.string(),
    hermes_agent_version: z.object({
      lockedRev: z.string(),
      lockedDate: z.string(),
      lockedTag: z.string().optional(),
    }).optional(),
  }).optional(),
  live: InstanceStatusDtoSchema.optional(),
  domain: DomainCheckDtoSchema.optional(),
});
export type StatusPayloadDto = z.infer<typeof StatusPayloadDtoSchema>;

// ---------- Update checks (GET /api/updates) ----------

export const UpdateCheckResponseDtoSchema = z.object({
  hermesDeploy: z.object({
    current: z.string(),
    latest: z.string(),
    updateAvailable: z.boolean(),
  }),
  hermesAgent: z.object({
    latest: z.object({
      tag: z.string(),
      name: z.string(),
      publishedAt: z.string(),
      body: z.string(),
    }).nullable(),
  }),
});
export type UpdateCheckResponseDto = z.infer<typeof UpdateCheckResponseDtoSchema>;

// ---------- Request bodies ----------

export const UpRequestSchema = z.object({
  projectPath: z.string().min(1),
});

export const UpdateRequestSchema = z.object({
  projectPath: z.string().min(1).optional(),
});

export const DestroyRequestSchema = z.object({
  confirm: z.literal(true),
});

export const AdoptRequestSchema = z.object({
  projectPath: z.string().min(1),
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

export const InitRequestSchema = z.object({
  dir: z.string().min(1),
  name: z.string().min(1).optional(),
});

export const SecretSetRequestSchema = z.object({
  value: z.string(),
});

export const KeyImportRequestSchema = z.object({
  path: z.string().min(1),
});
