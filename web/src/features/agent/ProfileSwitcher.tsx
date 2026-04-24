import { useAgentProfiles } from '../../lib/agent-api';
import type { AgentTab } from '../../lib/types';

const VM_SCOPED_TABS: AgentTab[] = ['infra', 'logs', 'ssh', 'secrets'];

interface ProfileSwitcherProps {
  name: string;
  activeProfile: string;
  activeTab: AgentTab;
  onSelect: (profile: string) => void;
}

export function ProfileSwitcher({ name, activeProfile, activeTab, onSelect }: ProfileSwitcherProps) {
  const { data: profiles } = useAgentProfiles(name);

  // Don't render if there's only one profile (or still loading)
  if (!profiles || profiles.length <= 1) return null;

  const isVmScoped = VM_SCOPED_TABS.includes(activeTab);

  return (
    <div className={`px-5 py-2 border-b border-[#2a2d3a] bg-[#13141f] flex items-center gap-2 ${isVmScoped ? 'opacity-50' : ''}`}>
      <span className="text-[11px] text-slate-500 mr-1">Profile:</span>
      <div className="flex gap-1">
        {profiles.map((p) => (
          <button
            key={p.name}
            onClick={() => onSelect(p.name)}
            disabled={isVmScoped}
            className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
              activeProfile === p.name
                ? 'bg-indigo-600 text-white font-medium'
                : isVmScoped
                  ? 'bg-gray-900 text-gray-600 cursor-not-allowed'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>
      {isVmScoped && (
        <span className="text-[10px] text-slate-600 ml-2">VM-scoped — applies to all profiles</span>
      )}
    </div>
  );
}
