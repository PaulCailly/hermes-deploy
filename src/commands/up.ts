import { join } from 'node:path';
import { resolveDeployment } from './resolve.js';
import { loadHermesToml } from '../schema/load.js';
import { runDeploy } from '../orchestrator/deploy.js';
import { createCloudProvider } from '../cloud/factory.js';
import { getStatePaths } from '../state/paths.js';
import { createSshSession } from '../remote-ops/session.js';
import { waitForSshPort } from '../remote-ops/wait-ssh.js';
import { detectPublicIp } from '../utils/public-ip.js';
import { generateSshKeypair } from '../crypto/ssh-keygen.js';
import { generateAgeKeypair } from '../crypto/age-keygen.js';
import { ensureSopsBootstrap } from '../sops/bootstrap.js';
import { shouldUseInk } from '../ui/tty.js';
import { createInkReporter } from '../ui/index.js';
import { createPlainReporter } from '../orchestrator/reporter.js';

export interface UpOptions {
  name?: string;
  projectPath?: string;
}

export async function upCommand(opts: UpOptions): Promise<void> {
  const { projectPath } = await resolveDeployment({
    name: opts.name,
    projectPath: opts.projectPath,
    cwd: process.cwd(),
  });

  const config = loadHermesToml(join(projectPath, 'hermes.toml'));
  if (config.cloud.provider !== 'aws') {
    throw new Error(`M1 only supports cloud.provider = "aws" (got "${config.cloud.provider}")`);
  }

  const paths = getStatePaths();
  const provider = createCloudProvider({
    provider: config.cloud.provider,
    region: config.cloud.region,
    profile: config.cloud.profile,
    imageCacheFile: paths.imageCacheFile,
  });

  const reporter = shouldUseInk() ? createInkReporter() : createPlainReporter();

  const result = await runDeploy({
    projectDir: projectPath,
    provider,
    sessionFactory: (host, privateKey) =>
      createSshSession({ host, username: 'root', privateKey }),
    detectPublicIp: () => detectPublicIp(),
    sshKeyGenerator: async (path) => generateSshKeypair(path),
    ageKeyGenerator: async (path) => generateAgeKeypair(path),
    sopsBootstrap: async (dir, key) => ensureSopsBootstrap(dir, key),
    waitSsh: (host) => waitForSshPort({ host }),
    reporter,
  });

  if (result.health === 'unhealthy') process.exit(1);
}
