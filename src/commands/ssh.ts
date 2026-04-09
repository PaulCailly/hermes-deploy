import { spawn } from 'node:child_process';
import { resolveDeployment } from './resolve.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';

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
