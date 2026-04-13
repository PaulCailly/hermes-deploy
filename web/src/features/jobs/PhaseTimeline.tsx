import type { ReporterEvent } from '@hermes/dto';

const PHASE_ORDER = [
  'validate',
  'ensure-keys',
  'provision',
  'wait-ssh',
  'bootstrap',
  'healthcheck',
] as const;

const PHASE_LABELS: Record<string, string> = {
  'validate': 'Validate',
  'ensure-keys': 'Keys',
  'provision': 'Provision',
  'wait-ssh': 'SSH',
  'bootstrap': 'Bootstrap',
  'healthcheck': 'Health',
};

type PhaseStatus = 'pending' | 'running' | 'done' | 'failed';

function derivePhaseStatuses(events: ReporterEvent[]): Map<string, PhaseStatus> {
  const statuses = new Map<string, PhaseStatus>();
  for (const p of PHASE_ORDER) statuses.set(p, 'pending');

  for (const event of events) {
    if (event.type === 'phase-start') statuses.set(event.id, 'running');
    else if (event.type === 'phase-done') statuses.set(event.id, 'done');
    else if (event.type === 'phase-fail') statuses.set(event.id, 'failed');
  }
  return statuses;
}

function statusIcon(s: PhaseStatus) {
  switch (s) {
    case 'done': return <span className="text-emerald-400">&#10003;</span>;
    case 'failed': return <span className="text-red-400">&#10007;</span>;
    case 'running': return <span className="text-indigo-400 animate-pulse">&#9679;</span>;
    default: return <span className="text-gray-600">&#9675;</span>;
  }
}

function statusColor(s: PhaseStatus) {
  switch (s) {
    case 'done': return 'border-emerald-500/40 bg-emerald-500/10';
    case 'failed': return 'border-red-500/40 bg-red-500/10';
    case 'running': return 'border-indigo-500/40 bg-indigo-500/10';
    default: return 'border-gray-800 bg-gray-900';
  }
}

interface Props {
  events: ReporterEvent[];
}

export function PhaseTimeline({ events }: Props) {
  const statuses = derivePhaseStatuses(events);

  return (
    <div className="flex gap-2 flex-wrap">
      {PHASE_ORDER.map((id, i) => {
        const s = statuses.get(id) ?? 'pending';
        return (
          <div key={id} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm ${statusColor(s)}`}>
              {statusIcon(s)}
              <span className="text-gray-200">{PHASE_LABELS[id]}</span>
            </div>
            {i < PHASE_ORDER.length - 1 && <span className="text-gray-700">&rarr;</span>}
          </div>
        );
      })}
    </div>
  );
}
