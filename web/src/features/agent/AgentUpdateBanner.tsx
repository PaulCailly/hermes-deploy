import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { JobDrawer } from '../jobs/JobDrawer';
import type { Navigate } from '../../lib/types';

interface UpdateCheckResponse {
  hermesAgent: {
    latest: {
      tag: string;
      name: string;
      publishedAt: string;
      body: string;
    } | null;
  };
}

interface AgentUpdateBannerProps {
  name: string;
  lockedRev?: string;
  lockedDate?: string;
  lockedTag?: string;
  navigate: Navigate;
}

export function AgentUpdateBanner({ name, lockedRev, lockedDate, lockedTag, navigate }: AgentUpdateBannerProps) {
  const [showChangelog, setShowChangelog] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['update-check'],
    queryFn: () => apiFetch<UpdateCheckResponse>('/api/updates'),
    refetchInterval: 60_000,
    retry: false,
  });

  const latest = data?.hermesAgent.latest;
  if (!latest || !lockedDate) return null;

  const lockedTime = new Date(lockedDate).getTime();
  const latestTime = new Date(latest.publishedAt).getTime();
  if (lockedTime >= latestTime) return null;

  const deployedLabel = lockedTag || (lockedRev ? lockedRev.slice(0, 10) : 'unknown');

  async function triggerUpgrade() {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiFetch<{ jobId: string }>(
        `/api/deployments/${encodeURIComponent(name)}/upgrade`,
        { method: 'POST' },
      );
      setJobId(res.jobId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upgrade failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="px-4 py-3 flex items-start gap-3 border-b bg-indigo-500/10 border-indigo-500/30 text-sm">
        <i className="fa-solid fa-arrow-up-right-dots text-indigo-400 text-base mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-indigo-300">{latest.name} available</div>
          <div className="text-[12px] text-slate-400 mt-0.5 leading-relaxed">
            Deployed: {deployedLabel}
            <button
              className="ml-3 text-indigo-400 hover:text-indigo-300 underline"
              onClick={() => setShowChangelog((v) => !v)}
            >
              {showChangelog ? 'Hide changelog' : 'View changelog'}
            </button>
          </div>
          {showChangelog && (
            <div className="mt-3 p-3 bg-black/20 rounded text-[12px] text-slate-300 leading-relaxed max-h-64 overflow-auto whitespace-pre-wrap">
              {latest.body}
            </div>
          )}
          {error && <div className="mt-2 text-red-400 text-[12px]">{error}</div>}
        </div>
        <button
          className="text-[12px] bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded transition-colors flex-shrink-0"
          onClick={triggerUpgrade}
          disabled={submitting || !!jobId}
        >
          {submitting ? (
            <><i className="fa-solid fa-spinner fa-spin mr-1" />Upgrading...</>
          ) : (
            <><i className="fa-solid fa-download mr-1" />Upgrade</>
          )}
        </button>
      </div>
      {jobId && (
        <div className="px-4 py-2">
          <JobDrawer
            jobId={jobId}
            onClose={() => setJobId(null)}
            onFullScreen={() => navigate({ page: 'job', jobId })}
          />
        </div>
      )}
    </>
  );
}
