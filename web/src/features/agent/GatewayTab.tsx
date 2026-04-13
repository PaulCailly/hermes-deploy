import { StatusPulse } from '../../components/shared/StatusPulse';
import { PlatformIcon, platformLabel } from '../../components/shared/PlatformIcon';
import { getMockGatewayState } from '../../lib/mock-data';

export function GatewayTab() {
  const gw = getMockGatewayState();

  return (
    <div className="p-5 max-w-4xl">
      {/* Gateway Status */}
      <div className="flex items-center gap-3 mb-5 bg-[#161822] border border-[#2a2d3a] rounded-lg p-3.5">
        <div className="flex items-center gap-2 flex-1">
          <i className="fa-solid fa-tower-broadcast text-indigo-500 text-base" />
          <div>
            <div className="text-sm font-semibold text-slate-200">Gateway</div>
            <div className="text-[11px] text-slate-500">
              {gw.isRunning ? `PID ${gw.pid} · uptime ${gw.uptime}` : 'Not running'}
            </div>
          </div>
        </div>
        <StatusPulse status={gw.isRunning ? 'online' : 'offline'} size={10} />
        <span className={`text-[12px] font-medium ${gw.isRunning ? 'text-green-500' : 'text-slate-500'}`}>
          {gw.isRunning ? 'Running' : 'Stopped'}
        </span>
        <div className="flex gap-1.5 ml-3">
          <button className="text-[10px] text-slate-500 bg-[#1e2030] px-2.5 py-1.5 rounded hover:text-slate-300 transition-colors">
            <i className="fa-solid fa-rotate-right mr-1" />Restart
          </button>
          <button className="text-[10px] text-red-400 bg-red-500/10 px-2.5 py-1.5 rounded hover:text-red-300 transition-colors">
            <i className="fa-solid fa-stop mr-1" />Stop
          </button>
        </div>
      </div>

      {/* Connected Platforms */}
      <div className="text-[13px] font-semibold text-slate-200 mb-3">Connected Platforms</div>
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
              {p.connected ? `${p.sessionCount} sessions · ${p.trafficPercent}% traffic` : 'Not configured'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
