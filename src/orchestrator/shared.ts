import { existsSync, readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import {
  generateConfigurationNix,
  generateFlakeNix,
  generateHermesNix,
} from '../nix-gen/generate.js';
import { runNixosRebuild } from '../remote-ops/nixos-rebuild.js';
import { pollHermesHealth } from '../remote-ops/healthcheck.js';
import { computeConfigHash } from '../state/hash.js';
import { StateStore } from '../state/store.js';
import { HermesTomlError } from '../schema/load.js';
import type { SshSession } from '../remote-ops/session.js';
import type { HermesTomlConfig } from '../schema/hermes-toml.js';
import type { Reporter } from './reporter.js';

/**
 * Pre-flight check that every file referenced from hermes.toml exists
 * on disk before any cloud calls happen. Throws HermesTomlError with
 * a clear message at the missing path. Called from Phase 1 of both
 * runDeploy and runUpdate so users see "secrets_file not found: ..."
 * BEFORE we provision an EC2 instance, not 10 minutes later inside
 * uploadAndRebuild.
 *
 * Validates: config_file, secrets_file, every [hermes.documents] value,
 * and nix_extra (when set).
 */
export function validateProjectFiles(projectDir: string, config: HermesTomlConfig): void {
  const checks: Array<{ field: string; path: string }> = [
    { field: 'config_file', path: pathResolve(projectDir, config.hermes.config_file) },
    { field: 'secrets_file', path: pathResolve(projectDir, config.hermes.secrets_file) },
  ];
  for (const [docName, relPath] of Object.entries(config.hermes.documents)) {
    checks.push({
      field: `documents."${docName}"`,
      path: pathResolve(projectDir, relPath),
    });
  }
  if (config.hermes.nix_extra) {
    checks.push({
      field: 'nix_extra',
      path: pathResolve(projectDir, config.hermes.nix_extra),
    });
  }

  for (const check of checks) {
    if (!existsSync(check.path)) {
      throw new HermesTomlError(`${check.field} not found: ${check.path}`);
    }
  }
}

export interface BootstrapArgs {
  session: SshSession;
  projectDir: string;
  config: HermesTomlConfig;
  ageKeyPath: string;
  reporter: Reporter;
}

/**
 * Phase 4 — generate the four nix/secrets files locally, SCP them to
 * /etc/nixos and /var/lib/sops-nix on the box, then run nixos-rebuild
 * switch via the flake. Throws on rebuild failure with the captured
 * tail in the message.
 *
 * Both `runDeploy` and `runUpdate` call this — same upload + rebuild
 * mechanics, only the surrounding context (provision vs reconcile)
 * differs between them.
 */
export async function uploadAndRebuild(args: BootstrapArgs): Promise<void> {
  const { session, projectDir, config, ageKeyPath, reporter } = args;
  const flakeNix = generateFlakeNix();
  const configurationNix = generateConfigurationNix(config);
  const hermesNix = generateHermesNix(config);
  const ageKeyContent = readFileSync(ageKeyPath, 'utf-8');

  // Upload the static files
  await session.uploadFile('/etc/nixos/flake.nix', flakeNix);
  await session.uploadFile('/etc/nixos/configuration.nix', configurationNix);
  await session.uploadFile('/etc/nixos/hermes.nix', hermesNix);

  // Upload the user's config.yaml verbatim
  const configYamlContent = readFileSync(pathResolve(projectDir, config.hermes.config_file));
  await session.uploadFile('/etc/nixos/config.yaml', configYamlContent);

  // Upload the encrypted secrets file
  const secretsContent = readFileSync(pathResolve(projectDir, config.hermes.secrets_file));
  await session.uploadFile('/etc/nixos/secrets.env.enc', secretsContent);

  // Upload each [hermes.documents] entry to /etc/nixos/<filename>
  for (const [filename, relPath] of Object.entries(config.hermes.documents)) {
    const docContent = readFileSync(pathResolve(projectDir, relPath));
    await session.uploadFile('/etc/nixos/' + filename, docContent);
  }

  // Upload the optional nix_extra file
  if (config.hermes.nix_extra) {
    const extraContent = readFileSync(pathResolve(projectDir, config.hermes.nix_extra));
    await session.uploadFile('/etc/nixos/hermes.extra.nix', extraContent);
  }

  // sops-nix creates /var/lib/sops-nix on activation, but we need the
  // dir to exist before SFTP can drop the age key there on the very
  // first rebuild. mkdir -p is idempotent on subsequent deploys.
  await session.exec('mkdir -p /var/lib/sops-nix');
  await session.uploadFile('/var/lib/sops-nix/age.key', ageKeyContent, 0o600);

  const rebuild = await runNixosRebuild(session, (_s, line) => reporter.log(line));
  if (!rebuild.success) {
    throw new Error(`nixos-rebuild failed:\n${rebuild.tail.join('\n')}`);
  }
}

export interface HealthcheckArgs {
  session: SshSession;
  store: StateStore;
  deploymentName: string;
  projectDir: string;
  tomlPath: string;
  config: HermesTomlConfig;
  healthcheckTimeoutMs?: number;
}

/**
 * Phase 5 — write the new last_config_hash + last_deployed_at into the
 * state store FIRST (the new config was successfully applied by
 * nixos-rebuild in Phase 4 — that fact is what `last_config_hash`
 * records, independent of whether the resulting service is healthy),
 * THEN poll the healthcheck and write the result. This ordering is
 * what makes a subsequent `update` correctly short-circuit instead of
 * re-applying the same config in a debug loop after a healthcheck
 * failure.
 *
 * Returns 'healthy' | 'unhealthy'. Caller decides what to do with the
 * unhealthy case (deploy returns it; update logs it).
 */
export async function recordConfigAndHealthcheck(
  args: HealthcheckArgs,
): Promise<{ health: 'healthy' | 'unhealthy'; journalTail: string[] }> {
  const { session, store, deploymentName, projectDir, tomlPath, config, healthcheckTimeoutMs } = args;

  const documentPaths = Object.values(config.hermes.documents).map(p =>
    pathResolve(projectDir, p),
  );

  // Full hash (includes hermes.toml) — used for the top-level no-op check
  // so that ANY change to hermes.toml causes at least network reconciliation.
  const configHash = computeConfigHash(
    [
      tomlPath,
      pathResolve(projectDir, config.hermes.config_file),
      pathResolve(projectDir, config.hermes.secrets_file),
      config.hermes.nix_extra ? pathResolve(projectDir, config.hermes.nix_extra) : '',
      ...documentPaths,
    ].filter(Boolean),
    true,
  );

  // Nix-only hash (excludes hermes.toml) — used by the network-only
  // optimization in runUpdate to skip nixos-rebuild when only network
  // rules changed.
  const nixHash = computeConfigHash(
    [
      pathResolve(projectDir, config.hermes.config_file),
      pathResolve(projectDir, config.hermes.secrets_file),
      config.hermes.nix_extra ? pathResolve(projectDir, config.hermes.nix_extra) : '',
      ...documentPaths,
    ].filter(Boolean),
    true,
  );

  await store.update(state => {
    const d = state.deployments[deploymentName]!;
    d.last_config_hash = configHash;
    d.last_nix_hash = nixHash;
    d.last_deployed_at = new Date().toISOString();
  });

  const health = await pollHermesHealth(session, { timeoutMs: healthcheckTimeoutMs });
  await store.update(state => {
    state.deployments[deploymentName]!.health = health.health;
  });
  return health;
}
