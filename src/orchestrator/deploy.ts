import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHermesToml } from '../schema/load.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import type { CloudProvider, ProvisionSpec, ResourceLedger } from '../cloud/core.js';
import type { SshSession } from '../remote-ops/session.js';
import { createPlainReporter, type Reporter } from './reporter.js';
import { uploadAndRebuild, recordConfigAndHealthcheck, validateProjectFiles } from './shared.js';

export interface DeployOptions {
  projectDir: string;
  provider: CloudProvider;
  sessionFactory: (host: string, privateKey: string) => Promise<SshSession>;
  detectPublicIp: () => Promise<string>;
  sshKeyGenerator: (path: string) => Promise<{ publicKey: string; privateKeyPath: string; publicKeyPath: string }>;
  ageKeyGenerator: (path: string) => Promise<{ publicKey: string; privateKeyPath: string }>;
  sopsBootstrap: (projectDir: string, agePublicKey: string) => Promise<void>;
  waitSsh: (host: string) => Promise<void>;
  healthcheckTimeoutMs?: number;
  reporter?: Reporter;
}

export interface DeployResult {
  health: 'healthy' | 'unhealthy';
  publicIp: string;
}

export async function runDeploy(opts: DeployOptions): Promise<DeployResult> {
  const reporter = opts.reporter ?? createPlainReporter();
  const paths = getStatePaths();
  const store = new StateStore(paths);

  // === Phase 1 — local validation ===
  reporter.phaseStart('validate', 'Validating project configuration');
  const tomlPath = join(opts.projectDir, 'hermes.toml');
  const config = loadHermesToml(tomlPath);
  validateProjectFiles(opts.projectDir, config);
  reporter.phaseDone('validate');

  // === Phase 1.5 — ensure SSH and age keys exist ===
  reporter.phaseStart('ensure-keys', 'Preparing SSH and age keys');
  const sshKeyPath = paths.sshKeyForDeployment(config.name);
  const ageKeyPath = paths.ageKeyForDeployment(config.name);

  let sshPublicKey: string;
  if (existsSync(sshKeyPath)) {
    sshPublicKey = readFileSync(`${sshKeyPath}.pub`, 'utf-8').trim();
  } else {
    const ssh = await opts.sshKeyGenerator(sshKeyPath);
    sshPublicKey = ssh.publicKey;
  }

  let agePublicKey: string;
  if (existsSync(ageKeyPath)) {
    const content = readFileSync(ageKeyPath, 'utf-8');
    const m = content.match(/^# public key: (age1[a-z0-9]+)$/m);
    if (!m) throw new Error(`could not read age public key from ${ageKeyPath}`);
    agePublicKey = m[1]!;
  } else {
    const age = await opts.ageKeyGenerator(ageKeyPath);
    agePublicKey = age.publicKey;
  }

  await opts.sopsBootstrap(opts.projectDir, agePublicKey);
  reporter.phaseDone('ensure-keys');

  // === Phase 2 — provision ===
  reporter.phaseStart('provision', 'Provisioning cloud resources');
  const image = config.cloud.image
    ? { id: config.cloud.image, description: 'user-provided image' }
    : await opts.provider.resolveNixosImage({
        region: config.cloud.region,
        zone: config.cloud.zone,
      });
  const sshAllowedFrom =
    config.network.ssh_allowed_from === 'auto'
      ? await opts.detectPublicIp()
      : config.network.ssh_allowed_from;

  const ledger: ResourceLedger = { kind: config.cloud.provider, resources: {} };
  const spec: ProvisionSpec = {
    deploymentName: config.name,
    location: { region: config.cloud.region, zone: config.cloud.zone },
    size: config.cloud.size,
    diskGb: config.cloud.disk_gb,
    image,
    publicSshKey: sshPublicKey,
    networkRules: {
      sshAllowedFrom,
      inboundPorts: config.network.inbound_ports,
    },
  };
  const instance = await opts.provider.provision(spec, ledger);

  // Persist ledger BEFORE SSH bootstrap
  if (ledger.kind === 'aws') {
    await store.update(state => {
      const now = new Date().toISOString();
      state.deployments[config.name] = {
        project_path: opts.projectDir,
        cloud: 'aws',
        region: config.cloud.region,
        created_at: state.deployments[config.name]?.created_at ?? now,
        last_deployed_at: now,
        last_config_hash: 'pending', // updated in phase 5
        last_nix_hash: 'pending',    // updated in phase 5
        ssh_key_path: sshKeyPath,
        age_key_path: ageKeyPath,
        health: 'unknown',
        instance_ip: instance.publicIp,
        cloud_resources: {
          instance_id: ledger.resources.instance_id!,
          security_group_id: ledger.resources.security_group_id!,
          key_pair_name: ledger.resources.key_pair_name!,
          eip_allocation_id: ledger.resources.eip_allocation_id!,
          region: ledger.resources.region!,
        },
      };
    });
  }

  if (ledger.kind === 'gcp') {
    await store.update(state => {
      const now = new Date().toISOString();
      state.deployments[config.name] = {
        project_path: opts.projectDir,
        cloud: 'gcp',
        region: config.cloud.region,
        created_at: state.deployments[config.name]?.created_at ?? now,
        last_deployed_at: now,
        last_config_hash: 'pending', // updated in phase 5
        last_nix_hash: 'pending',    // updated in phase 5
        ssh_key_path: sshKeyPath,
        age_key_path: ageKeyPath,
        health: 'unknown',
        instance_ip: instance.publicIp,
        cloud_resources: {
          instance_name: ledger.resources.instance_name!,
          static_ip_name: ledger.resources.static_ip_name!,
          firewall_rule_names: ledger.resources.firewall_rule_names!,
          project_id: ledger.resources.project_id!,
          zone: ledger.resources.zone!,
        },
      };
    });
  }
  reporter.phaseDone('provision');

  // === Phase 3 — wait for SSH ===
  reporter.phaseStart('wait-ssh', `Waiting for SSH on ${instance.publicIp}`);
  await opts.waitSsh(instance.publicIp);
  reporter.phaseDone('wait-ssh');

  // === Phase 4 — bootstrap NixOS configuration ===
  reporter.phaseStart('bootstrap', 'Uploading config and running nixos-rebuild');
  const privateKeyContent = readFileSync(sshKeyPath, 'utf-8');
  const session = await opts.sessionFactory(instance.publicIp, privateKeyContent);
  try {
    await uploadAndRebuild({
      session,
      projectDir: opts.projectDir,
      config,
      ageKeyPath,
      reporter,
    });
    reporter.phaseDone('bootstrap');

    // === Phase 5 — healthcheck and state update ===
    reporter.phaseStart('healthcheck', 'Waiting for hermes-agent.service');
    const health = await recordConfigAndHealthcheck({
      session,
      store,
      deploymentName: config.name,
      projectDir: opts.projectDir,
      tomlPath,
      config,
      healthcheckTimeoutMs: opts.healthcheckTimeoutMs,
    });

    if (health.health === 'unhealthy') {
      reporter.phaseFail('healthcheck', 'service is not active');
      for (const line of health.journalTail) reporter.log(line);
      return { health: 'unhealthy', publicIp: instance.publicIp };
    }
    reporter.phaseDone('healthcheck');
    reporter.success(`hermes-agent is running at ${instance.publicIp}`);
    return { health: 'healthy', publicIp: instance.publicIp };
  } finally {
    await session.dispose();
  }
}
