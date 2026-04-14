import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

interface ServerInfo {
  version: string;
  buildTime: string;
  uptime: number;
}

const POLL_INTERVAL_KEY = 'hermes-deploy-poll-interval';

function getStoredInterval(): number {
  const raw = localStorage.getItem(POLL_INTERVAL_KEY);
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 15;
}

function setStoredInterval(seconds: number) {
  localStorage.setItem(POLL_INTERVAL_KEY, String(seconds));
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function SettingsPage() {
  const infoQ = useQuery({
    queryKey: ['server-info'],
    queryFn: () => apiFetch<ServerInfo>('/api/info'),
    refetchInterval: 60_000,
  });

  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pollInterval, setPollInterval] = useState(() => getStoredInterval());

  useEffect(() => {
    setStoredInterval(pollInterval);
  }, [pollInterval]);

  const token = sessionStorage.getItem('hermes-deploy-token') ?? '';
  const hasToken = Boolean(token);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = token;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-slate-200">
          <i className="fa-solid fa-gear text-indigo-500 mr-2" />Settings
        </h1>
      </div>

      {/* Connection */}
      <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-200 mb-4">
          <i className="fa-solid fa-plug text-indigo-500 mr-2" />Connection
        </h2>

        <div className="space-y-3">
          <Row label="API URL" value={<code className="text-sm text-slate-300 font-mono">{origin}</code>} />
          <Row
            label="Auth Token"
            value={
              hasToken ? (
                <div className="flex items-center gap-2">
                  <code className="text-sm text-slate-300 font-mono">
                    {showToken ? token : `${token.slice(0, 8)}…${token.slice(-4)}`}
                  </code>
                  <button
                    className="text-[11px] text-slate-500 hover:text-slate-300"
                    onClick={() => setShowToken((v) => !v)}
                    title={showToken ? 'Hide' : 'Show'}
                  >
                    <i className={`fa-solid ${showToken ? 'fa-eye-slash' : 'fa-eye'}`} />
                  </button>
                  <button
                    className="text-[11px] text-slate-500 hover:text-slate-300"
                    onClick={copyToken}
                    title="Copy"
                  >
                    {copied ? (
                      <span className="text-green-500"><i className="fa-solid fa-check mr-1" />Copied</span>
                    ) : (
                      <i className="fa-solid fa-copy" />
                    )}
                  </button>
                </div>
              ) : (
                <span className="text-slate-500 text-sm italic">No token (auth disabled)</span>
              )
            }
          />
        </div>
      </div>

      {/* Preferences */}
      <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-200 mb-4">
          <i className="fa-solid fa-sliders text-indigo-500 mr-2" />Preferences
        </h2>

        <div className="space-y-4">
          <div>
            <div className="text-[13px] text-slate-300 mb-1">Refetch interval (seconds)</div>
            <div className="text-[11px] text-slate-500 mb-2">
              How often stats and session lists refresh. Live session messages always stream in real-time via WebSocket.
              Change takes effect after page reload.
            </div>
            <div className="flex gap-1.5">
              {[5, 10, 15, 30, 60].map((s) => (
                <button
                  key={s}
                  className={`text-[12px] px-3 py-1.5 rounded transition-colors ${
                    pollInterval === s
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      : 'bg-[#1e2030] text-slate-400 border border-[#2a2d3a] hover:text-slate-200'
                  }`}
                  onClick={() => setPollInterval(s)}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-200 mb-4">
          <i className="fa-solid fa-circle-info text-indigo-500 mr-2" />About
        </h2>

        <div className="space-y-3">
          <Row
            label="Version"
            value={
              infoQ.isLoading ? (
                <span className="text-slate-500 text-sm">Loading…</span>
              ) : (
                <code className="text-sm text-slate-300 font-mono">{infoQ.data?.version ?? 'unknown'}</code>
              )
            }
          />
          <Row
            label="Server Uptime"
            value={
              infoQ.isLoading ? (
                <span className="text-slate-500 text-sm">…</span>
              ) : (
                <span className="text-sm text-slate-300">{formatUptime(infoQ.data?.uptime ?? 0)}</span>
              )
            }
          />
          <Row
            label="Source"
            value={
              <a
                href="https://github.com/PaulCailly/hermes-deploy"
                target="_blank"
                rel="noreferrer"
                className="text-sm text-indigo-400 hover:text-indigo-300"
              >
                <i className="fa-brands fa-github mr-1" />
                PaulCailly/hermes-deploy
              </a>
            }
          />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-[13px] text-slate-500">{label}</span>
      <div>{value}</div>
    </div>
  );
}
