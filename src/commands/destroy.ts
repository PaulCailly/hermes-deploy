import { findUp } from './find-project.js';
import { loadHermesToml } from '../schema/load.js';
import { runDestroy } from '../orchestrator/destroy.js';
import { createCloudProvider } from '../cloud/factory.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';
import { createInterface } from 'node:readline/promises';

export async function destroyCommand(opts: { name?: string; yes?: boolean }): Promise<void> {
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
  if (!deployment) throw new Error(`deployment "${name}" not found in state`);

  if (!opts.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `Destroy "${name}" (${deployment.cloud}, ${deployment.region}, ${deployment.instance_ip})? [y/N] `,
    );
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('aborted');
      return;
    }
  }

  const provider = createCloudProvider({
    provider: deployment.cloud as 'aws' | 'gcp',
    region: deployment.region,
    imageCacheFile: paths.imageCacheFile,
  });

  await runDestroy({ deploymentName: name, provider });
}
