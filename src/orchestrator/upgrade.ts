import { readHermesAgentVersion } from '../remote-ops/read-flake-lock.js';
import type { RebuildResult } from '../remote-ops/nixos-rebuild.js';
import type { SshSession } from '../remote-ops/session.js';
import type { Reporter } from './reporter.js';

export interface UpgradeOptions {
  deploymentName: string;
  sessionFactory: () => Promise<SshSession>;
  nixosRebuildRunner: (
    sessionFactory: () => Promise<SshSession>,
    onLine: (stream: 'stdout' | 'stderr', line: string) => void,
  ) => Promise<RebuildResult>;
  healthchecker: (session: SshSession) => Promise<{ health: 'healthy' | 'unhealthy'; journalTail: string[] }>;
  stateUpdater: (rev: string, tag: string) => Promise<void>;
  reporter: Reporter;
}

const NIX_CONFIG_PREFIX = 'NIX_CONFIG="experimental-features = nix-command flakes"';
const FLAKE_UPDATE_COMMAND = `${NIX_CONFIG_PREFIX} nix flake update hermes-agent --flake /etc/nixos`;

export async function runUpgrade(opts: UpgradeOptions): Promise<void> {
  const { reporter } = opts;

  // Phase 1 — update the flake input
  reporter.phaseStart('flake-update', 'Updating hermes-agent flake input');
  const session = await opts.sessionFactory();
  try {
    const result = await session.exec(FLAKE_UPDATE_COMMAND);
    if (result.exitCode !== undefined && result.exitCode !== 0) {
      reporter.phaseFail('flake-update', 'nix flake update failed');
      throw new Error(`nix flake update failed:\n${result.stderr || result.stdout}`);
    }
    reporter.phaseDone('flake-update');
  } finally {
    await session.dispose();
  }

  // Phase 2 — nixos-rebuild switch
  reporter.phaseStart('bootstrap', 'Running nixos-rebuild switch');
  const rebuild = await opts.nixosRebuildRunner(
    opts.sessionFactory,
    (_stream, line) => reporter.log(line),
  );
  if (!rebuild.success) {
    reporter.phaseFail('bootstrap', 'nixos-rebuild failed');
    throw new Error(`nixos-rebuild failed:\n${rebuild.tail.join('\n')}`);
  }
  reporter.phaseDone('bootstrap');

  // Phase 3 — healthcheck
  reporter.phaseStart('healthcheck', 'Waiting for hermes-agent.service');
  const healthSession = await opts.sessionFactory();
  try {
    const health = await opts.healthchecker(healthSession);
    if (health.health === 'unhealthy') {
      reporter.phaseFail('healthcheck', 'service is not active after upgrade');
      for (const line of health.journalTail) reporter.log(line);
      throw new Error('hermes-agent unhealthy after upgrade');
    }
    reporter.phaseDone('healthcheck');

    // Phase 4 — read new version and persist
    const version = await readHermesAgentVersion(healthSession);
    const rev = version?.lockedRev ?? 'unknown';
    const tag = '';
    await opts.stateUpdater(rev, tag);
    reporter.success(`${opts.deploymentName} upgraded to ${rev.slice(0, 12)}`);
  } finally {
    await healthSession.dispose();
  }
}
