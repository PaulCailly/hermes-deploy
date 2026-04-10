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
  'nixos-rebuild switch --flake /etc/nixos#default';

const LOG_FILE = '/tmp/hermes-rebuild.log';
const EXIT_FILE = '/tmp/hermes-rebuild.exit';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000; // 30 min for first-time builds

/**
 * Run nixos-rebuild on the remote box. Uses a nohup + poll pattern
 * instead of streaming so the rebuild survives sshd restarts during
 * the activation phase.
 *
 * nixos-rebuild switch restarts sshd as part of system activation.
 * If we streamed the rebuild over a single SSH channel, the channel
 * would die when sshd restarts — causing the deployer to lose contact
 * with the box. On GCE this is consistently fatal; on AWS it's a race
 * condition that usually works by luck.
 *
 * The nohup approach:
 *   1. Start the rebuild in the background, output → log file
 *   2. Disconnect (the session can die — the rebuild continues)
 *   3. Poll via short SSH exec calls until a marker file appears
 *   4. Read the exit code + tail from the marker/log files
 *   5. Clean up the temp files
 *
 * Each poll is a fresh exec call on the existing session. If the
 * session dies mid-poll (sshd restart), the next poll will fail and
 * we retry with a reconnect via the sessionFactory.
 */
export interface RebuildOptions {
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export async function runNixosRebuild(
  sessionFactory: () => Promise<SshSession>,
  onLine: (stream: 'stdout' | 'stderr', line: string) => void,
  opts: RebuildOptions = {},
): Promise<RebuildResult> {
  // 1. Start the rebuild in the background
  let session = await sessionFactory();
  try {
    await session.exec(
      `rm -f ${EXIT_FILE} ${LOG_FILE} && ` +
      `nohup sh -c '${REBUILD_COMMAND} > ${LOG_FILE} 2>&1; echo $? > ${EXIT_FILE}' ` +
      `> /dev/null 2>&1 &`,
    );
  } finally {
    await session.dispose();
  }

  // 2. Poll for completion
  const ring: string[] = [];
  const pollInterval = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const pollTimeout = opts.pollTimeoutMs ?? POLL_TIMEOUT_MS;
  const deadline = Date.now() + pollTimeout;
  let lastLineCount = 0;

  while (Date.now() < deadline) {
    await sleep(pollInterval);

    let pollSession: SshSession;
    try {
      pollSession = await sessionFactory();
    } catch {
      // Session creation failed (sshd restarting) — retry next cycle
      onLine('stderr', '  (sshd restarting, waiting...)');
      continue;
    }

    try {
      // Check if the rebuild finished
      const exitCheck = await pollSession.exec(`cat ${EXIT_FILE} 2>/dev/null`);
      const exitCodeStr = exitCheck.stdout.trim();

      // Stream new log lines
      const logResult = await pollSession.exec(`wc -l < ${LOG_FILE} 2>/dev/null`);
      const totalLines = parseInt(logResult.stdout.trim(), 10) || 0;
      if (totalLines > lastLineCount) {
        const newLines = await pollSession.exec(
          `sed -n '${lastLineCount + 1},${totalLines}p' ${LOG_FILE} 2>/dev/null`,
        );
        for (const line of newLines.stdout.split('\n').filter(Boolean)) {
          ring.push(line);
          if (ring.length > TAIL_LINES) ring.shift();
          onLine('stdout', line);
        }
        lastLineCount = totalLines;
      }

      // If exit file exists, we're done
      if (exitCodeStr !== '') {
        const exitCode = parseInt(exitCodeStr, 10);
        // Clean up temp files
        try { await pollSession.exec(`rm -f ${EXIT_FILE} ${LOG_FILE}`); } catch {}
        await pollSession.dispose();
        return { success: exitCode === 0, tail: ring };
      }

      await pollSession.dispose();
    } catch {
      // Poll command failed (sshd mid-restart) — retry next cycle
      try { await pollSession!.dispose(); } catch {}
      onLine('stderr', '  (connection interrupted, retrying...)');
      continue;
    }
  }

  throw new Error(`nixos-rebuild timed out after ${POLL_TIMEOUT_MS / 60000} minutes`);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
