import type { SshSession } from './session.js';

export interface RebuildResult {
  success: boolean;
  tail: string[];
}

const TAIL_LINES = 50;

export async function runNixosRebuild(
  session: SshSession,
  onLine: (stream: 'stdout' | 'stderr', line: string) => void,
): Promise<RebuildResult> {
  const ring: string[] = [];
  const result = await session.execStream('nixos-rebuild switch 2>&1', (stream, line) => {
    ring.push(line);
    if (ring.length > TAIL_LINES) ring.shift();
    onLine(stream, line);
  });
  return { success: result.exitCode === 0, tail: ring };
}
