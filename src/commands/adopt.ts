import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadHermesToml } from '../schema/load.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import { createCloudProvider } from '../cloud/factory.js';
import type { Deployment } from '../schema/state-toml.js';
import { findUp } from './find-project.js';

export interface AdoptOptions {
  /**
   * Explicit deployment name. Required: unlike other commands, adopt
   * has nothing to walk up to because the state entry is missing by
   * construction.
   */
  name?: string;
  /**
   * Project directory — either passed via --project or walked up from
   * cwd. Must contain a valid hermes.toml, since we read cloud/region/
   * zone from there (the state we're rebuilding doesn't exist yet).
   */
  projectPath?: string;
  /**
   * If false (default), the command refuses to overwrite an existing
   * state entry. Set via `--force` when the user really does want to
   * replace a corrupted record.
   */
  force?: boolean;
  /**
   * Skip writing to state.toml. Used by `--dry-run` to preview the
   * ledger without persisting anything.
   */
  dryRun?: boolean;
}

export interface AdoptResult {
  name: string;
  cloud: 'aws' | 'gcp';
  region: string;
  publicIp: string | null;
  /**
   * The reconstructed deployment record that was (or would be) written
   * to state.toml. Exposed so the CLI can render a preview and so
   * library consumers can make decisions from the rebuilt ledger
   * without re-reading state.
   */
  deployment: Deployment;
  /** True when the state file was actually written. */
  persisted: boolean;
}

/**
 * Rebuild a state.toml entry for a deployment whose record was lost by
 * searching the configured cloud for resources tagged with the
 * hermes-deploy provenance markers. This is the "I reinstalled my
 * laptop" recovery path.
 *
 * Flow:
 *   1. Resolve the project directory (explicit --project, or walk up
 *      from cwd looking for hermes.toml) and load hermes.toml. We need
 *      `cloud.provider`, `cloud.region`, `cloud.zone`, and
 *      `cloud.profile` to construct the right CloudProvider.
 *   2. Construct the CloudProvider and call `provider.adopt(name)`.
 *      That call uses tag/label filters to find the resources and
 *      rebuild a ResourceLedger. The safety rail is inside the provider:
 *      adoption ONLY returns resources carrying
 *      `managed-by=hermes-deploy` + `hermes-deploy/deployment=<name>`.
 *   3. Check that the per-deployment SSH key and age key still exist
 *      locally (keys live in ~/.config/hermes-deploy/, outside the
 *      state file). If the SSH key is missing, future updates will
 *      fail — warn loudly but don't refuse to adopt. If the age key
 *      is missing, secret operations will fail — same treatment.
 *   4. Write the reconstructed entry to state.toml unless --dry-run.
 *      The existing state entry (if any) is preserved unless --force.
 */
export async function adoptDeployment(opts: AdoptOptions): Promise<AdoptResult> {
  if (!opts.name) {
    throw new Error('adopt requires --name <deployment-name>');
  }
  const name = opts.name;

  // Step 1: find the project directory and load hermes.toml.
  const projectPath =
    opts.projectPath ?? findUp(process.cwd(), 'hermes.toml');
  if (!projectPath) {
    throw new Error(
      'adopt requires a hermes.toml — pass --project <path> or run from inside the project',
    );
  }
  const tomlPath = join(projectPath, 'hermes.toml');
  if (!existsSync(tomlPath)) {
    throw new Error(`no hermes.toml at ${tomlPath}`);
  }
  const config = loadHermesToml(tomlPath);

  if (config.name !== name) {
    throw new Error(
      `hermes.toml name "${config.name}" does not match --name "${name}". Either rename or run adopt from a matching project.`,
    );
  }

  // Step 2: construct the cloud provider and adopt.
  const paths = getStatePaths();
  const provider = createCloudProvider({
    provider: config.cloud.provider,
    region: config.cloud.region,
    zone: config.cloud.zone,
    profile: config.cloud.profile,
    imageCacheFile: paths.imageCacheFile,
  });

  const adopted = await provider.adopt(name);

  // Step 3: check local key material. We don't fail — the user may
  // intend to re-import keys separately via `key import`. But we do
  // surface the situation in the AdoptResult.persisted entry so the
  // CLI can print a warning.
  const sshKeyPath = paths.sshKeyForDeployment(name);
  const ageKeyPath = paths.ageKeyForDeployment(name);

  // Step 4: construct the deployment record.
  const store = new StateStore(paths);
  const state = await store.read();
  const existing = state.deployments[name];

  if (existing && !opts.force) {
    throw new Error(
      `state already has an entry for "${name}". Pass --force to replace it, or --dry-run to preview the rebuilt ledger without writing.`,
    );
  }

  const now = new Date().toISOString();
  const publicIp = adopted.publicIp ?? existing?.instance_ip ?? '0.0.0.0';

  let deployment: Deployment;
  if (adopted.ledger.kind === 'aws') {
    const r = adopted.ledger.resources;
    deployment = {
      project_path: projectPath,
      cloud: 'aws',
      region: config.cloud.region,
      created_at: existing?.created_at ?? now,
      last_deployed_at: existing?.last_deployed_at ?? now,
      // Mark the hashes as unknown so the next `update` unconditionally
      // re-applies (a rebuild with identical config is a ~5s no-op on
      // the happy path).
      last_config_hash: 'sha256:adopted',
      last_nix_hash: 'sha256:adopted',
      ssh_key_path: sshKeyPath,
      age_key_path: ageKeyPath,
      health: existing?.health ?? 'unknown',
      instance_ip: publicIp,
      hermes_agent_rev: 'unknown',
      hermes_agent_tag: '',
      cloud_resources: {
        instance_id: r.instance_id ?? '',
        security_group_id: r.security_group_id ?? '',
        key_pair_name: r.key_pair_name ?? '',
        eip_allocation_id: r.eip_allocation_id ?? '',
        region: r.region ?? config.cloud.region,
      },
    };
  } else {
    const r = adopted.ledger.resources;
    deployment = {
      project_path: projectPath,
      cloud: 'gcp',
      region: config.cloud.region,
      created_at: existing?.created_at ?? now,
      last_deployed_at: existing?.last_deployed_at ?? now,
      last_config_hash: 'sha256:adopted',
      last_nix_hash: 'sha256:adopted',
      ssh_key_path: sshKeyPath,
      age_key_path: ageKeyPath,
      health: existing?.health ?? 'unknown',
      instance_ip: publicIp,
      hermes_agent_rev: 'unknown',
      hermes_agent_tag: '',
      cloud_resources: {
        instance_name: r.instance_name ?? '',
        static_ip_name: r.static_ip_name ?? '',
        firewall_rule_names: r.firewall_rule_names ?? [],
        project_id: r.project_id ?? config.cloud.profile,
        zone: r.zone ?? config.cloud.zone ?? '',
      },
    };
  }

  let persisted = false;
  if (!opts.dryRun) {
    await store.update((s) => {
      s.deployments[name] = deployment;
    });
    persisted = true;
  }

  return {
    name,
    cloud: adopted.ledger.kind,
    region: config.cloud.region,
    publicIp: adopted.publicIp,
    deployment,
    persisted,
  };
}

/**
 * CLI entry — runs {@link adoptDeployment} and prints a human-readable
 * summary (or JSON when `json: true`). Returns the AdoptResult so the
 * library entry can chain.
 */
export async function adoptCommand(
  opts: AdoptOptions & { json?: boolean },
): Promise<void> {
  const result = await adoptDeployment(opts);
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  const verb = result.persisted ? 'Adopted' : 'Previewed (dry-run)';
  console.log(`${verb} deployment: ${result.name}`);
  console.log(`  Cloud:       ${result.cloud}`);
  console.log(`  Region:      ${result.region}`);
  console.log(`  Public IP:   ${result.publicIp ?? '(none)'}`);
  if (result.deployment.cloud === 'aws') {
    const r = result.deployment.cloud_resources;
    console.log(`  Instance:    ${r.instance_id || '(missing)'}`);
    console.log(`  SG:          ${r.security_group_id || '(missing)'}`);
    console.log(`  Key pair:    ${r.key_pair_name || '(missing)'}`);
    console.log(`  EIP alloc:   ${r.eip_allocation_id || '(missing)'}`);
  } else {
    const r = result.deployment.cloud_resources;
    console.log(`  Instance:    ${r.instance_name || '(missing)'}`);
    console.log(`  Address:     ${r.static_ip_name || '(missing)'}`);
    console.log(`  Firewalls:   ${r.firewall_rule_names.join(', ') || '(missing)'}`);
    console.log(`  Project:     ${r.project_id}`);
    console.log(`  Zone:        ${r.zone}`);
  }

  // Warn about missing local key material — adopt doesn't have
  // permission to repair this, the user has to `key import`.
  if (!existsSync(result.deployment.ssh_key_path)) {
    console.error(
      `\nWARNING: SSH key missing at ${result.deployment.ssh_key_path}. \`update\`/\`logs\`/\`ssh\` will fail until you reimport it.`,
    );
  }
  if (!existsSync(result.deployment.age_key_path)) {
    console.error(
      `\nWARNING: age key missing at ${result.deployment.age_key_path}. Secret commands will fail — run \`hermes-deploy key import ${result.name} <path>\`.`,
    );
  }
}
