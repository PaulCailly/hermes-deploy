import { useState, useEffect } from 'react';
import { useAgentSkills, useAgentSkillFile, useSkillFileWrite } from '../../lib/agent-api';
import type { AgentSkill } from '../../lib/agent-types';

interface SkillsTabProps {
  name: string;
}

// Files that can be edited in-place (safe formats)
const EDITABLE_EXT = ['.md', '.txt', '.yaml', '.yml', '.json'];
function isEditable(file: string): boolean {
  return EDITABLE_EXT.some((ext) => file.toLowerCase().endsWith(ext));
}

export function SkillsTab({ name }: SkillsTabProps) {
  const skillsQ = useAgentSkills(name);
  const categories = skillsQ.data ?? [];
  const [selectedSkill, setSelectedSkill] = useState<AgentSkill | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Auto-select first skill on load
  useEffect(() => {
    if (!selectedSkill && categories.length > 0 && categories[0]!.skills.length > 0) {
      const first = categories[0]!.skills[0]!;
      setSelectedSkill(first);
      setSelectedFile(first.files[0] ?? null);
    }
  }, [categories, selectedSkill]);

  // Reset edit mode when changing file/skill
  useEffect(() => {
    setEditing(false);
    setSaveError(null);
  }, [selectedSkill?.id, selectedFile]);

  const totalSkills = categories.reduce((sum, c) => sum + c.skills.length, 0);
  const fileQ = useAgentSkillFile(
    name,
    selectedSkill?.category ?? '',
    selectedSkill?.name ?? '',
    selectedFile ?? '',
  );
  const writeM = useSkillFileWrite(name);

  const filteredCategories = categories.map((c) => ({
    ...c,
    skills: c.skills.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase())),
  })).filter((c) => c.skills.length > 0);

  function toggleCategory(catName: string) {
    setCollapsed((prev) => ({ ...prev, [catName]: !prev[catName] }));
  }

  function startEditing() {
    // Don't allow editing until the remote file has finished loading —
    // otherwise the buffer seeds from '' and a save would overwrite with blank.
    if (fileQ.isLoading || fileQ.data === undefined) return;
    setEditBuffer(fileQ.data);
    setEditing(true);
    setSaveError(null);
  }

  async function saveEdit() {
    if (!selectedSkill || !selectedFile) return;
    setSaveError(null);
    try {
      await writeM.mutateAsync({
        category: selectedSkill.category,
        skill: selectedSkill.name,
        file: selectedFile,
        content: editBuffer,
      });
      setEditing(false);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'save failed');
    }
  }

  function cancelEdit() {
    setEditing(false);
    setEditBuffer('');
    setSaveError(null);
  }

  const canEdit = selectedFile ? isEditable(selectedFile) : false;

  return (
    <div className="flex h-full">
      {/* Left: Category Tree */}
      <div className="w-[240px] border-r border-[#2a2d3a] flex flex-col flex-shrink-0">
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
          ) : categories.length === 0 ? (
            <div className="text-slate-500 text-sm text-center py-6">No skills installed</div>
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
                    onClick={() => { setSelectedSkill(skill); setSelectedFile(skill.files[0] ?? null); }}
                  >
                    {skill.name}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="p-2 border-t border-[#2a2d3a] text-[11px] text-slate-600 bg-[#161822]">
          {totalSkills} skills · {categories.length} categories
        </div>
      </div>

      {/* Right: Skill Detail */}
      <div className="flex-1 flex flex-col">
        {selectedSkill ? (
          <>
            <div className="px-4 py-3 border-b border-[#2a2d3a] bg-[#161822] flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-200">{selectedSkill.category} / {selectedSkill.name}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {selectedSkill.files.length} files
                  {selectedSkill.requiredConfig.length > 0 && (
                    <> · requires: {selectedSkill.requiredConfig.map((k) => (
                      <code key={k} className="bg-[#1e2030] px-1 py-0.5 rounded text-[10px] ml-1 text-amber-400">{k}</code>
                    ))}</>
                  )}
                </div>
              </div>
              {canEdit && !editing && selectedFile && (
                <button
                  className="text-[11px] px-2.5 py-1.5 rounded bg-[#1e2030] hover:bg-[#26283a] disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 transition-colors"
                  onClick={startEditing}
                  disabled={fileQ.isLoading || fileQ.data === undefined}
                  title={fileQ.isLoading ? 'Loading file…' : 'Edit file'}
                >
                  <i className="fa-solid fa-pen-to-square mr-1.5" />Edit
                </button>
              )}
              {editing && (
                <div className="flex gap-2">
                  <button
                    className="text-[11px] px-2.5 py-1.5 rounded text-slate-400 hover:text-slate-200 transition-colors"
                    onClick={cancelEdit}
                    disabled={writeM.isPending}
                  >
                    Cancel
                  </button>
                  <button
                    className="text-[11px] px-2.5 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
                    onClick={saveEdit}
                    disabled={writeM.isPending}
                  >
                    {writeM.isPending ? <i className="fa-solid fa-spinner fa-spin mr-1" /> : <i className="fa-solid fa-floppy-disk mr-1" />}
                    Save
                  </button>
                </div>
              )}
            </div>
            <div className="flex gap-2 px-4 pt-3 flex-wrap">
              {selectedSkill.files.map((f) => (
                <button
                  key={f}
                  className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                    selectedFile === f ? 'text-indigo-300 border-indigo-500' : 'text-slate-400 border-[#2a2d3a] hover:text-slate-200'
                  } bg-[#1e2030]`}
                  onClick={() => setSelectedFile(f)}
                  disabled={editing}
                >
                  {f}
                  {!isEditable(f) && <i className="fa-solid fa-lock text-[8px] ml-1 text-slate-600" title="Read-only" />}
                </button>
              ))}
            </div>
            <div className="flex-1 p-4 overflow-auto">
              {saveError && (
                <div className="mb-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5">
                  {saveError}
                </div>
              )}
              {editing ? (
                <textarea
                  className="w-full h-full min-h-[400px] bg-[#161822] border border-indigo-500/30 rounded-md p-3 text-[12px] text-slate-200 font-mono leading-relaxed outline-none resize-none"
                  value={editBuffer}
                  onChange={(e) => setEditBuffer(e.target.value)}
                  spellCheck={false}
                />
              ) : (
                <pre className="bg-[#161822] border border-[#2a2d3a] rounded-md p-3 text-[11px] text-slate-400 font-mono leading-relaxed whitespace-pre-wrap">
                  {fileQ.isLoading ? 'Loading…' : fileQ.error ? `Error: ${fileQ.error.message}` : fileQ.data ?? ''}
                </pre>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            {categories.length === 0 && !skillsQ.isLoading ? 'No skills installed' : 'Select a skill'}
          </div>
        )}
      </div>
    </div>
  );
}
