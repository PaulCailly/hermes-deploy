import type { SshSession } from './session.js';

export interface HealthcheckOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export interface HealthcheckResult {
  health: 'healthy' | 'unhealthy';
  journalTail: string[];
}

export async function pollHermesHealth(
  session: SshSession,
  opts: HealthcheckOptions = {},
): Promise<HealthcheckResult> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const r = await session.exec('systemctl is-active hermes-agent.service');
    if (r.exitCode === 0 && r.stdout.trim() === 'active') {
      return { health: 'healthy', journalTail: [] };
    }
    await new Promise(res => setTimeout(res, intervalMs));
  }

  const journal = await session.exec(
    'journalctl -u hermes-agent.service -n 50 --no-pager',
  );
  return {
    health: 'unhealthy',
    journalTail: journal.stdout.split('\n').filter(Boolean),
  };
}
