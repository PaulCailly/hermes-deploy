import { findUp } from './find-project.js';
import { loadHermesToml } from '../schema/load.js';
import { runDeploy } from '../orchestrator/deploy.js';
import { AwsProvider } from '../cloud/aws/provider.js';
import { getStatePaths } from '../state/paths.js';
import { createSshSession } from '../remote-ops/session.js';
import { waitForSshPort } from '../remote-ops/wait-ssh.js';
import { detectPublicIp } from '../cloud/aws/public-ip.js';
import { generateSshKeypair } from '../crypto/ssh-keygen.js';
import { generateAgeKeypair } from '../crypto/age-keygen.js';
import { ensureSopsBootstrap } from '../sops/bootstrap.js';

export async function upCommand(_opts: Record<string, unknown>): Promise<void> {
  const projectDir = findUp(process.cwd(), 'hermes.toml');
  if (!projectDir) {
    throw new Error('no hermes.toml found in current directory or any parent');
  }
  const config = loadHermesToml(`${projectDir}/hermes.toml`);
  if (config.cloud.provider !== 'aws') {
    throw new Error(`M1 only supports cloud.provider = "aws" (got "${config.cloud.provider}")`);
  }

  const paths = getStatePaths();
  const provider = new AwsProvider({
    region: config.cloud.region,
    profile: config.cloud.profile,
    imageCacheFile: paths.imageCacheFile,
  });

  const result = await runDeploy({
    projectDir,
    provider,
    sessionFactory: (host, privateKey) =>
      createSshSession({ host, username: 'root', privateKey }),
    detectPublicIp: () => detectPublicIp(),
    sshKeyGenerator: async (path) => generateSshKeypair(path),
    ageKeyGenerator: async (path) => generateAgeKeypair(path),
    sopsBootstrap: async (dir, key) => ensureSopsBootstrap(dir, key),
    waitSsh: (host) => waitForSshPort({ host }),
  });

  if (result.health === 'unhealthy') process.exit(1);
}
