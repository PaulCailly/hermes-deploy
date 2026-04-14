import { StatusPulse } from '../../components/shared/StatusPulse';
import { PlatformIcon, platformLabel } from '../../components/shared/PlatformIcon';
import { useAgentGateway } from '../../lib/agent-api';

interface GatewayTabProps {
  name: string;
}

export function GatewayTab({ name }: GatewayTabProps) {
  const gwQ = useAgentGateway(name);
  const gw = gwQ.data;

  if (gwQ.isLoading) {
    return <div className="p-5 text-slate-500 text-sm">Loading gateway state…</div>;
  }

  if (!gw) {
    return (
      <div className="p-5 text-slate-500 text-sm text-center">
        <i className="fa-solid fa-tower-broadcast text-3xl mb-3 block text-slate-600" />
        No gateway state found on this agent
      </div>
    );
  }

  return (
    <div className="p-5 max-w-4xl">
      {/* Gateway Status */}
      <div className="flex items-center gap-3 mb-5 bg-[#161822] border border-[#2a2d3a] rounded-lg p-3.5">
        <div className="flex items-center gap-2 flex-1">
          <i className="fa-solid fa-tower-broadcast text-indigo-500 text-base" />
          <div>
            <div className="text-sm font-semibold text-slate-200">Gateway</div>
            <div className="text-[11px] text-slate-500">
              {gw.isRunning && gw.pid ? `PID ${gw.pid}` : gw.isRunning ? 'Running' : 'Not running'}
            </div>
          </div>
        </div>
        <StatusPulse status={gw.isRunning ? 'online' : 'offline'} size={10} />
        <span className={`text-[12px] font-medium ${gw.isRunning ? 'text-green-500' : 'text-slate-500'}`}>
          {gw.isRunning ? 'Running' : 'Stopped'}
        </span>
      </div>

      {/* Connected Platforms */}
      <div className="text-[13px] font-semibold text-slate-200 mb-3">Platforms</div>
      {gw.platforms.length === 0 ? (
        <div className="text-slate-500 text-sm text-center py-6">No platforms configured</div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          {gw.platforms.map((p) => (
            <div
              key={p.name}
              className={`bg-[#161822] border rounded-lg p-3.5 ${
                p.connected ? 'border-[#2a2d3a]' : 'border-[#2a2d3a] opacity-50'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <PlatformIcon platform={p.name} className="text-lg" />
                <span className="text-[13px] font-medium text-slate-200">{platformLabel(p.name)}</span>
                <div className="ml-auto">
                  {p.connected ? (
                    <StatusPulse status="online" size={8} />
                  ) : (
                    <i className="fa-solid fa-circle text-slate-600 text-[6px]" />
                  )}
                </div>
              </div>
              <div className="text-[11px] text-slate-500">
                {p.connected ? 'Connected' : 'Not connected'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
