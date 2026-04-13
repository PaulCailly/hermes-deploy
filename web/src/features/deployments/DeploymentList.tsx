import { useDeployments } from './useDeployments';

interface Props {
  onSelect: (name: string) => void;
  onNew: () => void;
}

function healthColor(health: string): string {
  switch (health) {
    case 'healthy': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'unhealthy': return 'bg-red-500/20 text-red-400 border-red-500/30';
    default: return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  }
}

function stateColor(state?: string): string {
  switch (state) {
    case 'running': return 'text-emerald-400';
    case 'stopped':
    case 'terminated': return 'text-red-400';
    default: return 'text-yellow-400';
  }
}

export function DeploymentList({ onSelect, onNew }: Props) {
  const { data, isLoading, error } = useDeployments();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Deployments</h1>
          <p className="text-gray-400 text-sm mt-1">Manage your hermes-agent instances</p>
        </div>
        <button
          onClick={onNew}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + New deployment
        </button>
      </div>

      {isLoading && (
        <div className="text-gray-400 text-center py-12">Loading deployments...</div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 text-red-400">
          Failed to load deployments: {(error as Error).message}
        </div>
      )}

      {data && data.length === 0 && (
        <div className="text-center py-16">
          <div className="text-gray-500 text-lg mb-4">No deployments yet</div>
          <button
            onClick={onNew}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Create your first deployment
          </button>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((d) => (
            <button
              key={d.name}
              onClick={() => onSelect(d.name)}
              className="text-left bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 hover:bg-gray-900/80 transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-white group-hover:text-indigo-400 transition-colors truncate">
                  {d.name}
                </h3>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${healthColor(d.storedHealth)}`}>
                  {d.storedHealth}
                </span>
              </div>
              <div className="space-y-1.5 text-sm text-gray-400">
                <div className="flex justify-between">
                  <span>Cloud</span>
                  <span className="text-gray-300 uppercase">{d.cloud}</span>
                </div>
                <div className="flex justify-between">
                  <span>Region</span>
                  <span className="text-gray-300">{d.region}</span>
                </div>
                <div className="flex justify-between">
                  <span>IP</span>
                  <span className="text-gray-300 font-mono text-xs">{d.instanceIp}</span>
                </div>
                {d.liveState && (
                  <div className="flex justify-between">
                    <span>Live</span>
                    <span className={stateColor(d.liveState)}>{d.liveState}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Deployed</span>
                  <span className="text-gray-300 text-xs">{new Date(d.lastDeployedAt).toLocaleDateString()}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
