import { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { JobDrawer } from '../jobs/JobDrawer';
import type { StatusPayloadDto } from '@hermes/dto';
import type { Navigate } from '../../lib/types';

interface InfraTabProps {
  name: string;
  status: StatusPayloadDto | undefined;
  navigate: Navigate;
}

function healthBadge(h: string) {
  if (h === 'healthy') return 'bg-emerald-900/30 text-emerald-400';
  if (h === 'unhealthy') return 'bg-red-900/30 text-red-400';
  return 'bg-yellow-900/30 text-yellow-400';
}

function stateBadge(s: string) {
  if (s === 'running') return 'bg-emerald-900/30 text-emerald-400';
  if (s === 'stopped' || s === 'terminated') return 'bg-red-900/30 text-red-400';
  return 'bg-yellow-900/30 text-yellow-400';
}

function InfoRow({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className="text-slate-500 text-sm">{label}</span>
      {badge ? (
        <span className={`text-xs px-2 py-0.5 rounded ${badge}`}>{value}</span>
      ) : (
        <span className="text-slate-200 text-sm font-mono">{value || '\u2014'}</span>
      )}
    </div>
  );
}

export function InfraTab({ name, status, navigate }: InfraTabProps) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  async function runAction(action: 'update' | 'destroy') {
    setError('');
    try {
      const body = action === 'destroy' ? { confirm: true } : {};
      const res = await apiFetch<{ jobId: string }>(
        `/api/deployments/${encodeURIComponent(name)}/${action}`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setJobId(res.jobId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Action failed');
    }
  }

  function startDestroy() {
    setConfirmDestroy(true);
    timerRef.current = setTimeout(() => setConfirmDestroy(false), 5000);
  }

  const stored = status?.stored;
  const live = status?.live;

  return (
    <div className="p-5 max-w-4xl">
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-server mr-2 text-indigo-500" />Deployment Info
          </h3>
          <InfoRow label="Cloud" value={stored?.cloud?.toUpperCase() ?? '\u2014'} />
          <InfoRow label="Region" value={stored?.region ?? '\u2014'} />
          <InfoRow label="IP" value={stored?.instance_ip ?? '\u2014'} />
          <InfoRow label="Health" value={stored?.health ?? 'unknown'} badge={healthBadge(stored?.health ?? 'unknown')} />
          <InfoRow label="Last Deployed" value={stored?.last_deployed_at ? new Date(stored.last_deployed_at).toLocaleString() : '\u2014'} />
        </div>
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-satellite-dish mr-2 text-indigo-500" />Live State
          </h3>
          {live ? (
            <>
              <InfoRow label="Instance" value={live.state} badge={stateBadge(live.state)} />
              <InfoRow label="Public IP" value={live.publicIp ?? '\u2014'} />
              <InfoRow label="Config Hash" value={stored?.last_config_hash?.slice(0, 12) ?? '\u2014'} />
              <InfoRow label="Nix Hash" value={stored?.last_nix_hash?.slice(0, 12) ?? '\u2014'} />
            </>
          ) : (
            <p className="text-slate-500 text-sm">No live state available</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-key mr-2 text-indigo-500" />Paths
          </h3>
          <InfoRow label="SSH Key" value={stored?.ssh_key_path ?? '\u2014'} />
          <InfoRow label="Age Key" value={stored?.age_key_path ?? '\u2014'} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-2">
            <i className="fa-solid fa-arrow-up-from-bracket mr-2 text-indigo-500" />Update
          </h3>
          <p className="text-xs text-slate-500 mb-3">Push config changes to the running instance.</p>
          <button
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors"
            onClick={() => runAction('update')}
          >
            Update
          </button>
        </div>
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-2">
            <i className="fa-solid fa-trash mr-2 text-red-400" />Destroy
          </h3>
          <p className="text-xs text-slate-500 mb-3">Tear down all cloud resources for this agent.</p>
          {confirmDestroy ? (
            <button
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded transition-colors"
              onClick={() => { setConfirmDestroy(false); runAction('destroy'); }}
            >
              Confirm Destroy
            </button>
          ) : (
            <button
              className="px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-sm rounded transition-colors"
              onClick={startDestroy}
            >
              Destroy
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-900/20 border border-red-800/30 rounded text-red-400 text-sm">{error}</div>
      )}

      {jobId && (
        <div className="mt-4">
          <JobDrawer
            jobId={jobId}
            onClose={() => setJobId(null)}
            onFullScreen={() => navigate({ page: 'job', jobId })}
          />
        </div>
      )}
    </div>
  );
}
