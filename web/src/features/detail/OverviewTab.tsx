import type { StatusPayloadDto } from '@hermes/dto';

interface Props {
  status: StatusPayloadDto;
}

function healthBadge(health: string) {
  const colors: Record<string, string> = {
    healthy: 'bg-emerald-500/20 text-emerald-400',
    unhealthy: 'bg-red-500/20 text-red-400',
    unknown: 'bg-yellow-500/20 text-yellow-400',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[health] ?? colors.unknown}`}>{health}</span>;
}

function stateBadge(state: string) {
  const colors: Record<string, string> = {
    running: 'bg-emerald-500/20 text-emerald-400',
    stopped: 'bg-red-500/20 text-red-400',
    terminated: 'bg-red-500/20 text-red-400',
    pending: 'bg-yellow-500/20 text-yellow-400',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[state] ?? 'bg-gray-500/20 text-gray-400'}`}>{state}</span>;
}

export function OverviewTab({ status }: Props) {
  if (!status.stored) {
    return <div className="text-gray-400">Deployment not found in state.</div>;
  }

  const s = status.stored;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-medium text-gray-400 mb-4">Deployment Info</h3>
        <dl className="space-y-3">
          <Row label="Cloud" value={<span className="uppercase">{s.cloud}</span>} />
          <Row label="Region" value={s.region} />
          <Row label="IP Address" value={<span className="font-mono">{s.instance_ip}</span>} />
          <Row label="Health" value={healthBadge(s.health)} />
          <Row label="Last Deployed" value={new Date(s.last_deployed_at).toLocaleString()} />
        </dl>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-medium text-gray-400 mb-4">Live State</h3>
        <dl className="space-y-3">
          <Row label="Instance" value={status.live ? stateBadge(status.live.state) : 'N/A'} />
          <Row label="Public IP" value={<span className="font-mono">{status.live?.publicIp ?? 'N/A'}</span>} />
          <Row label="Config Hash" value={<span className="font-mono text-xs">{s.last_config_hash.slice(0, 16)}...</span>} />
          <Row label="Nix Hash" value={<span className="font-mono text-xs">{s.last_nix_hash.slice(0, 16)}...</span>} />
        </dl>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 md:col-span-2">
        <h3 className="text-sm font-medium text-gray-400 mb-4">Paths</h3>
        <dl className="space-y-3">
          <Row label="SSH Key" value={<span className="font-mono text-xs">{s.ssh_key_path}</span>} />
          <Row label="Age Key" value={<span className="font-mono text-xs">{s.age_key_path}</span>} />
        </dl>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center">
      <dt className="text-gray-400 text-sm">{label}</dt>
      <dd className="text-gray-200 text-sm">{value}</dd>
    </div>
  );
}
