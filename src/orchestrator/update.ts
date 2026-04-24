import { existsSync, readFileSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { loadHermesToml } from '../schema/load.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import { computeConfigHash } from '../state/hash.js';
import { createPlainReporter, type Reporter } from './reporter.js';
import { uploadAndRebuild, recordConfigAndHealthcheck, validateProjectFiles, uploadProfileFiles, computeProfileHash } from './shared.js';
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
  // Include profile files in the top-level hash so profile-only edits
  // are not falsely treated as no-op.
  const profileFilePaths = config.hermes.profiles.flatMap(p => [
    pathResolve(deployment.project_path, p.config_file),
    pathResolve(deployment.project_path, p.secrets_file),
    ...Object.values(p.documents).map(d => pathResolve(deployment.project_path, d)),
  ]);
  const newHash = computeConfigHash(
    [
      tomlPath,
      pathResolve(deployment.project_path, config.hermes.config_file),
      pathResolve(deployment.project_path, config.hermes.secrets_file),
      config.hermes.nix_extra
        ? pathResolve(deployment.project_path, config.hermes.nix_extra)
        : '',
      ...documentPaths,
      ...profileFilePaths,
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
    hasDomain: !!config.domain,
  };
  const ledger: ResourceLedger =
    deployment.cloud === 'aws'
      ? { kind: 'aws', resources: { ...deployment.cloud_resources } }
      : { kind: 'gcp', resources: { ...deployment.cloud_resources } };
  await opts.provider.reconcileNetwork(ledger, rules);
  reporter.phaseDone('provision');

  // === Domain DNS reconciliation ===
  if (config.domain && opts.provider.upsertDnsRecord) {
    // If the domain name changed, delete the old record first
    if (deployment.domain_name && deployment.domain_name !== config.domain.name && deployment.dns_record_id && opts.provider.deleteDnsRecord) {
      const oldParts = (deployment.dns_record_id).split('/');
      const oldZoneId = oldParts[0];
      const oldFqdn = oldParts.slice(1).join('/');
      if (oldZoneId && oldFqdn) {
        try {
          await opts.provider.deleteDnsRecord({ zoneId: oldZoneId, fqdn: oldFqdn }, deployment.instance_ip);
        } catch {
          // Best-effort cleanup of old record
        }
      }
    }
    reporter.phaseStart('dns', `Configuring DNS: ${config.domain.name} → ${deployment.instance_ip}`);
    const dnsRecord = await opts.provider.upsertDnsRecord(config.domain.name, deployment.instance_ip);
    await store.update(state => {
      const d = state.deployments[opts.deploymentName]!;
      d.domain_name = config.domain!.name;
      d.dns_record_id = `${dnsRecord.zoneId}/${dnsRecord.fqdn}`;
    });
    reporter.phaseDone('dns');
  } else if (!config.domain && deployment.domain_name && opts.provider.deleteDnsRecord) {
    // Domain was removed from config
    reporter.phaseStart('dns', `Removing DNS record for ${deployment.domain_name}`);
    const parts = (deployment.dns_record_id ?? '').split('/');
    const zoneId = parts[0];
    const fqdn = parts.slice(1).join('/');
    if (zoneId && fqdn) {
      await opts.provider.deleteDnsRecord({ zoneId, fqdn }, deployment.instance_ip);
    }
    await store.update(state => {
      const d = state.deployments[opts.deploymentName]!;
      d.domain_name = undefined;
      d.dns_record_id = undefined;
    });
    reporter.phaseDone('dns');
  }

  // === Network-only optimization ===
  // If the nix-relevant files (config_file, secrets_file, nix_extra,
  // documents) haven't changed since the last successful rebuild, the
  // network reconciliation above was all that was needed. Skip the
  // expensive SSH + nixos-rebuild step.
  // Include domain config as extra data in the nix hash because [domain]
  // affects the generated configuration.nix (nginx/ACME). Without this,
  // changing upstream_port or adding/removing [domain] would skip
  // nixos-rebuild. We serialize just the domain config rather than
  // including the full hermes.toml, so network-only changes (like
  // ssh_allowed_from) still skip the rebuild correctly.
  const domainExtra = config.domain
    ? JSON.stringify({ name: config.domain.name, upstream_port: config.domain.upstream_port })
    : '';
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
    domainExtra,
  );
  if (nixHash === deployment.last_nix_hash) {
    // Nix config unchanged — skip nixos-rebuild. But still sync profiles
    // if any profile files changed (profiles don't affect NixOS config).
    const storedHashes = deployment.profile_hashes ?? {};
    const profileHashMap = new Map(
      config.hermes.profiles.map(p => [p.name, computeProfileHash(deployment.project_path, p)]),
    );
    const changedProfiles = config.hermes.profiles.filter(p => profileHashMap.get(p.name) !== storedHashes[p.name]);

    if (changedProfiles.length > 0) {
      reporter.log(`Uploading ${changedProfiles.length} changed profile(s)...`);
      const profileSession = await opts.sessionFactory(deployment.instance_ip, readFileSync(deployment.ssh_key_path, 'utf-8'));
      try {
        for (const profile of changedProfiles) {
          reporter.log(`  Profile: ${profile.name}`);
          await uploadProfileFiles({
            session: profileSession,
            projectDir: deployment.project_path,
            profile,
            reporter,
          });
          const restartResult = await profileSession.exec(
            `su - hermes -s /bin/sh -c "hermes -p ${profile.name} gateway restart" 2>&1`,
          );
          if (restartResult.exitCode !== 0) {
            reporter.log(`  Warning: gateway restart failed for profile "${profile.name}" (exit ${restartResult.exitCode}): ${restartResult.stdout.trim()}`);
          }
        }
      } finally {
        await profileSession.dispose();
      }
    }

    // Always persist profile hashes to prune removed profiles
    const hashes: Record<string, string> = {};
    for (const [name, hash] of profileHashMap) hashes[name] = hash;
    await store.update(state => {
      state.deployments[opts.deploymentName]!.profile_hashes = hashes;
    });

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
    // Read the SSH public key so the generated configuration.nix bakes
    // it into users.users.root.openssh.authorizedKeys.keys. Without this,
    // nixos-rebuild removes the guest-agent-managed authorized key and
    // root SSH access is lost on GCE (and harmlessly redundant on AWS).
    const sshPubKeyPath = `${deployment.ssh_key_path}.pub`;
    const sshPublicKey = existsSync(sshPubKeyPath) ? readFileSync(sshPubKeyPath, 'utf-8').trim() : undefined;
    const rebuildResult = await uploadAndRebuild({
      session,
      sessionFactory: () => opts.sessionFactory(deployment.instance_ip, readFileSync(deployment.ssh_key_path, 'utf-8')),
      projectDir: deployment.project_path,
      config,
      ageKeyPath: deployment.age_key_path,
      sshPublicKey,
      reporter,
    });
    reporter.phaseDone('bootstrap');

    // === Phase 5 — healthcheck and state update ===
    // Create a fresh session — the original may be dead if sshd restarted
    // during the rebuild (GCE consistently drops the connection).
    reporter.phaseStart('healthcheck', 'Waiting for hermes-agent.service');
    const freshSession = await opts.sessionFactory(deployment.instance_ip, readFileSync(deployment.ssh_key_path, 'utf-8'));
    const health = await recordConfigAndHealthcheck({
      session: freshSession,
      store,
      deploymentName: opts.deploymentName,
      projectDir: deployment.project_path,
      tomlPath,
      config,
      healthcheckTimeoutMs: opts.healthcheckTimeoutMs,
      hermesAgentRev: rebuildResult.lockedRev,
    });

    if (health.health === 'unhealthy') {
      reporter.phaseFail('healthcheck', 'service is not active');
      for (const line of health.journalTail) reporter.log(line);
      return { health: 'unhealthy', publicIp: deployment.instance_ip, skipped: false };
    }
    reporter.phaseDone('healthcheck');

    // === Phase 5.5 — upload changed profile files ===
    const storedHashes = deployment.profile_hashes ?? {};
    const profileHashMap = new Map(
      config.hermes.profiles.map(p => [p.name, computeProfileHash(deployment.project_path, p)]),
    );
    const changedProfiles = config.hermes.profiles.filter(p => profileHashMap.get(p.name) !== storedHashes[p.name]);

    if (changedProfiles.length > 0) {
      reporter.log(`Uploading ${changedProfiles.length} changed profile(s)...`);
      for (const profile of changedProfiles) {
        reporter.log(`  Profile: ${profile.name}`);
        await uploadProfileFiles({
          session: freshSession,
          projectDir: deployment.project_path,
          profile,
          reporter,
        });
        // Restart gateway for this profile if config changed
        const restartResult = await freshSession.exec(
          `su - hermes -s /bin/sh -c "hermes -p ${profile.name} gateway restart" 2>&1`,
        );
        if (restartResult.exitCode !== 0) {
          reporter.log(`  Warning: gateway restart failed for profile "${profile.name}" (exit ${restartResult.exitCode}): ${restartResult.stdout.trim()}`);
        }
      }
    }
    // Replace profile_hashes entirely (prunes removed profiles)
    const hashes: Record<string, string> = {};
    for (const [name, hash] of profileHashMap) hashes[name] = hash;
    await store.update(state => {
      state.deployments[opts.deploymentName]!.profile_hashes = hashes;
    });

    reporter.success(`${opts.deploymentName} updated`);
    return { health: 'healthy', publicIp: deployment.instance_ip, skipped: false };
  } finally {
    try { await session.dispose(); } catch {}
  }
}
