import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { JobDrawer } from '../jobs/JobDrawer';

interface Props {
  name: string;
  onJob: (jobId: string) => void;
  onRefresh: () => void;
}

export function ActionsTab({ name, onJob, onRefresh }: Props) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDestroy, setConfirmDestroy] = useState(false);

  const runAction = async (action: 'update' | 'destroy') => {
    setError(null);
    try {
      const body = action === 'destroy' ? { confirm: true } : {};
      const res = await apiFetch<{ jobId: string }>(
        `/api/deployments/${encodeURIComponent(name)}/${action}`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setActiveJobId(res.jobId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ActionCard
          title="Update"
          description="Push config changes to the running instance. Skips provisioning."
          buttonLabel="Run update"
          buttonClass="bg-indigo-600 hover:bg-indigo-500"
          onClick={() => runAction('update')}
        />

        <ActionCard
          title="Destroy"
          description="Tear down all cloud resources and remove the deployment."
          buttonLabel={confirmDestroy ? 'Confirm destroy' : 'Destroy'}
          buttonClass="bg-red-600 hover:bg-red-500"
          onClick={() => {
            if (!confirmDestroy) {
              setConfirmDestroy(true);
              setTimeout(() => setConfirmDestroy(false), 5000);
              return;
            }
            setConfirmDestroy(false);
            runAction('destroy');
          }}
        />
      </div>

      {activeJobId && (
        <JobDrawer
          jobId={activeJobId}
          onClose={() => { setActiveJobId(null); onRefresh(); }}
          onFullScreen={() => { onJob(activeJobId); }}
        />
      )}
    </div>
  );
}

function ActionCard({
  title,
  description,
  buttonLabel,
  buttonClass,
  onClick,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  buttonClass: string;
  onClick: () => void;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 className="font-semibold text-white mb-2">{title}</h3>
      <p className="text-gray-400 text-sm mb-4">{description}</p>
      <button
        onClick={onClick}
        className={`px-4 py-2 text-white rounded-lg text-sm font-medium transition-colors ${buttonClass}`}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
