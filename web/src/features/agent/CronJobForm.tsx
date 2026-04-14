import { useState } from 'react';
import type { AgentCronJob } from '../../lib/agent-types';
import type { CronJobInput } from '../../lib/agent-api';

interface CronJobFormProps {
  initial?: AgentCronJob;
  onCancel: () => void;
  onSubmit: (input: CronJobInput) => void | Promise<void>;
  busy?: boolean;
  error?: string | null;
}

const SCHEDULE_KINDS = ['once', 'daily', 'weekly', 'cron'] as const;

export function CronJobForm({ initial, onCancel, onSubmit, busy, error }: CronJobFormProps) {
  const [jobName, setJobName] = useState(initial?.name ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [deliver, setDeliver] = useState(initial?.deliver ?? '');
  const [scheduleKind, setScheduleKind] = useState<string>(initial?.schedule.kind ?? 'daily');
  const [scheduleDisplay, setScheduleDisplay] = useState(initial?.schedule.display ?? '');
  const [scheduleExpression, setScheduleExpression] = useState(initial?.schedule.expression ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  const canSubmit = jobName.trim().length > 0 && prompt.trim().length > 0 && !busy;

  function handleSubmit() {
    if (!canSubmit) return;
    const schedule: CronJobInput['schedule'] = { kind: scheduleKind };
    if (scheduleDisplay.trim()) schedule.display = scheduleDisplay.trim();
    if (scheduleExpression.trim()) schedule.expression = scheduleExpression.trim();

    onSubmit({
      name: jobName.trim(),
      prompt: prompt.trim(),
      schedule,
      enabled,
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(deliver.trim() ? { deliver: deliver.trim() } : {}),
    });
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg w-full max-w-lg shadow-2xl">
        <div className="px-5 py-4 border-b border-[#2a2d3a] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">
            <i className="fa-solid fa-calendar-plus text-indigo-500 mr-2" />
            {initial ? 'Edit Cron Job' : 'New Cron Job'}
          </h2>
          <button className="text-slate-500 hover:text-slate-300" onClick={onCancel}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <Field label="Name">
            <input
              className="w-full bg-[#0d1117] border border-[#2a2d3a] rounded px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
              placeholder="Weekly analytics report"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
            />
          </Field>

          <Field label="Prompt">
            <textarea
              className="w-full bg-[#0d1117] border border-[#2a2d3a] rounded px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500 font-mono min-h-[80px]"
              placeholder="Generate the weekly analytics report and deliver via email"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Schedule Kind">
              <select
                className="w-full bg-[#0d1117] border border-[#2a2d3a] rounded px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
                value={scheduleKind}
                onChange={(e) => setScheduleKind(e.target.value)}
              >
                {SCHEDULE_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </Field>

            <Field label="Display (human-readable)">
              <input
                className="w-full bg-[#0d1117] border border-[#2a2d3a] rounded px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
                placeholder="Mon 9:00"
                value={scheduleDisplay}
                onChange={(e) => setScheduleDisplay(e.target.value)}
              />
            </Field>
          </div>

          {scheduleKind === 'cron' && (
            <Field label="Cron Expression">
              <input
                className="w-full bg-[#0d1117] border border-[#2a2d3a] rounded px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500 font-mono"
                placeholder="0 9 * * 1"
                value={scheduleExpression}
                onChange={(e) => setScheduleExpression(e.target.value)}
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Model (optional)">
              <input
                className="w-full bg-[#0d1117] border border-[#2a2d3a] rounded px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
                placeholder="claude-sonnet-4-6"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </Field>

            <Field label="Deliver (optional)">
              <input
                className="w-full bg-[#0d1117] border border-[#2a2d3a] rounded px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
                placeholder="email, slack, telegram..."
                value={deliver}
                onChange={(e) => setDeliver(e.target.value)}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-indigo-500"
            />
            Enabled
          </label>

          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#2a2d3a] flex gap-2 justify-end">
          <button
            className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 rounded transition-colors"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {busy ? <i className="fa-solid fa-spinner fa-spin mr-1" /> : null}
            {initial ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500 mb-1">{label}</div>
      {children}
    </div>
  );
}
