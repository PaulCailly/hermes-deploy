import { resolveDeployment } from './resolve.js';
import { runUpdate } from '../orchestrator/update.js';
import { createCloudProvider } from '../cloud/factory.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';
import { createSshSession } from '../remote-ops/session.js';
import { detectPublicIp } from '../utils/public-ip.js';
import { shouldUseInk } from '../ui/tty.js';
import { createInkReporter } from '../ui/index.js';
import { createPlainReporter } from '../orchestrator/reporter.js';

export interface UpdateCommandOptions {
  name?: string;
  projectPath?: string;
}

export async function updateCommand(opts: UpdateCommandOptions): Promise<void> {
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
    throw new Error(`deployment "${name}" not found in state — run \`hermes-deploy up\` first`);
  }

  const provider = createCloudProvider({
    provider: deployment.cloud,
    region: deployment.region,
    imageCacheFile: paths.imageCacheFile,
  });

  const reporter = shouldUseInk() ? createInkReporter() : createPlainReporter();

  const result = await runUpdate({
    deploymentName: name,
    provider,
    sessionFactory: (host, privateKey) =>
      createSshSession({ host, username: 'root', privateKey }),
    detectPublicIp: () => detectPublicIp(),
    reporter,
  });

  if (result.health === 'unhealthy') process.exit(1);
}
