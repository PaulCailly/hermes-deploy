export function TeamsPage() {
  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-slate-200">
          <i className="fa-solid fa-users text-indigo-500 mr-2" />Teams
        </h1>
        <p className="text-[13px] text-slate-500 mt-1">
          Orchestration layer for multi-agent collaboration
        </p>
      </div>

      <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-indigo-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
            <i className="fa-solid fa-diagram-project text-indigo-500 text-xl" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-slate-200 mb-2">Coming in Phase 3</h2>
            <p className="text-[13px] text-slate-400 leading-relaxed mb-4">
              Teams turn individual agents into coordinated groups. Planned capabilities:
            </p>
            <ul className="space-y-2 text-[13px] text-slate-400">
              <li className="flex gap-2">
                <i className="fa-solid fa-check text-indigo-500 mt-1 text-[10px]" />
                <span><strong className="text-slate-300">Agent groups</strong> — organize agents by role, project, or domain</span>
              </li>
              <li className="flex gap-2">
                <i className="fa-solid fa-check text-indigo-500 mt-1 text-[10px]" />
                <span><strong className="text-slate-300">Inter-agent communication</strong> — agents exchange messages and delegate tasks</span>
              </li>
              <li className="flex gap-2">
                <i className="fa-solid fa-check text-indigo-500 mt-1 text-[10px]" />
                <span><strong className="text-slate-300">Shared knowledge</strong> — common memory and vector stores across team members</span>
              </li>
              <li className="flex gap-2">
                <i className="fa-solid fa-check text-indigo-500 mt-1 text-[10px]" />
                <span><strong className="text-slate-300">Hierarchy and roles</strong> — supervisor/worker relationships, approval chains</span>
              </li>
              <li className="flex gap-2">
                <i className="fa-solid fa-check text-indigo-500 mt-1 text-[10px]" />
                <span><strong className="text-slate-300">Team-level analytics</strong> — aggregate metrics per team, cross-team cost attribution</span>
              </li>
            </ul>

            <div className="mt-5 pt-4 border-t border-[#2a2d3a]">
              <p className="text-[12px] text-slate-500">
                <i className="fa-solid fa-info-circle mr-1.5" />
                This requires agent-side primitives (messaging protocol, shared memory service) that
                need to ship in Hermes first. The dashboard will surface teams as soon as those primitives land.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Current foundation */}
      <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-6 mt-4">
        <h2 className="text-sm font-semibold text-slate-200 mb-3">
          <i className="fa-solid fa-building-columns text-indigo-500 mr-2" />
          What's Already in Place
        </h2>
        <p className="text-[13px] text-slate-400 leading-relaxed mb-3">
          The V2 dashboard ships the foundation the orchestration layer will sit on top of:
        </p>
        <ul className="space-y-1.5 text-[13px] text-slate-400">
          <li className="flex gap-2">
            <i className="fa-solid fa-minus text-slate-600 mt-1 text-[10px]" />
            <span>Agents are first-class entities with their own workspace</span>
          </li>
          <li className="flex gap-2">
            <i className="fa-solid fa-minus text-slate-600 mt-1 text-[10px]" />
            <span>Fleet-level aggregation (Dashboard) and cross-agent skill library</span>
          </li>
          <li className="flex gap-2">
            <i className="fa-solid fa-minus text-slate-600 mt-1 text-[10px]" />
            <span>Per-agent API over SSH (sessions, skills, cron, gateway) ready to extend</span>
          </li>
          <li className="flex gap-2">
            <i className="fa-solid fa-minus text-slate-600 mt-1 text-[10px]" />
            <span>WebSocket streaming infrastructure for live updates</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
