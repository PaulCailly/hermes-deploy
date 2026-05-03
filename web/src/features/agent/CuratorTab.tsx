import { useState } from 'react';
import { useCurator } from '../../lib/agent-api';

interface CuratorTabProps {
  name: string;
  profile: string;
}

function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const gradeColors: Record<string, string> = {
  A: 'text-green-400',
  B: 'text-blue-400',
  C: 'text-amber-400',
  D: 'text-orange-400',
  F: 'text-red-400',
};

export function CuratorTab({ name, profile }: CuratorTabProps) {
  const curatorQ = useCurator(name, profile);
  const [showReport, setShowReport] = useState(false);

  if (curatorQ.isLoading) {
    return <div className="p-5 text-slate-500 text-sm">Loading curator data...</div>;
  }

  const data = curatorQ.data;

  if (!data || !data.enabled) {
    return (
      <div className="p-5 max-w-4xl">
        <div className="text-center py-10 bg-[#161822] border border-[#2a2d3a] rounded-lg">
          <i className="fa-solid fa-wand-magic-sparkles text-3xl mb-3 block text-slate-600" />
          <div className="text-slate-500 text-sm mb-1">Curator is not enabled</div>
          <div className="text-slate-600 text-[11px]">
            Enable it in config.yaml under <code className="text-slate-500">auxiliary.curator</code>
          </div>
        </div>
      </div>
    );
  }

  const runs = data.runs ?? [];
  const skillHealth = data.skillHealth ?? [];

  return (
    <div className="p-5 max-w-5xl">
      {/* Status bar */}
      <div className="flex items-center gap-4 mb-5 p-4 bg-[#161822] border border-[#2a2d3a] rounded-lg">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[12px] text-green-400 font-medium">Curator active</span>
        </div>
        <div className="h-4 border-l border-[#2a2d3a]" />
        <div className="text-[11px] text-slate-500">
          Last run: {data.lastRun ? (
            <span className="text-slate-300">{timeAgo(data.lastRun)}</span>
          ) : (
            <span className="text-slate-600">never</span>
          )}
        </div>
        {data.nextRun && (
          <>
            <div className="h-4 border-l border-[#2a2d3a]" />
            <div className="text-[11px] text-slate-500">
              Next run: <span className="text-slate-300">{timeAgo(data.nextRun)}</span>
            </div>
          </>
        )}
        <div className="ml-auto text-[11px] text-slate-500">
          {runs.length} run{runs.length !== 1 ? 's' : ''} recorded
        </div>
      </div>

      {/* Run history */}
      {runs.length > 0 && (
        <div className="mb-5">
          <div className="text-[13px] font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-clock-rotate-left text-indigo-500 mr-2" />
            Run History
          </div>
          <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[#2a2d3a] text-slate-500">
                  <th className="text-left px-4 py-2.5 font-medium">When</th>
                  <th className="text-right px-4 py-2.5 font-medium">Graded</th>
                  <th className="text-right px-4 py-2.5 font-medium">Pruned</th>
                  <th className="text-right px-4 py-2.5 font-medium">Consolidated</th>
                  <th className="text-right px-4 py-2.5 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {[...runs].reverse().map((run, i) => (
                  <tr key={i} className="border-b border-[#2a2d3a] last:border-0 hover:bg-[#1a1c2e]">
                    <td className="px-4 py-2.5 text-slate-300">{run.timestamp ? timeAgo(run.timestamp) : '—'}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{run.skillsGraded}</td>
                    <td className="px-4 py-2.5 text-right text-red-400">{run.skillsPruned}</td>
                    <td className="px-4 py-2.5 text-right text-amber-400">{run.skillsConsolidated}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{formatDuration(run.duration_s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Skill health */}
      {skillHealth.length > 0 && (
        <div className="mb-5">
          <div className="text-[13px] font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-heart-pulse text-indigo-500 mr-2" />
            Skill Health
          </div>
          <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[#2a2d3a] text-slate-500">
                  <th className="text-left px-4 py-2.5 font-medium">Skill</th>
                  <th className="text-right px-4 py-2.5 font-medium">Usage</th>
                  <th className="text-right px-4 py-2.5 font-medium">Last Used</th>
                  <th className="text-center px-4 py-2.5 font-medium">Grade</th>
                  <th className="text-center px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {skillHealth.map((s, i) => (
                  <tr key={i} className="border-b border-[#2a2d3a] last:border-0 hover:bg-[#1a1c2e]">
                    <td className="px-4 py-2.5 text-slate-300 font-mono">{s.name}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{s.usageCount}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{s.lastUsed ? timeAgo(s.lastUsed) : '—'}</td>
                    <td className={`px-4 py-2.5 text-center font-bold ${gradeColors[s.grade ?? ''] ?? 'text-slate-600'}`}>
                      {s.grade ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        s.status === 'active' ? 'bg-green-500/15 text-green-400' :
                        s.status === 'consolidated' ? 'bg-amber-500/15 text-amber-400' :
                        'bg-slate-500/15 text-slate-500'
                      }`}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Latest report */}
      {data.report && (
        <div>
          <button
            className="flex items-center gap-2 text-[13px] font-semibold text-slate-200 mb-3"
            onClick={() => setShowReport(!showReport)}
          >
            <i className="fa-solid fa-file-lines text-indigo-500" />
            Latest Report
            <i className={`fa-solid fa-chevron-${showReport ? 'up' : 'down'} text-slate-600 text-[10px] ml-1`} />
          </button>
          {showReport && (
            <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-5">
              <pre className="text-[11px] leading-[1.7] text-slate-400 whitespace-pre-wrap font-mono">
                {data.report}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
