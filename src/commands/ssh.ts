import { spawn } from 'node:child_process';
import { findUp } from './find-project.js';
import { loadHermesToml } from '../schema/load.js';
import { getStatePaths } from '../state/paths.js';
import { StateStore } from '../state/store.js';

export async function sshCommand(opts: { name?: string }): Promise<void> {
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
