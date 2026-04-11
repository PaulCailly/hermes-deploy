import { resolveDeployment } from './resolve.js';
import { createCloudProvider } from '../cloud/factory.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';
import type { Deployment } from '../schema/state-toml.js';
import type { InstanceStatus } from '../cloud/core.js';

export interface StatusOptions {
  name?: string;
  projectPath?: string;
  /** Emit JSON on stdout instead of human-formatted text. */
  json?: boolean;
}

/**
 * Machine-readable shape of a `status` result. Stable: field names and
 * types here follow the same semver contract as the CLI surface.
 */
export interface StatusPayload {
  name: string;
  found: boolean;
  stored?: {
    cloud: Deployment['cloud'];
    region: string;
    instance_ip: string;
    last_config_hash: string;
    last_nix_hash: string;
    last_deployed_at: string;
    health: Deployment['health'];
    ssh_key_path: string;
    age_key_path: string;
  };
  live?: InstanceStatus;
}

export async function statusCommand(opts: StatusOptions): Promise<void> {
  const { name } = await resolveDeployment({
    name: opts.name,
    projectPath: opts.projectPath,
    cwd: process.cwd(),
  });

  const paths = getStatePaths();
  const store = new StateStore(paths);
  const state = await store.read();
  const deployment = state.deployments[name];

  if (!deployment) {
    const payload: StatusPayload = { name, found: false };
    if (opts.json) {
      process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    } else {
      console.log(`No deployment named "${name}" found in state.`);
    }
    return;
  }

  const provider = createCloudProvider({
    provider: deployment.cloud as 'aws' | 'gcp',
    region: deployment.region,
    profile: deployment.cloud === 'gcp' ? (deployment.cloud_resources as any).project_id : undefined,
    zone: deployment.cloud === 'gcp' ? (deployment.cloud_resources as any).zone : undefined,
    imageCacheFile: paths.imageCacheFile,
  });

  const live = await provider.status(
    deployment.cloud === 'aws'
      ? { kind: 'aws', resources: deployment.cloud_resources }
      : { kind: 'gcp', resources: deployment.cloud_resources },
  );

  const payload: StatusPayload = {
    name,
    found: true,
    stored: {
      cloud: deployment.cloud,
      region: deployment.region,
      instance_ip: deployment.instance_ip,
      last_config_hash: deployment.last_config_hash,
      last_nix_hash: deployment.last_nix_hash,
      last_deployed_at: deployment.last_deployed_at,
      health: deployment.health,
      ssh_key_path: deployment.ssh_key_path,
      age_key_path: deployment.age_key_path,
    },
    live,
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }

  console.log(`Deployment:    ${name}`);
  console.log(`  Cloud:       ${deployment.cloud}`);
  console.log(`  Region:      ${deployment.region}`);
  console.log(`  Instance:    ${live.state}`);
  console.log(`  Public IP:   ${live.publicIp ?? '(none)'}`);
  console.log(`  Last config: ${deployment.last_config_hash}`);
  console.log(`  Health:      ${deployment.health}`);
  console.log(`  Deployed at: ${deployment.last_deployed_at}`);
  console.log(`  SSH key:     ${deployment.ssh_key_path}`);
}
