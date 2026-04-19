import { useState, useEffect } from 'react';
import { useOrgSkills } from '../../lib/agent-api';
import type { OrgSkill } from '../../lib/agent-api';
import type { Navigate } from '../../lib/types';

interface SkillsLibraryProps {
  navigate: Navigate;
}

export function SkillsLibrary({ navigate }: SkillsLibraryProps) {
  const skillsQ = useOrgSkills();
  const categories = skillsQ.data ?? [];
  const [filter, setFilter] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<OrgSkill | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!selectedSkill && categories.length > 0 && categories[0]!.skills.length > 0) {
      setSelectedSkill(categories[0]!.skills[0]!);
    }
  }, [categories, selectedSkill]);

  const totalSkills = categories.reduce((sum, c) => sum + c.skills.length, 0);
  const filteredCategories = categories.map((c) => ({
    ...c,
    skills: c.skills.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase())),
  })).filter((c) => c.skills.length > 0);

  function toggleCategory(catName: string) {
    setCollapsed((prev) => ({ ...prev, [catName]: !prev[catName] }));
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-[260px] border-r border-[#2a2d3a] flex flex-col flex-shrink-0 bg-[#13141f]">
        <div className="px-4 py-3 border-b border-[#2a2d3a]">
          <div className="text-sm font-semibold text-slate-200">
            <i className="fa-solid fa-book mr-2 text-indigo-500" />Skills Library
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">All skills across your fleet</div>
        </div>

        <div className="p-2.5 border-b border-[#2a2d3a]">
          <div className="flex items-center gap-2 bg-[#161822] border border-[#2a2d3a] rounded-md px-2.5 py-2">
            <i className="fa-solid fa-magnifying-glass text-slate-600 text-[11px]" />
            <input
              className="bg-transparent text-[11px] text-slate-200 outline-none flex-1 placeholder:text-slate-600"
              placeholder="Filter skills..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {skillsQ.isLoading ? (
            <div className="text-slate-500 text-sm text-center py-6">Loading…</div>
          ) : skillsQ.isError ? (
            <div className="text-red-400 text-sm text-center py-6 px-3">
              <i className="fa-solid fa-triangle-exclamation text-2xl mb-2 block text-red-500" />
              Failed to load skills
              <div className="text-[11px] text-slate-500 mt-1 break-words">
                {(skillsQ.error as Error)?.message ?? 'unknown error'}
              </div>
              <button
                className="mt-3 text-[11px] px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                onClick={() => skillsQ.refetch()}
              >
                Retry
              </button>
            </div>
          ) : categories.length === 0 ? (
            <div className="text-slate-500 text-sm text-center py-6">
              <i className="fa-solid fa-book text-2xl mb-2 block text-slate-600" />
              No skills installed on any agent
            </div>
          ) : (
            filteredCategories.map((cat) => (
              <div key={cat.name}>
                <button
                  className="w-full px-3 py-1.5 text-[10px] uppercase text-slate-500 tracking-wide text-left flex items-center gap-1 hover:text-slate-300 mt-2"
                  onClick={() => toggleCategory(cat.name)}
                >
                  <i className={`fa-solid ${collapsed[cat.name] ? 'fa-chevron-right' : 'fa-chevron-down'} text-[8px]`} />
                  {cat.name} ({cat.skills.length})
                </button>
                {!collapsed[cat.name] && cat.skills.map((skill) => (
                  <button
                    key={skill.id}
                    className={`w-full pl-6 pr-3 py-1.5 text-[12px] text-left transition-colors ${
                      selectedSkill?.id === skill.id ? 'text-indigo-300 bg-indigo-500/8 border-l-2 border-indigo-500' : 'text-slate-400 border-l-2 border-transparent hover:text-slate-200'
                    }`}
                    onClick={() => setSelectedSkill(skill)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{skill.name}</span>
                      <span className="text-[9px] text-slate-600 flex-shrink-0">{skill.agents.length}</span>
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="p-2.5 border-t border-[#2a2d3a] text-[11px] text-slate-600 bg-[#161822]">
          {totalSkills} skills · {categories.length} categories
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 flex flex-col bg-[#0f1117]">
        {selectedSkill ? (
          <>
            <div className="px-5 py-4 border-b border-[#2a2d3a] bg-[#161822]">
              <div className="text-base font-semibold text-slate-200">{selectedSkill.category} / {selectedSkill.name}</div>
              <div className="text-[11px] text-slate-500 mt-1">
                {selectedSkill.files.length} files
                {selectedSkill.requiredConfig.length > 0 && (
                  <> · requires: {selectedSkill.requiredConfig.map((k) => (
                    <code key={k} className="bg-[#1e2030] px-1 py-0.5 rounded text-[10px] ml-1 text-amber-400">{k}</code>
                  ))}</>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {/* Installed on */}
              <div className="mb-5">
                <div className="text-[11px] text-slate-500 mb-2">
                  <i className="fa-solid fa-robot mr-1 text-indigo-500" />
                  Installed on {selectedSkill.agents.length} agent{selectedSkill.agents.length === 1 ? '' : 's'}
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedSkill.agents.map((agent) => (
                    <button
                      key={agent}
                      className="bg-[#161822] border border-[#2a2d3a] rounded-md px-3 py-1.5 text-[12px] text-slate-300 hover:border-indigo-500/30 transition-colors"
                      onClick={() => navigate({ page: 'agent', name: agent, tab: 'skills' })}
                    >
                      <i className="fa-solid fa-robot text-[10px] text-indigo-500 mr-1.5" />
                      {agent}
                    </button>
                  ))}
                </div>
              </div>

              {/* Files */}
              <div>
                <div className="text-[11px] text-slate-500 mb-2">
                  <i className="fa-solid fa-file mr-1 text-indigo-500" />
                  Files
                </div>
                <div className="bg-[#161822] border border-[#2a2d3a] rounded-md overflow-hidden">
                  {selectedSkill.files.map((f, i) => (
                    <div key={f} className={`px-3 py-2 text-[12px] text-slate-400 font-mono ${i > 0 ? 'border-t border-[#2a2d3a]' : ''}`}>
                      <i className="fa-solid fa-file-code text-slate-600 mr-2 text-[10px]" />
                      {f}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-3">
                  <i className="fa-solid fa-info-circle mr-1" />
                  To view file contents, open an agent that has this skill from the list above.
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            {skillsQ.isError
              ? 'Failed to load skills — retry from the sidebar'
              : categories.length === 0 && !skillsQ.isLoading
                ? 'No skills installed on any agent'
                : 'Select a skill'}
          </div>
        )}
      </div>
    </div>
  );
}
