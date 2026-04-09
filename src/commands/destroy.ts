import { resolveDeployment } from './resolve.js';
import { runDestroy } from '../orchestrator/destroy.js';
import { createCloudProvider } from '../cloud/factory.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';
import { createInterface } from 'node:readline/promises';

export interface DestroyOptions {
  name?: string;
  projectPath?: string;
  yes?: boolean;
}

export async function destroyCommand(opts: DestroyOptions): Promise<void> {
  const { name } = await resolveDeployment({
    name: opts.name,
    projectPath: opts.projectPath,
    cwd: process.cwd(),
  });

  const paths = getStatePaths();
  const store = new StateStore(paths);
  const state = await store.read();
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
