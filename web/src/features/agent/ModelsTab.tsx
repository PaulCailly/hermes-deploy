import { useModels } from '../../lib/agent-api';
import { ModelIcon } from '../../components/shared/ModelIcon';

interface ModelsTabProps {
  name: string;
  profile: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
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

export function ModelsTab({ name, profile }: ModelsTabProps) {
  const modelsQ = useModels(name, profile);

  if (modelsQ.isLoading) {
    return <div className="p-5 text-slate-500 text-sm">Loading models data...</div>;
  }

  const data = modelsQ.data;
  const stats = data?.stats ?? [];
  const config = data?.config;
  const maxCost = Math.max(...stats.map(s => s.totalCostUSD), 0.01);

  const auxEntries = Object.entries(config?.auxiliary ?? {}).filter(
    ([, v]) => v.model && v.model !== '',
  );

  return (
    <div className="p-5 max-w-5xl">
      {/* Active models cards */}
      <div className="text-[13px] font-semibold text-slate-200 mb-3">
        <i className="fa-solid fa-microchip text-indigo-500 mr-2" />
        Active Models
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        {config?.default && (
          <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <ModelIcon model={config.default} size={16} />
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">default</span>
            </div>
            <div className="text-[13px] text-slate-200 font-mono">{config.default}</div>
            <div className="text-[10px] text-slate-500 mt-1">{config.provider}</div>
          </div>
        )}

        {auxEntries.map(([key, val]) => (
          <div key={key} className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <ModelIcon model={val.model ?? ''} size={16} />
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400">{key}</span>
            </div>
            <div className="text-[13px] text-slate-200 font-mono">{val.model}</div>
            {val.provider && <div className="text-[10px] text-slate-500 mt-1">{val.provider}</div>}
          </div>
        ))}

        {!config?.default && auxEntries.length === 0 && (
          <div className="col-span-full text-center py-6 bg-[#161822] border border-[#2a2d3a] rounded-lg">
            <div className="text-slate-500 text-[11px]">No model config found</div>
          </div>
        )}
      </div>

      {/* Usage stats table */}
      <div className="text-[13px] font-semibold text-slate-200 mb-3">
        <i className="fa-solid fa-chart-bar text-indigo-500 mr-2" />
        Usage Stats
      </div>

      {stats.length === 0 ? (
        <div className="text-center py-10 bg-[#161822] border border-[#2a2d3a] rounded-lg">
          <i className="fa-solid fa-chart-bar text-3xl mb-3 block text-slate-600" />
          <div className="text-slate-500 text-sm mb-1">No model usage data yet</div>
          <div className="text-slate-600 text-[11px]">Stats will appear after the agent processes sessions</div>
        </div>
      ) : (
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-[#2a2d3a] text-slate-500">
                <th className="text-left px-4 py-2.5 font-medium">Model</th>
                <th className="text-right px-4 py-2.5 font-medium">Sessions</th>
                <th className="text-right px-4 py-2.5 font-medium">Tokens In</th>
                <th className="text-right px-4 py-2.5 font-medium">Tokens Out</th>
                <th className="text-right px-4 py-2.5 font-medium">Cost</th>
                <th className="text-left px-4 py-2.5 font-medium w-32">Cost %</th>
                <th className="text-right px-4 py-2.5 font-medium">Last Used</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={i} className="border-b border-[#2a2d3a] last:border-0 hover:bg-[#1a1c2e]">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <ModelIcon model={s.model} size={14} />
                      <span className="text-slate-300 font-mono">{s.model}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-400">{s.totalSessions}</td>
                  <td className="px-4 py-2.5 text-right text-slate-400">{formatTokens(s.totalTokensIn)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-400">{formatTokens(s.totalTokensOut)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-300 font-medium">{formatCost(s.totalCostUSD)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-[#2a2d3a] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${Math.max((s.totalCostUSD / maxCost) * 100, 2)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-600 w-8 text-right">
                        {((s.totalCostUSD / Math.max(stats.reduce((a, b) => a + b.totalCostUSD, 0), 0.01)) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{s.lastUsed ? timeAgo(s.lastUsed) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
