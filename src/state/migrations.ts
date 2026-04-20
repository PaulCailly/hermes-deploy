export const CURRENT_SCHEMA_VERSION = 4;

/**
 * Forward migration functions keyed by TARGET version.
 * `migrations[N]` accepts state at version N-1 and returns state at
 * version N.
 *
 * M2 ships with one scaffolded migration (v0 → v1) that covers a
 * synthetic v0 shape. The scaffold exists so M3/M4 schema evolutions
 * have a proven runner to plug into, not because v0 ever shipped
 * publicly. The shape M3 is most likely to introduce is the
 * hermes.toml schema redesign that maps to upstream's actual
 * services.hermes-agent.{settings,environmentFiles,documents,mcpServers}
 * options — when that lands, write `migrations[2]` and bump
 * CURRENT_SCHEMA_VERSION.
 */
const migrations: Record<number, (input: unknown) => unknown> = {
  1: (input: unknown) => {
    const src = input as {
      schema_version?: number;
      deployments?: unknown;
    };

    // Synthetic v0 shape: no schema_version, deployments is a flat array
    // with per-entry `name` and a separate `aws`/`gcp` field instead of
    // the v1 cloud_resources discriminated union.
    if (src.schema_version === undefined && Array.isArray(src.deployments)) {
      const out: Record<string, unknown> = {};
      for (const entry of src.deployments as any[]) {
        const { name, aws, gcp, last_deployed, ...rest } = entry;
        const cloud_resources = aws ?? gcp ?? {};
        out[name] = {
          ...rest,
          last_deployed_at: last_deployed ?? new Date(0).toISOString(),
          created_at: last_deployed ?? new Date(0).toISOString(),
          last_config_hash: 'sha256:migrated',
          ssh_key_path: rest.ssh_key_path ?? '/unknown',
          age_key_path: rest.age_key_path ?? '/unknown',
          health: rest.health ?? 'unknown',
          instance_ip: rest.instance_ip ?? '0.0.0.0',
          cloud_resources: {
            ...cloud_resources,
            region: cloud_resources.region ?? entry.region ?? 'unknown',
          },
        };
      }
      return { schema_version: 1, deployments: out };
    }

    // Already v1 — no-op
    if (src.schema_version === 1) return src;

    throw new Error(`cannot migrate to v1 from unrecognized input shape`);
  },
  2: (input: unknown) => {
    // M3 schema migration: the state file shape itself is unchanged
    // between v1 and v2. Only the user-facing hermes.toml shape changed.
    // The deployment metadata (cloud_resources, ssh_key_path, etc.) is
    // identical, so this migration just bumps the schema_version field.
    // User-file migration (hermes.toml v1 → v2) is manual; see
    // docs/migrating-from-m2.md.
    const v1 = input as { schema_version: number; deployments: Record<string, unknown> };
    return { ...v1, schema_version: 2 };
  },
  3: (input: unknown) => {
    // M4 schema migration: adds last_nix_hash to each deployment.
    // Defaults to 'sha256:unknown' so the first update after upgrading
    // will always run nixos-rebuild (safe — rebuilding with the same
    // config is idempotent).
    const v2 = input as { schema_version: number; deployments: Record<string, unknown> };
    const deployments: Record<string, unknown> = {};
    for (const [name, dep] of Object.entries(v2.deployments)) {
      deployments[name] = { last_nix_hash: 'sha256:unknown', ...(dep as object) };
    }
    return { ...v2, schema_version: 3, deployments };
  },
  4: (input: unknown) => {
    // v4 schema migration: adds hermes_agent_rev and hermes_agent_tag to
    // each deployment to track which version of hermes-agent is deployed.
    // hermes_agent_rev defaults to 'unknown' (git SHA not yet fetched),
    // hermes_agent_tag defaults to '' (no matched release tag).
    const v3 = input as { schema_version: number; deployments: Record<string, unknown> };
    const deployments: Record<string, unknown> = {};
    for (const [name, dep] of Object.entries(v3.deployments)) {
      deployments[name] = { hermes_agent_rev: 'unknown', hermes_agent_tag: '', ...(dep as object) };
    }
    return { ...v3, schema_version: 4, deployments };
  },
};

/**
 * Run forward migrations until the input reaches CURRENT_SCHEMA_VERSION.
 * Throws if the input claims a version newer than the CLI knows about
 * (means the user is running an older binary against state written by a
 * newer one — they should upgrade the CLI before continuing).
 */
export function runMigrations(input: unknown): unknown {
  const current = input as { schema_version?: number };
  const startVersion =
    typeof current.schema_version === 'number' ? current.schema_version : 0;

  if (startVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `state file schema_version=${startVersion} is newer than CLI version (${CURRENT_SCHEMA_VERSION}) — upgrade hermes-deploy`,
    );
  }

  let result: unknown = current;
  for (let target = startVersion + 1; target <= CURRENT_SCHEMA_VERSION; target++) {
    const migration = migrations[target];
    if (!migration) {
      throw new Error(`missing migration to v${target}`);
    }
    result = migration(result);
  }

  return result;
}
