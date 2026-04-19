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
      hasDomain: !!config.domain,
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

  // === Phase 2.5 — DNS ===
  if (config.domain && opts.provider.upsertDnsRecord) {
    reporter.phaseStart('dns', `Configuring DNS: ${config.domain.name} → ${instance.publicIp}`);
    const dnsRecord = await opts.provider.upsertDnsRecord(config.domain.name, instance.publicIp);
    await store.update(state => {
      const d = state.deployments[config.name]!;
      d.domain_name = config.domain!.name;
      d.dns_record_id = `${dnsRecord.zoneId}/${dnsRecord.fqdn}`;
    });
    reporter.phaseDone('dns');
  }

  // === Phase 3 — wait for SSH ===
  reporter.phaseStart('wait-ssh', `Waiting for SSH on ${instance.publicIp}`);
  await opts.waitSsh(instance.publicIp);
  reporter.phaseDone('wait-ssh');

  // === Phase 3.5 (GCP only) — nixos-infect ===
  // nixos-cloud images are not publicly usable (403 on compute.images.useReadOnly).
  // The standard workaround is to boot Debian, then run nixos-infect to convert to
  // NixOS. This step is skipped on AWS (which uses community NixOS AMIs directly).
  if (config.cloud.provider === 'gcp') {
    reporter.phaseStart('bootstrap', 'Converting Debian to NixOS via nixos-infect (~5 min)');
    // The Debian startup script restarts sshd after enabling root login.
    // waitSsh may return before the restart completes, so retry the
    // session creation a few times on ECONNREFUSED.
    let infectSession: import('../remote-ops/session.js').SshSession | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        infectSession = await opts.sessionFactory(instance.publicIp, readFileSync(sshKeyPath, 'utf-8'));
        break;
      } catch (e) {
        if (attempt >= 9) throw e;
        reporter.log(`  (SSH not ready, retrying in 3s... attempt ${attempt + 1}/10)`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    if (!infectSession) throw new Error('Failed to connect for nixos-infect');
    try {
      reporter.log('Running nixos-infect...');
      const infectResult = await infectSession.execStream(
        'curl -L https://raw.githubusercontent.com/elitak/nixos-infect/master/nixos-infect | NIX_CHANNEL=nixos-25.11 bash -x 2>&1',
        (_s, line) => reporter.log(line),
      );
      if (infectResult.exitCode !== 0) {
        throw new Error(`nixos-infect failed with exit code ${infectResult.exitCode}`);
      }
    } finally {
      await infectSession.dispose();
    }

    // nixos-infect reboots the system. Wait for SSH to come back up.
    // The host key changes (new NixOS system), so ssh2's strict host
    // checking is already off (UserKnownHostsFile=/dev/null in ssh.ts).
    reporter.log('Waiting for NixOS to boot after nixos-infect...');
    await opts.waitSsh(instance.publicIp);
    reporter.phaseDone('bootstrap');
    reporter.phaseStart('bootstrap', 'Uploading config and running nixos-rebuild');
  } else {
    reporter.phaseStart('bootstrap', 'Uploading config and running nixos-rebuild');
  }

  // === Phase 4 — bootstrap NixOS configuration ===
  const privateKeyContent = readFileSync(sshKeyPath, 'utf-8');
  const session = await opts.sessionFactory(instance.publicIp, privateKeyContent);
  try {
    await uploadAndRebuild({
      session,
      sessionFactory: () => opts.sessionFactory(instance.publicIp, readFileSync(sshKeyPath, 'utf-8')),
      projectDir: opts.projectDir,
      config,
      ageKeyPath,
      sshPublicKey: sshPublicKey,
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
