import { useState } from 'react';
import { StatusPulse } from '../../components/shared/StatusPulse';
import { useAgentCron, useCronToggle, useCronCreate, useCronUpdate, useCronDelete } from '../../lib/agent-api';
import { CronJobForm } from './CronJobForm';
import type { AgentCronJob } from '../../lib/agent-types';
import type { CronJobInput } from '../../lib/agent-api';

interface CronTabProps {
  name: string;
  profile: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export function CronTab({ name, profile }: CronTabProps) {
  const jobsQ = useAgentCron(name, profile);
  const toggleM = useCronToggle(name, profile);
  const createM = useCronCreate(name, profile);
  const updateM = useCronUpdate(name, profile);
  const deleteM = useCronDelete(name, profile);

  const [editing, setEditing] = useState<AgentCronJob | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const jobs = jobsQ.data ?? [];
  const enabledCount = jobs.filter((j) => j.enabled).length;
  // Serialize all cron writes client-side too — the server mutex handles
  // correctness but blocking the UI avoids flashing stale state during
  // concurrent clicks.
  const isMutating = toggleM.isPending || createM.isPending || updateM.isPending || deleteM.isPending;

  async function handleCreate(input: CronJobInput) {
    setFormError(null);
    try {
      await createM.mutateAsync(input);
      setCreating(false);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'create failed');
    }
  }

  async function handleUpdate(input: CronJobInput) {
    if (!editing) return;
    setFormError(null);
    try {
      await updateM.mutateAsync({ jobId: editing.id, input });
      setEditing(null);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'update failed');
    }
  }

  async function handleDelete(jobId: string) {
    await deleteM.mutateAsync(jobId);
    setConfirmDelete(null);
  }

  return (
    <div className="p-5 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold text-slate-200">
          <i className="fa-solid fa-calendar-days text-indigo-500 mr-2" />Scheduled Jobs
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-500">{jobs.length} jobs · {enabledCount} enabled</span>
          <button
            className="text-[11px] px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
            onClick={() => { setCreating(true); setFormError(null); }}
            disabled={isMutating}
          >
            <i className="fa-solid fa-plus mr-1" />New Job
          </button>
        </div>
      </div>

      {jobsQ.isLoading ? (
        <div className="text-slate-500 text-sm text-center py-8">Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="text-slate-500 text-sm text-center py-8">
          <i className="fa-solid fa-calendar-xmark text-2xl mb-2 block text-slate-600" />
          No scheduled jobs
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {jobs.map((job) => {
            const isRunning = job.state === 'running';
            const isDisabled = !job.enabled;
            const isFailed = job.state === 'failed';
            const busyToggle = toggleM.isPending && toggleM.variables === job.id;
            const busyDelete = deleteM.isPending && deleteM.variables === job.id;

            return (
              <div
                key={job.id}
                className={`bg-[#161822] border rounded-lg p-3.5 ${
                  isRunning ? 'border-green-500/20' : 'border-[#2a2d3a]'
                } ${isDisabled ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {isRunning ? (
                    <StatusPulse status="online" size={10} />
                  ) : isFailed ? (
                    <i className="fa-solid fa-circle-xmark text-red-500 text-[10px]" />
                  ) : isDisabled ? (
                    <i className="fa-solid fa-circle-pause text-slate-600 text-[10px]" />
                  ) : (
                    <i className="fa-regular fa-clock text-indigo-500 text-[10px]" />
                  )}
                  <span className="text-[13px] font-medium text-slate-200 flex-1">{job.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded ${
                    isRunning ? 'text-green-500 bg-green-500/10' :
                    isFailed ? 'text-red-400 bg-red-500/10' :
                    isDisabled ? 'text-slate-500 bg-slate-500/10' :
                    'text-indigo-400 bg-indigo-500/10'
                  }`}>
                    {isDisabled ? 'disabled' : job.state}
                  </span>
                  <button
                    className={`text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      isDisabled
                        ? 'text-green-400 bg-green-500/10 hover:bg-green-500/20'
                        : 'text-slate-400 bg-[#1e2030] hover:bg-[#26283a]'
                    }`}
                    onClick={() => toggleM.mutate(job.id)}
                    disabled={isMutating || !job.id}
                    title={isDisabled ? 'Enable job' : 'Disable job'}
                  >
                    {busyToggle ? (
                      <i className="fa-solid fa-spinner fa-spin" />
                    ) : isDisabled ? (
                      <><i className="fa-solid fa-play mr-1" />Enable</>
                    ) : (
                      <><i className="fa-solid fa-pause mr-1" />Disable</>
                    )}
                  </button>
                  <button
                    className="text-[10px] px-2 py-1 rounded text-slate-400 bg-[#1e2030] hover:bg-[#26283a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    onClick={() => { setEditing(job); setFormError(null); }}
                    disabled={isMutating}
                    title="Edit job"
                  >
                    <i className="fa-solid fa-pen-to-square" />
                  </button>
                  <button
                    className="text-[10px] px-2 py-1 rounded text-red-400 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    onClick={() => setConfirmDelete(job.id)}
                    disabled={isMutating}
                    title="Delete job"
                  >
                    {busyDelete ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-trash" />}
                  </button>
                </div>

                {!isDisabled && job.prompt && (
                  <div className="text-[11px] text-slate-400 mb-2 font-mono bg-[#0d1117] p-1.5 px-2 rounded">
                    <i className="fa-solid fa-quote-left text-[8px] text-slate-600 mr-1" />
                    {job.prompt}
                  </div>
                )}

                <div className="flex gap-4 text-[11px] text-slate-500 flex-wrap">
                  <span><i className="fa-solid fa-repeat mr-1" />{job.schedule.display ?? job.schedule.expression ?? job.schedule.kind}</span>
                  {job.model && <span><i className="fa-solid fa-robot mr-1" />{job.model}</span>}
                  {job.deliver && <span><i className="fa-solid fa-paper-plane mr-1" />{job.deliver}</span>}
                  {job.lastRunAt && <span><i className="fa-solid fa-clock-rotate-left mr-1" />Last: {timeAgo(job.lastRunAt)}</span>}
                  {job.nextRunAt && <span><i className="fa-solid fa-forward mr-1" />Next: {job.nextRunAt}</span>}
                </div>
                {job.lastError && (
                  <div className="mt-2 text-[11px] text-red-400 bg-red-500/5 border border-red-500/15 rounded p-1.5 px-2 font-mono">
                    {job.lastError}
                  </div>
                )}

                {confirmDelete === job.id && (
                  <div className="mt-2 flex items-center gap-2 p-2 bg-red-500/5 border border-red-500/20 rounded">
                    <span className="text-[11px] text-red-400 flex-1">Delete this job?</span>
                    <button
                      className="text-[10px] px-2 py-1 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                      onClick={() => handleDelete(job.id)}
                      disabled={isMutating}
                    >
                      {busyDelete ? <i className="fa-solid fa-spinner fa-spin" /> : 'Delete'}
                    </button>
                    <button
                      className="text-[10px] px-2 py-1 rounded text-slate-400 hover:text-slate-200 transition-colors"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <CronJobForm
          onCancel={() => { setCreating(false); setFormError(null); }}
          onSubmit={handleCreate}
          busy={createM.isPending}
          error={formError}
        />
      )}

      {editing && (
        <CronJobForm
          initial={editing}
          onCancel={() => { setEditing(null); setFormError(null); }}
          onSubmit={handleUpdate}
          busy={updateM.isPending}
          error={formError}
        />
      )}
    </div>
  );
}
