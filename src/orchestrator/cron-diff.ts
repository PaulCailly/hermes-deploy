import { createHash } from 'node:crypto';
import type { CronConfig } from '../schema/hermes-toml.js';

/**
 * A cron job as it currently exists on the box, parsed from the
 * hermes-agent scheduler's `jobs.json`. Only the fields hermes-deploy
 * reconciles against are modelled; runtime bookkeeping (last_run_at,
 * next_run_at, completed count, …) is intentionally ignored so it is
 * preserved across edits.
 */
export interface BoxCron {
  id: string;
  name: string;
  schedule: string;
  prompt?: string;
  skills: string[];
  deliver?: string;
  enabled: boolean;
}

/** An edit to an existing job, with the specific fields that drifted. */
export interface CronEdit {
  id: string;
  name: string;
  declared: CronConfig;
  /** Which declarative fields differ (for logging). */
  changed: string[];
}

export interface CronPlan {
  creates: CronConfig[];
  edits: CronEdit[];
  removes: { id: string; name: string }[];
}

function sortedSkills(skills: string[] | undefined): string[] {
  return [...(skills ?? [])].sort();
}

function skillsDiffer(a: string[] | undefined, b: string[] | undefined): boolean {
  const sa = sortedSkills(a);
  const sb = sortedSkills(b);
  if (sa.length !== sb.length) return true;
  return sa.some((s, i) => s !== sb[i]);
}

/**
 * Compute which declarative fields of a declared cron differ from the
 * box job it maps to. Returns the list of changed field names (empty =
 * no edit needed). Only declarative fields are compared — never runtime
 * state. Absent/`undefined` on the declared side is normalised so that
 * e.g. no `prompt` vs an empty box prompt does not thrash.
 */
export function cronFieldsChanged(declared: CronConfig, box: BoxCron): string[] {
  const changed: string[] = [];
  if (declared.schedule !== box.schedule) changed.push('schedule');
  if ((declared.prompt ?? '') !== (box.prompt ?? '')) changed.push('prompt');
  if ((declared.deliver ?? '') !== (box.deliver ?? '')) changed.push('deliver');
  if (skillsDiffer(declared.skills, box.skills)) changed.push('skills');
  if (declared.enabled !== box.enabled) changed.push('enabled');
  return changed;
}

/**
 * Reconcile declared crons (from `[[hermes.cron]]`) against the box's
 * current jobs. Matching is by `name` (the stable reconciliation key).
 *
 *   - declared name not on box            → create
 *   - declared name on box, fields drifted → edit (with changed fields)
 *   - box name not declared                → remove (authoritative delete)
 *
 * Pure and deterministic: no I/O, no ordering surprises (results follow
 * the input order of `declared` for creates/edits and `current` for
 * removes).
 */
export function diffCrons(declared: CronConfig[], current: BoxCron[]): CronPlan {
  const byName = new Map<string, BoxCron>();
  for (const c of current) byName.set(c.name, c);
  const declaredNames = new Set(declared.map(d => d.name));

  const creates: CronConfig[] = [];
  const edits: CronEdit[] = [];
  for (const d of declared) {
    const box = byName.get(d.name);
    if (!box) {
      creates.push(d);
      continue;
    }
    const changed = cronFieldsChanged(d, box);
    if (changed.length > 0) {
      edits.push({ id: box.id, name: d.name, declared: d, changed });
    }
  }

  const removes = current
    .filter(c => !declaredNames.has(c.name))
    .map(c => ({ id: c.id, name: c.name }));

  return { creates, edits, removes };
}

/** True when the plan would change nothing on the box. */
export function cronPlanIsEmpty(plan: CronPlan): boolean {
  return plan.creates.length === 0 && plan.edits.length === 0 && plan.removes.length === 0;
}

/**
 * Stable content hash of the declared cron set, for the deploy short-circuit
 * (`last_cron_hash` in state). Order-independent (sorted by name) and only
 * over declarative fields, so reordering or reformatting the toml does not
 * force a needless reconcile.
 */
export function computeCronHash(crons: CronConfig[]): string {
  const canon = [...crons]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => ({
      name: c.name,
      schedule: c.schedule,
      prompt: c.prompt ?? '',
      skills: [...c.skills].sort(),
      deliver: c.deliver ?? '',
      enabled: c.enabled,
      repeat: c.repeat ?? null,
      script: c.script ?? '',
      workdir: c.workdir ?? '',
    }));
  return `sha256:${createHash('sha256').update(JSON.stringify(canon)).digest('hex')}`;
}
