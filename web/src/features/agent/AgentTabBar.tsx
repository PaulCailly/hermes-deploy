import type { AgentTab } from '../../lib/types';

interface AgentTabBarProps {
  active: AgentTab;
  onSelect: (tab: AgentTab) => void;
}

const operationTabs: { id: AgentTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'models', label: 'Models' },
  { id: 'curator', label: 'Curator' },
  { id: 'skills', label: 'Skills' },
  { id: 'cron', label: 'Cron' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'plugins', label: 'Plugins' },
];

const infraTabs: { id: AgentTab; label: string }[] = [
  { id: 'infra', label: 'Infra' },
  { id: 'config', label: 'Config' },
  { id: 'logs', label: 'Logs' },
  { id: 'ssh', label: 'SSH' },
  { id: 'secrets', label: 'Secrets' },
];

function TabButton({ id, label, active, onSelect }: {
  id: AgentTab; label: string; active: boolean; onSelect: (tab: AgentTab) => void;
}) {
  return (
    <button
      className={`px-3.5 py-2.5 text-[12px] border-b-2 transition-colors whitespace-nowrap ${
        active
          ? 'text-indigo-300 border-indigo-500 font-medium'
          : 'text-slate-500 border-transparent hover:text-slate-300'
      }`}
      onClick={() => onSelect(id)}
    >
      {label}
    </button>
  );
}

export function AgentTabBar({ active, onSelect }: AgentTabBarProps) {
  return (
    <div className="px-5 border-b border-[#2a2d3a] flex gap-0 bg-[#13141f] overflow-x-auto">
      {operationTabs.map((t) => (
        <TabButton key={t.id} {...t} active={active === t.id} onSelect={onSelect} />
      ))}
      <div className="border-l border-[#2a2d3a] ml-2 my-1" />
      {infraTabs.map((t) => (
        <TabButton key={t.id} {...t} active={active === t.id} onSelect={onSelect} />
      ))}
    </div>
  );
}
