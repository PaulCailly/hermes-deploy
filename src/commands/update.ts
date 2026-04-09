import { findUp } from './find-project.js';
import { loadHermesToml } from '../schema/load.js';
import { runUpdate } from '../orchestrator/update.js';
import { createCloudProvider } from '../cloud/factory.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';
import { createSshSession } from '../remote-ops/session.js';
import { detectPublicIp } from '../utils/public-ip.js';

/**
 * Resolve the deployment name from --name, [name] positional, or
 * cwd-walk to find a hermes.toml. M2 will refactor this into a shared
 * resolver (Phase B); for now `update` ships with the same inline
 * resolution pattern as destroy/status/ssh.
 */
export async function updateCommand(opts: { name?: string }): Promise<void> {
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
  if (!deployment) throw new Error(`deployment "${name}" not found in state — run \`hermes-deploy up\` first`);

  const provider = createCloudProvider({
    provider: deployment.cloud,
    region: deployment.region,
    imageCacheFile: paths.imageCacheFile,
  });

  const result = await runUpdate({
    deploymentName: name,
    provider,
    sessionFactory: (host, privateKey) =>
      createSshSession({ host, username: 'root', privateKey }),
    detectPublicIp: () => detectPublicIp(),
  });

  if (result.health === 'unhealthy') process.exit(1);
}
