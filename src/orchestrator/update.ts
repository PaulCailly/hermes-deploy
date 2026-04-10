import { readFileSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { loadHermesToml } from '../schema/load.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import { computeConfigHash } from '../state/hash.js';
import { createPlainReporter, type Reporter } from './reporter.js';
import { uploadAndRebuild, recordConfigAndHealthcheck, validateProjectFiles } from './shared.js';
import type { CloudProvider, NetworkRules, ResourceLedger } from '../cloud/core.js';
import type { SshSession } from '../remote-ops/session.js';

export interface UpdateOptions {
  deploymentName: string;
  provider: CloudProvider;
  sessionFactory: (host: string, privateKey: string) => Promise<SshSession>;
  detectPublicIp: () => Promise<string>;
  healthcheckTimeoutMs?: number;
  reporter?: Reporter;
}

export interface UpdateResult {
  health: 'healthy' | 'unhealthy';
  publicIp: string;
  /** True when the config hash matched and we short-circuited (no SSH, no rebuild). */
  skipped: boolean;
}

/**
 * The update flow: re-evaluate the project's hermes.toml + secrets,
 * compare to the recorded config hash, and either short-circuit (no
 * changes) or push the new config to the existing instance via:
 *
 *   1. Validate (load toml, check SOUL exists)
 *   2. Hash + compare → skip if unchanged
 *   3. Reconcile network rules in place (no instance recreation)
 *   4. SSH in, upload + nixos-rebuild via shared helper
 *   5. Healthcheck + state update via shared helper
 *
 * Unlike `runDeploy`, this never calls provider.provision and never
 * regenerates SSH or age keys. The instance, security group, key pair,
 * and elastic IP all stay put. Typical update time on a healthy box:
 * 30-90 seconds (most of which is the rebuild evaluating the flake
 * against the warm /nix/store).
 */
export async function runUpdate(opts: UpdateOptions): Promise<UpdateResult> {
  const reporter = opts.reporter ?? createPlainReporter();
  const paths = getStatePaths();
  const store = new StateStore(paths);
  const state = await store.read();

  const deployment = state.deployments[opts.deploymentName];
  if (!deployment) {
    throw new Error(`deployment "${opts.deploymentName}" not found in state`);
  }

  // === Phase 1 — local validation ===
  reporter.phaseStart('validate', `Validating ${opts.deploymentName}`);
  const tomlPath = join(deployment.project_path, 'hermes.toml');
  const config = loadHermesToml(tomlPath);
  validateProjectFiles(deployment.project_path, config);
  reporter.phaseDone('validate');

  // === Hash short-circuit — no changes means no work ===
  const documentPaths = Object.values(config.hermes.documents).map(p =>
    pathResolve(deployment.project_path, p),
  );
  const newHash = computeConfigHash(
    [
      tomlPath,
      pathResolve(deployment.project_path, config.hermes.config_file),
      pathResolve(deployment.project_path, config.hermes.secrets_file),
      config.hermes.nix_extra
        ? pathResolve(deployment.project_path, config.hermes.nix_extra)
        : '',
      ...documentPaths,
    ].filter(Boolean),
    true,
  );
  if (newHash === deployment.last_config_hash) {
    reporter.success(`no changes — ${opts.deploymentName} is already up-to-date`);
    return {
      health: deployment.health === 'healthy' ? 'healthy' : 'unhealthy',
      publicIp: deployment.instance_ip,
      skipped: true,
    };
  }

  // === Phase 2 — reconcile network rules in place ===
  reporter.phaseStart('provision', 'Reconciling network rules');
  const sshAllowedFrom =
    config.network.ssh_allowed_from === 'auto'
      ? await opts.detectPublicIp()
      : config.network.ssh_allowed_from;
  const rules: NetworkRules = {
    sshAllowedFrom,
    inboundPorts: config.network.inbound_ports,
  };
  const ledger: ResourceLedger =
    deployment.cloud === 'aws'
      ? { kind: 'aws', resources: { ...deployment.cloud_resources } }
      : { kind: 'gcp', resources: { ...deployment.cloud_resources } };
  await opts.provider.reconcileNetwork(ledger, rules);
  reporter.phaseDone('provision');

  // === Network-only optimization ===
  // If the nix-relevant files (config_file, secrets_file, nix_extra,
  // documents) haven't changed since the last successful rebuild, the
  // network reconciliation above was all that was needed. Skip the
  // expensive SSH + nixos-rebuild step.
  const nixHash = computeConfigHash(
    [
      pathResolve(deployment.project_path, config.hermes.config_file),
      pathResolve(deployment.project_path, config.hermes.secrets_file),
      config.hermes.nix_extra
        ? pathResolve(deployment.project_path, config.hermes.nix_extra)
        : '',
      ...documentPaths,
    ].filter(Boolean),
    true,
  );
  if (nixHash === deployment.last_nix_hash) {
    reporter.success(`network rules updated — ${opts.deploymentName} config unchanged`);
    return {
      health: deployment.health === 'healthy' ? 'healthy' : 'unhealthy',
      publicIp: deployment.instance_ip,
      skipped: false,
    };
  }

  // === Phase 4 — bootstrap (SSH + upload + rebuild) ===
  reporter.phaseStart('bootstrap', 'Uploading config and running nixos-rebuild');
  const privateKeyContent = readFileSync(deployment.ssh_key_path, 'utf-8');
  const session = await opts.sessionFactory(deployment.instance_ip, privateKeyContent);
  try {
    await uploadAndRebuild({
      session,
      projectDir: deployment.project_path,
      config,
      ageKeyPath: deployment.age_key_path,
      reporter,
    });
    reporter.phaseDone('bootstrap');

    // === Phase 5 — healthcheck and state update ===
    reporter.phaseStart('healthcheck', 'Waiting for hermes-agent.service');
    const health = await recordConfigAndHealthcheck({
      session,
      store,
      deploymentName: opts.deploymentName,
      projectDir: deployment.project_path,
      tomlPath,
      config,
      healthcheckTimeoutMs: opts.healthcheckTimeoutMs,
    });

    if (health.health === 'unhealthy') {
      reporter.phaseFail('healthcheck', 'service is not active');
      for (const line of health.journalTail) reporter.log(line);
      return { health: 'unhealthy', publicIp: deployment.instance_ip, skipped: false };
    }
    reporter.phaseDone('healthcheck');
    reporter.success(`${opts.deploymentName} updated`);
    return { health: 'healthy', publicIp: deployment.instance_ip, skipped: false };
  } finally {
    await session.dispose();
  }
}
