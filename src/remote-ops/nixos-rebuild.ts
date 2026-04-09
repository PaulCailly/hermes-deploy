import type { SshSession } from './session.js';

export interface RebuildResult {
  success: boolean;
  tail: string[];
}

const TAIL_LINES = 50;

/**
 * The rebuild command uses --flake pointing at /etc/nixos (where deploy.ts
 * SFTPs flake.nix + configuration.nix + hermes.nix). NIX_CONFIG forces
 * experimental-features on for this single invocation so we don't need
 * to persist flakes enablement into /etc/nix/nix.conf before the first
 * rebuild — the configuration.nix template already enables flakes for
 * subsequent rebuilds, but it isn't active yet when we run the first one.
 */
const REBUILD_COMMAND =
  'NIX_CONFIG="experimental-features = nix-command flakes" ' +
  'nixos-rebuild switch --flake /etc/nixos#default 2>&1';

export async function runNixosRebuild(
  session: SshSession,
  onLine: (stream: 'stdout' | 'stderr', line: string) => void,
): Promise<RebuildResult> {
  const ring: string[] = [];
  const result = await session.execStream(REBUILD_COMMAND, (stream, line) => {
    ring.push(line);
    if (ring.length > TAIL_LINES) ring.shift();
    onLine(stream, line);
  });
  return { success: result.exitCode === 0, tail: ring };
}
