import type { SshSession } from './session.js';

export interface FlakeLockVersion {
  lockedRev: string;
  lockedDate: string;
}

export async function readHermesAgentVersion(
  session: SshSession,
): Promise<FlakeLockVersion | null> {
  try {
    const result = await session.exec('cat /etc/nixos/flake.lock 2>/dev/null');
    const lock = JSON.parse(result.stdout);
    const node = lock?.nodes?.['hermes-agent'];
    if (!node?.locked?.rev) return null;
    const rev: string = node.locked.rev;
    const lastModified: number = node.locked.lastModified;
    const lockedDate = new Date(lastModified * 1000).toISOString();
    return { lockedRev: rev, lockedDate };
  } catch {
    return null;
  }
}
