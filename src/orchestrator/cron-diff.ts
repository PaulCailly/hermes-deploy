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
  repeat?: number;
  script?: string;
  workdir?: string;
}

/** An edit to an existing job, with the specific fields that drifted. */
export interface CronEdit {
  id: string;
  name: string;
  declared: CronConfig;
  /** Which declarative fields differ (for logging + the edit command). */
  changed: string[];
}

export interface CronPlan {
  creates: CronConfig[];
  edits: CronEdit[];
  removes: { id: string; name: string }[];
}

/**
 * Ordered skill comparison. hermes-agent loads a job's skills in order, so
 * reordering is a real behavioural change — this is deliberately NOT a set
 * comparison.
 */
function skillsDiffer(a: string[] | undefined, b: string[] | undefined): boolean {
  const sa = a ?? [];
  const sb = b ?? [];
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
  if ((declared.repeat ?? null) !== (box.repeat ?? null)) changed.push('repeat');
  if ((declared.script ?? '') !== (box.script ?? '')) changed.push('script');
  if ((declared.workdir ?? '') !== (box.workdir ?? '')) changed.push('workdir');
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
 * hermes-agent permits duplicate job names, so a declared name may map to
 * more than one box job. That is handled deterministically: the FIRST box
 * job (in box order) is reconciled, every additional same-name job is
 * removed. Otherwise duplicates would silently keep firing.
 *
 * Pure and deterministic: removes follow `current` order, creates follow
 * `declared` order.
 */
export function diffCrons(declared: CronConfig[], current: BoxCron[]): CronPlan {
  const declaredByName = new Map(declared.map(d => [d.name, d]));
  const reconciled = new Set<string>();

  const edits: CronEdit[] = [];
  const removes: { id: string; name: string }[] = [];
  for (const box of current) {
    const d = declaredByName.get(box.name);
    if (!d || reconciled.has(box.name)) {
      // Undeclared name, or a duplicate of an already-reconciled name.
      removes.push({ id: box.id, name: box.name });
      continue;
    }
    reconciled.add(box.name);
    const changed = cronFieldsChanged(d, box);
    if (changed.length > 0) {
      edits.push({ id: box.id, name: box.name, declared: d, changed });
    }
  }

  const creates = declared.filter(d => !reconciled.has(d.name));

  return { creates, edits, removes };
}

/** True when the plan would change nothing on the box. */
export function cronPlanIsEmpty(plan: CronPlan): boolean {
  return plan.creates.length === 0 && plan.edits.length === 0 && plan.removes.length === 0;
}
