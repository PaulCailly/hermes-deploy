import { findUp } from './find-project.js';
import { loadHermesToml } from '../schema/load.js';
import { AwsProvider } from '../cloud/aws/provider.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';

export async function statusCommand(opts: { name?: string }): Promise<void> {
  const paths = getStatePaths();
  const store = new StateStore(paths);
  const state = await store.read();

  let name = opts.name;
  if (!name) {
    const projectDir = findUp(process.cwd(), 'hermes.toml');
    if (!projectDir) throw new Error('no name given and no hermes.toml in cwd');
    name = loadHermesToml(`${projectDir}/hermes.toml`).name;
  }

  const deployment = state.deployments[name];
  if (!deployment) {
    console.log(`No deployment named "${name}" found in state.`);
    return;
  }

  const provider = new AwsProvider({
    region: deployment.region,
    imageCacheFile: paths.imageCacheFile,
  });

  const live = await provider.status({
    kind: 'aws',
    resources: deployment.cloud_resources as any,
  });

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
