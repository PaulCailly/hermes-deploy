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

// [[hermes.cron]] — declarative scheduled jobs (cron-as-code). Each entry
// is reconciled onto the box's hermes-agent cron scheduler on deploy:
// hermes-deploy creates jobs that are new, edits ones whose declarative
// fields drift, and DELETES box jobs that are no longer declared here.
// The config is authoritative — a cron removed from this file is removed
// from the box. `name` is the reconciliation key (stable, unique).
const CronSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, {
      message: 'cron.name must be a safe identifier (alphanumeric, ".", "_", "-")',
    }),
  // A standard 5- or 6-field cron expression, e.g. "45 5 * * 1-5". Stored
  // by hermes-agent verbatim as schedule.expr, so it round-trips exactly.
  // Shorthand forms ("30m", "every 2h") are intentionally NOT accepted:
  // hermes-agent normalises them ("every 2h" → "every 120m", "30m" → a
  // one-shot relative timestamp), so reconciliation could never compare
  // them reliably and would thrash or reschedule one-shot jobs.
  schedule: z
    .string()
    .regex(/^\s*\S+(?:\s+\S+){4,5}\s*$/, {
      message: 'cron.schedule must be a 5- or 6-field cron expression (e.g. "45 5 * * 1-5"); shorthand like "30m" is not supported',
    }),
  prompt: z.string().min(1).optional(),
  // Skills to attach (assembled into the run context by the agent).
  skills: z.array(z.string().min(1)).default([]),
  // Delivery target: "origin" | "local" | "telegram" | "discord" |
  // "signal" | "platform:chat_id" (e.g. "discord:1040693401420570704").
  deliver: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  repeat: z.number().int().positive().optional(),
  script: z.string().min(1).optional(),
  workdir: z.string().min(1).optional(),
});

export type CronConfig = z.infer<typeof CronSchema>;

// [hermes.watchdog] — gateway-health watchdog (systemd oneshot + timer on
// the box). The upstream module's Restart=always covers process crashes;
// this covers the zombie case observed 2026-08-31: process alive but the
// Discord gateway websocket stuck in discord.py's resume loop against a
// dead session host (WSServerHandshakeError 503 forever, backoff ~15min).
// The watchdog restarts hermes-agent when handshake failures appear in the
// journal within `window_min`, at most once per `cooldown_min`. During a
// real Discord outage restarts are bounded by the cooldown and guarantee
// recovery at most one cooldown after Discord heals.
const WatchdogSchema = z.object({
  enabled: z.boolean().default(true),
  // Timer cadence — how often the check runs.
  interval_min: z.number().int().min(1).max(60).default(5),
  // Journal lookback — a handshake failure within this window marks the
  // gateway as stuck. Keep it >= the largest reconnect backoff (~17 min
  // observed) divided by two, or sparse failures slip between checks.
  window_min: z.number().int().min(1).max(120).default(15),
  // Minimum gap between watchdog-initiated restarts.
  cooldown_min: z.number().int().min(1).max(1440).default(30),
}).refine(w => w.cooldown_min >= w.window_min, {
  message:
    'watchdog.cooldown_min must be >= window_min — the journal keeps pre-restart ' +
    'handshake failures visible for window_min, so a shorter cooldown retriggers ' +
    'an immediate second restart',
  path: ['cooldown_min'],
});

export type WatchdogConfig = z.infer<typeof WatchdogSchema>;

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
    // Optional (NOT defaulted): absence means "hermes-deploy does not manage
    // this box's crons" (runtime-created jobs are left alone). Declaring the
    // section — even as an empty array — opts into authoritative management,
    // where an empty array deletes every job on the box.
    cron: z.array(CronSchema).optional(),
    // Optional: absence means no watchdog units are generated.
    watchdog: WatchdogSchema.optional(),
  })
  .refine(
    h => {
      const names = h.profiles.map(p => p.name);
      return new Set(names).size === names.length;
    },
    { message: 'Duplicate profile names are not allowed', path: ['profiles'] },
  )
  .refine(
    h => {
      const names = (h.cron ?? []).map(c => c.name);
      return new Set(names).size === names.length;
    },
    { message: 'Duplicate cron names are not allowed', path: ['cron'] },
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
