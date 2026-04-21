import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { JobDrawer } from '../jobs/JobDrawer';
import type { StatusPayloadDto, DomainCheckDto } from '@hermes/dto';
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

function CheckRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className="text-slate-500 text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
        <span className="text-slate-200 text-sm font-mono">{detail}</span>
      </div>
    </div>
  );
}

function DomainCard({ domain }: { domain: DomainCheckDto }) {
  const c = domain.checks;
  return (
    <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
      <h3 className="text-sm font-semibold text-slate-200 mb-3">
        <i className="fa-solid fa-globe mr-2 text-indigo-500" />Domain
      </h3>
      <InfoRow label="Domain" value={domain.name} />
      <CheckRow
        label="DNS"
        ok={c.dns.ok && c.dns.matches}
        detail={c.dns.resolvedIp ? `${c.dns.resolvedIp}${c.dns.matches ? '' : ' (mismatch)'}` : 'unresolved'}
      />
      <CheckRow
        label="TLS"
        ok={c.tls.ok}
        detail={c.tls.expiresAt ? `expires ${c.tls.expiresAt.slice(0, 10)} (${c.tls.daysRemaining}d)` : 'no cert'}
      />
      <CheckRow
        label="nginx"
        ok={c.nginx.ok}
        detail={`${c.nginx.active ? 'active' : 'inactive'}, config ${c.nginx.configValid ? 'valid' : 'invalid'}`}
      />
      <CheckRow
        label="Upstream"
        ok={c.upstream.ok}
        detail={c.upstream.httpStatus !== null ? `HTTP ${c.upstream.httpStatus}` : 'unreachable'}
      />
      <CheckRow
        label="HTTPS"
        ok={c.https.ok}
        detail={c.https.httpStatus !== null ? `HTTP ${c.https.httpStatus}` : 'unreachable'}
      />
    </div>
  );
}

function AgentVersionCard({ stored }: { stored: StatusPayloadDto['stored'] }) {
  const agentVersion = (stored as any)?.hermes_agent_version;
  const lockedDate = agentVersion?.lockedDate;

  const { data } = useQuery({
    queryKey: ['update-check'],
    queryFn: () => apiFetch<{ hermesAgent: { latest: { tag: string; name: string; publishedAt: string } | null } }>('/api/updates'),
    refetchInterval: 60_000,
    retry: false,
  });

  const latest = data?.hermesAgent.latest;

  let statusLabel: React.ReactNode = null;
  if (lockedDate && latest) {
    const lockedTime = new Date(lockedDate).getTime();
    const latestTime = new Date(latest.publishedAt).getTime();
    if (lockedTime >= latestTime) {
      statusLabel = (
        <span className="text-xs px-2 py-0.5 rounded bg-emerald-900/30 text-emerald-400">
          up to date
        </span>
      );
    } else {
      statusLabel = (
        <span className="text-xs px-2 py-0.5 rounded bg-indigo-900/30 text-indigo-400">
          update available
        </span>
      );
    }
  }

  return (
    <div className="grid grid-cols-2 gap-4 mb-6">
      <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-200 mb-3">
          <i className="fa-solid fa-code-branch mr-2 text-indigo-500" />Hermes Agent
        </h3>
        <InfoRow
          label="Revision"
          value={agentVersion?.lockedTag || agentVersion?.lockedRev?.slice(0, 12) || '\u2014'}
        />
        <InfoRow
          label="Lock Date"
          value={lockedDate ? new Date(lockedDate).toLocaleDateString() : '\u2014'}
        />
        {latest && (
          <InfoRow
            label="Latest Release"
            value={latest.name}
          />
        )}
        <div className="flex justify-between items-center py-1.5">
          <span className="text-slate-500 text-sm">Status</span>
          {statusLabel ?? <span className="text-slate-500 text-sm">{'\u2014'}</span>}
        </div>
      </div>
    </div>
  );
}

export function InfraTab({ name, status, navigate }: InfraTabProps) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  async function runAction(action: 'update' | 'destroy') {
    if (submitting) return;
    setSubmitting(true);
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
    } finally {
      setSubmitting(false);
    }
  }

  function startDestroy() {
    setConfirmDestroy(true);
    timerRef.current = setTimeout(() => setConfirmDestroy(false), 5000);
  }

  const stored = status?.stored;
  const live = status?.live;
  const domain = status?.domain;

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

      {domain && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <DomainCard domain={domain} />
        </div>
      )}

      {/* Agent Version card */}
      <AgentVersionCard stored={stored} />

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
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
            onClick={() => runAction('update')}
            disabled={submitting || !!jobId}
          >
            {submitting ? <><i className="fa-solid fa-spinner fa-spin mr-1" />Starting…</> : 'Update'}
          </button>
        </div>
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-2">
            <i className="fa-solid fa-trash mr-2 text-red-400" />Destroy
          </h3>
          <p className="text-xs text-slate-500 mb-3">Tear down all cloud resources for this agent.</p>
          {confirmDestroy ? (
            <button
              className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
              onClick={() => { setConfirmDestroy(false); runAction('destroy'); }}
              disabled={submitting || !!jobId}
            >
              {submitting ? <><i className="fa-solid fa-spinner fa-spin mr-1" />Starting…</> : 'Confirm Destroy'}
            </button>
          ) : (
            <button
              className="px-4 py-2 bg-red-900/30 hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed text-red-400 text-sm rounded transition-colors"
              onClick={startDestroy}
              disabled={submitting || !!jobId}
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
