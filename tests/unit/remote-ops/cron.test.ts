import { describe, it, expect } from 'vitest';
import { readBoxCrons, reconcileCrons } from '../../../src/remote-ops/cron.js';
import type { SshSession, ExecResult } from '../../../src/remote-ops/session.js';
import type { CronConfig } from '../../../src/schema/hermes-toml.js';

const BIN = '/nix/store/abc-hermes-agent-0.12.0/bin/hermes';

/**
 * Mock SshSession: records every exec, answers `systemctl show` with a
 * fake bin path and `cat …jobs.json` from a queue of canned payloads
 * (so we can model the box state before and after mutations).
 */
function mockSession(jobsJsonQueue: string[]): { session: SshSession; commands: string[] } {
  const commands: string[] = [];
  const queue = [...jobsJsonQueue];
  const exec = async (command: string): Promise<ExecResult> => {
    commands.push(command);
    if (command.includes('systemctl show hermes-agent')) {
      return { exitCode: 0, stdout: BIN + '\n', stderr: '' };
    }
    if (command.includes('jobs.json')) {
      const payload = queue.length > 1 ? queue.shift()! : queue[0] ?? '{"jobs":[]}';
      return { exitCode: 0, stdout: payload, stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return {
    session: {
      exec,
      execStream: async () => ({ exitCode: 0 }),
      execStreamUntil: async () => ({ exitCode: 0, matched: false }),
      uploadFile: async () => {},
      shell: async () => {},
      dispose: async () => {},
    } as unknown as SshSession,
    commands,
  };
}

const declared = (over: Partial<CronConfig> & { name: string }): CronConfig => ({
  schedule: '0 6 * * 1-5',
  skills: [],
  enabled: true,
  ...over,
});

const boxJson = (jobs: unknown[]) => JSON.stringify({ jobs });

describe('readBoxCrons', () => {
  it('parses jobs.json into BoxCron[], reading schedule.expr and enabled', async () => {
    const { session } = mockSession([
      boxJson([
        { id: 'i1', name: 'triage', schedule: { expr: '0 6 * * 1-5' }, prompt: 'go', skills: ['s'], deliver: 'discord:1', enabled: true },
        { id: 'i2', name: 'paused-one', schedule: { expr: '30m' }, enabled: false },
      ]),
    ]);
    const crons = await readBoxCrons(session);
    expect(crons).toEqual([
      { id: 'i1', name: 'triage', schedule: '0 6 * * 1-5', prompt: 'go', skills: ['s'], deliver: 'discord:1', enabled: true },
      { id: 'i2', name: 'paused-one', schedule: '30m', prompt: undefined, skills: [], deliver: undefined, enabled: false },
    ]);
  });

  it('returns [] when jobs.json is absent', async () => {
    const { session } = mockSession(['{"jobs":[]}']);
    expect(await readBoxCrons(session)).toEqual([]);
  });
});

describe('reconcileCrons', () => {
  it('no-ops (no stop/start) when already in sync', async () => {
    const cur = boxJson([{ id: 'i1', name: 'x', schedule: '0 6 * * 1-5', enabled: true }]);
    const { session, commands } = mockSession([cur]);
    const res = await reconcileCrons({ session, declared: [declared({ name: 'x' })] });
    expect(res.restarted).toBe(false);
    expect(commands.some(c => c.includes('systemctl stop'))).toBe(false);
    expect(commands.some(c => c.includes('systemctl start'))).toBe(false);
  });

  it('creates a new cron between a stop/start, quoting the prompt safely', async () => {
    // first read: empty; second read (enabled pass): the created job
    const after = boxJson([{ id: 'new1', name: 'triage', schedule: '0 6 * * 1-5', enabled: true }]);
    const { session, commands } = mockSession(['{"jobs":[]}', after]);
    const trickyPrompt = `post a board; use 'quotes' and $vars\nand a newline`;
    const res = await reconcileCrons({
      session,
      declared: [declared({ name: 'triage', prompt: trickyPrompt, skills: ['release-manager'], deliver: 'discord:1040' })],
    });
    expect(res.restarted).toBe(true);
    const joined = commands.join('\n');
    expect(joined).toContain('systemctl stop hermes-agent');
    const createCmd = commands.find(c => c.includes('cron create'))!;
    expect(createCmd).toContain("--name 'triage'");
    expect(createCmd).toContain("--deliver 'discord:1040'");
    expect(createCmd).toContain("--skill 'release-manager'");
    // single-quote escaping: the inner ' becomes '\'' and the whole prompt is quoted
    expect(createCmd).toContain(`'\\''quotes'\\''`);
    // stop precedes create precedes start
    expect(commands.indexOf('systemctl stop hermes-agent')).toBeLessThan(commands.indexOf(createCmd));
    expect(commands.indexOf(createCmd)).toBeLessThan(commands.lastIndexOf('systemctl start hermes-agent'));
  });

  it('removes an undeclared cron', async () => {
    const cur = boxJson([{ id: 'gone1', name: 'stale', schedule: '0 6 * * 1-5', enabled: true }]);
    const { session, commands } = mockSession([cur, '{"jobs":[]}']);
    const res = await reconcileCrons({ session, declared: [] });
    expect(res.restarted).toBe(true);
    expect(commands.some(c => c.includes("cron remove 'gone1'"))).toBe(true);
  });

  it('pauses a cron declared disabled', async () => {
    const cur = boxJson([{ id: 'i1', name: 'x', schedule: '0 6 * * 1-5', enabled: true }]);
    // after edit pass, re-read still shows it enabled → pause fires
    const { session, commands } = mockSession([cur, cur]);
    await reconcileCrons({ session, declared: [declared({ name: 'x', enabled: false })] });
    expect(commands.some(c => c.includes("cron pause 'i1'"))).toBe(true);
  });
});
