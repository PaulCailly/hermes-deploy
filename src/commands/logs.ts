import { readFileSync } from 'node:fs';
import { resolveDeployment } from './resolve.js';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import { createSshSession } from '../remote-ops/session.js';

export interface LogsOptions {
  name?: string;
  projectPath?: string;
}

/**
 * Stream `journalctl -u hermes-agent.service -f` from the box until
 * the user hits Ctrl-C. Uses the abortable execStreamUntil so the
 * remote command receives TERM cleanly when SIGINT fires locally.
 */
export async function logsCommand(opts: LogsOptions): Promise<void> {
  const { name } = await resolveDeployment({
    name: opts.name,
    projectPath: opts.projectPath,
    cwd: process.cwd(),
  });

  const store = new StateStore(getStatePaths());
  const state = await store.read();
  const deployment = state.deployments[name];
  if (!deployment) throw new Error(`deployment "${name}" not found in state`);

  const privateKey = readFileSync(deployment.ssh_key_path, 'utf-8');
  const session = await createSshSession({
    host: deployment.instance_ip,
    username: 'root',
    privateKey,
  });

  const controller = new AbortController();
  const sigintHandler = () => {
    process.stderr.write('\nstopping log stream...\n');
    controller.abort();
  };
  process.on('SIGINT', sigintHandler);

  try {
    const result = await session.execStreamUntil(
      'journalctl -u hermes-agent.service -f --no-pager',
      controller.signal,
      (stream, line) => {
        if (stream === 'stderr') process.stderr.write(`${line}\n`);
        else process.stdout.write(`${line}\n`);
      },
    );
    if (!result.aborted && result.exitCode !== 0) {
      process.exitCode = result.exitCode ?? 1;
    }
  } finally {
    process.off('SIGINT', sigintHandler);
    await session.dispose();
  }
}
