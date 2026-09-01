import { spawn } from 'node:child_process';
import { resolveDeployment } from './resolve.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';
import { refreshSshIngress } from '../orchestrator/ssh-ingress.js';
import { createCloudProvider } from '../cloud/factory.js';
import { detectPublicIp } from '../utils/public-ip.js';

export interface SshOptions {
  name?: string;
  projectPath?: string;
}

export async function sshCommand(opts: SshOptions): Promise<void> {
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

  // Best-effort: with ssh_allowed_from = "auto", heal a security-group
  // rule pinned to a stale operator IP before attempting the connection.
  // Failures (no cloud creds, no network) must never block the ssh
  // attempt itself — the rule may already be fine.
  try {
    const provider = createCloudProvider({
      provider: deployment.cloud,
      region: deployment.region,
      profile: deployment.cloud === 'gcp' ? (deployment.cloud_resources as any).project_id : undefined,
      zone: deployment.cloud === 'gcp' ? (deployment.cloud_resources as any).zone : undefined,
      imageCacheFile: paths.imageCacheFile,
    });
    const applied = await refreshSshIngress({
      deploymentName: name,
      provider,
      detectPublicIp: () => detectPublicIp(),
    });
    if (applied) console.error(`ssh ingress refreshed for ${applied}`);
  } catch {
    // proceed — the connection attempt below reports the real error
  }

  // Exec system ssh; replaces this process so the user gets a real interactive shell
  const args = [
    '-i', deployment.ssh_key_path,
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'StrictHostKeyChecking=no',
    `root@${deployment.instance_ip}`,
  ];
  const child = spawn('ssh', args, { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}
