import { StatusPulse } from '../../components/shared/StatusPulse';
import { CloudIcon } from '../../components/shared/CloudIcon';
import type { StatusPayloadDto } from '@hermes/dto';

interface AgentHeaderProps {
  name: string;
  status: StatusPayloadDto | undefined;
}

export function AgentHeader({ name, status }: AgentHeaderProps) {
  const health = status?.stored?.health ?? 'unknown';
  const cloud = status?.stored?.cloud ?? '';
  const region = status?.stored?.region ?? '';

  return (
    <div className="px-5 py-3 border-b border-[#2a2d3a] flex items-center gap-3 bg-[#161822]">
      <StatusPulse
        status={health === 'healthy' ? 'online' : health === 'unhealthy' ? 'warning' : 'offline'}
        size={8}
      />
      <span className="font-semibold text-slate-200 text-sm">{name}</span>
      {cloud && (
        <span className="text-[11px] text-slate-500 bg-[#1e2030] px-2 py-0.5 rounded flex items-center gap-1.5">
          <CloudIcon cloud={cloud} className="text-[11px]" />
          {cloud.toUpperCase()} {region}
        </span>
      )}
      <span className="flex-1" />
      <span className={`text-[11px] flex items-center gap-1.5 ${
        health === 'healthy' ? 'text-green-500' : health === 'unhealthy' ? 'text-red-400' : 'text-slate-500'
      }`}>
        <StatusPulse
          status={health === 'healthy' ? 'online' : health === 'unhealthy' ? 'warning' : 'offline'}
          size={6}
        />
        {health}
      </span>
    </div>
  );
}
