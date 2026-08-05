import type { SshSession } from './session.js';
import type { CronConfig } from '../schema/hermes-toml.js';
import { diffCrons, cronPlanIsEmpty, type BoxCron, type CronPlan } from '../orchestrator/cron-diff.js';

const HERMES_HOME = '/var/lib/hermes';
const HERMES_DOTDIR = '/var/lib/hermes/.hermes';
const JOBS_JSON = `${HERMES_DOTDIR}/cron/jobs.json`;

/** Single-quote any string for safe interpolation into a bash command. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Prefix that runs a hermes CLI subcommand as the hermes user. */
function runAs(hermesBin: string): string {
  return `sudo -u hermes env HOME=${HERMES_HOME} HERMES_HOME=${HERMES_DOTDIR} ${shq(hermesBin)}`;
}

/**
 * Resolve the hermes-agent binary path from the running systemd unit.
 * The nix store path changes across upgrades, so we never hardcode it.
 */
export async function resolveHermesBin(session: SshSession): Promise<string> {
  const r = await session.exec(
    `systemctl show hermes-agent -p ExecStart --value | grep -oE '/nix/store/[^ ]*/bin/hermes' | head -1`,
  );
  const bin = r.stdout.trim();
  if (!bin) throw new Error('could not resolve hermes-agent binary path from systemd unit');
  return bin;
}

interface RawBoxJob {
  id?: string;
  name?: string;
  prompt?: string | null;
  skills?: string[] | null;
  deliver?: string | null;
  enabled?: boolean;
  // Real jobs.json stores schedule as { kind, expr, display }; tolerate a
  // bare string too so the parser is robust to format drift.
  schedule?: { expr?: string } | string | null;
  schedule_display?: string | null;
}

function scheduleOf(j: RawBoxJob): string {
  if (typeof j.schedule === 'string') return j.schedule;
  return j.schedule?.expr ?? j.schedule_display ?? '';
}

/**
 * Read the box's current cron jobs from jobs.json. Returns [] when the
 * file is absent (a box that has never had a cron). Only the fields
 * hermes-deploy reconciles against are extracted.
 */
export async function readBoxCrons(session: SshSession): Promise<BoxCron[]> {
  const r = await session.exec(`cat ${shq(JOBS_JSON)} 2>/dev/null || echo '{"jobs":[]}'`);
  let parsed: { jobs?: RawBoxJob[] };
  try {
    parsed = JSON.parse(r.stdout || '{"jobs":[]}');
  } catch {
    parsed = { jobs: [] };
  }
  const jobs = parsed.jobs ?? [];
  return jobs
    .filter(j => j.id && j.name)
    .map(j => ({
      id: j.id as string,
      name: j.name as string,
      schedule: scheduleOf(j),
      prompt: j.prompt ?? undefined,
      skills: j.skills ?? [],
      deliver: j.deliver ?? undefined,
      enabled: j.enabled !== false,
    }));
}

function createCmd(hermesBin: string, c: CronConfig): string {
  const parts = [runAs(hermesBin), 'cron', 'create', shq(c.schedule), '--name', shq(c.name)];
  if (c.deliver) parts.push('--deliver', shq(c.deliver));
  if (c.repeat != null) parts.push('--repeat', String(c.repeat));
  for (const s of c.skills) parts.push('--skill', shq(s));
  if (c.script) parts.push('--script', shq(c.script));
  if (c.workdir) parts.push('--workdir', shq(c.workdir));
  if (c.prompt) parts.push(shq(c.prompt));
  return parts.join(' ');
}

/** Build an `edit` command for the non-enabled fields that drifted. */
function editCmd(hermesBin: string, id: string, c: CronConfig, changed: string[]): string | null {
  const parts = [runAs(hermesBin), 'cron', 'edit', shq(id)];
  let any = false;
  if (changed.includes('schedule')) { parts.push('--schedule', shq(c.schedule)); any = true; }
  if (changed.includes('prompt')) { parts.push('--prompt', shq(c.prompt ?? '')); any = true; }
  if (changed.includes('deliver')) { parts.push('--deliver', shq(c.deliver ?? '')); any = true; }
  if (changed.includes('skills')) {
    if (c.skills.length === 0) parts.push('--clear-skills');
    else for (const s of c.skills) parts.push('--skill', shq(s));
    any = true;
  }
  return any ? parts.join(' ') : null;
}

export interface ReconcileResult {
  plan: CronPlan;
  restarted: boolean;
}

export interface Reportlike {
  log: (msg: string) => void;
}

/**
 * Reconcile the declared `[[hermes.cron]]` set onto the box. Reads the
 * current jobs, diffs, and — only when something changed — stops the
 * gateway (so the in-process scheduler can't overwrite jobs.json mid-edit),
 * applies create/edit/remove + enable/disable via the hermes cron CLI,
 * then starts it again (which re-snapshots jobs.json).
 *
 * Returns the plan that was applied and whether the gateway was restarted.
 * A no-op plan touches nothing and does not restart.
 */
export async function reconcileCrons(opts: {
  session: SshSession;
  declared: CronConfig[];
  hermesBin?: string;
  reporter?: Reportlike;
}): Promise<ReconcileResult> {
  const { session, declared } = opts;
  const log = opts.reporter?.log ?? (() => {});
  const hermesBin = opts.hermesBin ?? (await resolveHermesBin(session));

  const current = await readBoxCrons(session);
  const plan = diffCrons(declared, current);

  if (cronPlanIsEmpty(plan)) {
    log('crons: already in sync');
    return { plan, restarted: false };
  }

  log(
    `crons: ${plan.creates.length} to create, ${plan.edits.length} to edit, ${plan.removes.length} to remove`,
  );

  const run = async (cmd: string, what: string) => {
    const r = await session.exec(cmd);
    if (r.exitCode !== 0) {
      throw new Error(`cron reconcile: ${what} failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).trim()}`);
    }
  };

  // Stop the gateway so its scheduler can't rewrite jobs.json under us.
  await run('systemctl stop hermes-agent', 'stop hermes-agent');
  try {
    for (const rem of plan.removes) {
      log(`  - remove ${rem.name}`);
      await run(`${runAs(hermesBin)} cron remove ${shq(rem.id)}`, `remove ${rem.name}`);
    }
    for (const c of plan.creates) {
      log(`  + create ${c.name}`);
      await run(createCmd(hermesBin, c), `create ${c.name}`);
    }
    for (const e of plan.edits) {
      const cmd = editCmd(hermesBin, e.id, e.declared, e.changed);
      if (cmd) {
        log(`  ~ edit ${e.name} (${e.changed.filter(f => f !== 'enabled').join(', ')})`);
        await run(cmd, `edit ${e.name}`);
      }
    }

    // Enable/disable pass — `cron edit` has no enabled flag, so pause/resume
    // by id. Re-read to resolve ids of just-created jobs and current state.
    const wantEnabled = new Map(declared.map(d => [d.name, d.enabled]));
    const after = await readBoxCrons(session);
    for (const job of after) {
      const want = wantEnabled.get(job.name);
      if (want === undefined || want === job.enabled) continue;
      if (want) {
        log(`  ▶ resume ${job.name}`);
        await run(`${runAs(hermesBin)} cron resume ${shq(job.id)}`, `resume ${job.name}`);
      } else {
        log(`  ⏸ pause ${job.name}`);
        await run(`${runAs(hermesBin)} cron pause ${shq(job.id)}`, `pause ${job.name}`);
      }
    }
  } finally {
    // Always bring the gateway back up, even if an op failed mid-way.
    await run('systemctl start hermes-agent', 'start hermes-agent');
  }

  return { plan, restarted: true };
}
