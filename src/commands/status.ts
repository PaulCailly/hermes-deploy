import { resolveDeployment } from './resolve.js';
import { createCloudProvider } from '../cloud/factory.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';

export interface StatusOptions {
  name?: string;
  projectPath?: string;
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
    console.log(`No deployment named "${name}" found in state.`);
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
