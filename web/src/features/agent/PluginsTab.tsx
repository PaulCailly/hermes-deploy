import { useState } from 'react';
import { StatusPulse } from '../../components/shared/StatusPulse';
import { useAgentPlugins } from '../../lib/agent-api';
import type { AgentPlugin } from '../../lib/agent-types';

interface PluginsTabProps {
  name: string;
  profile: string;
}

function FileViewer({ filename, content }: { filename: string; content: string }) {
  const ext = filename.split('.').pop() ?? '';
  const langLabel: Record<string, string> = {
    py: 'Python', yaml: 'YAML', yml: 'YAML', json: 'JSON',
    sh: 'Shell', md: 'Markdown', toml: 'TOML', txt: 'Text',
  };

  return (
    <div className="border border-[#2a2d3a] rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1c2e] border-b border-[#2a2d3a]">
        <i className={`fa-solid ${ext === 'py' ? 'fa-file-code' : ext === 'yaml' || ext === 'yml' ? 'fa-file-lines' : 'fa-file'} text-slate-500 text-[10px]`} />
        <span className="text-[11px] text-slate-300 font-mono">{filename}</span>
        {langLabel[ext] && (
          <span className="text-[9px] text-slate-600 ml-auto">{langLabel[ext]}</span>
        )}
      </div>
      <pre className="p-3 text-[10px] leading-[1.6] text-slate-400 bg-[#0f1117] overflow-x-auto max-h-[500px] overflow-y-auto font-mono">
        {content}
      </pre>
    </div>
  );
}

function PluginCard({ plugin }: { plugin: AgentPlugin }) {
  const [expanded, setExpanded] = useState(false);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const fileNames = Object.keys(plugin.files ?? {});

  return (
    <div className={`bg-[#161822] border rounded-lg overflow-hidden ${
      plugin.enabled ? 'border-[#2a2d3a]' : 'border-red-500/30 opacity-60'
    }`}>
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-[#1a1c2e] transition-colors"
        onClick={() => { setExpanded(!expanded); if (!expanded && fileNames.length > 0 && !activeFile) setActiveFile(fileNames[0] ?? null); }}
      >
        <i className="fa-solid fa-puzzle-piece text-indigo-500 text-base" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-slate-200">{plugin.name}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{plugin.description}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-600">v{plugin.version}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            plugin.source === 'user' ? 'bg-cyan-500/15 text-cyan-400' :
            plugin.source === 'pip' ? 'bg-purple-500/15 text-purple-400' :
            'bg-slate-500/15 text-slate-500'
          }`}>
            {plugin.source}
          </span>
          {plugin.enabled ? (
            <StatusPulse status="online" size={8} />
          ) : (
            <i className="fa-solid fa-circle-xmark text-red-500 text-[10px]" />
          )}
          <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-slate-600 text-[10px] ml-1`} />
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[#2a2d3a]">
          {/* Stats bar */}
          <div className="flex items-center gap-4 px-4 py-2.5 text-[10px] text-slate-500 bg-[#13141f]">
            {plugin.tools > 0 && (
              <span>
                <i className="fa-solid fa-wrench text-[9px] mr-1 text-indigo-500" />
                {plugin.tools} tool{plugin.tools > 1 ? 's' : ''}
              </span>
            )}
            {plugin.hooks > 0 && (
              <span>
                <i className="fa-solid fa-bolt text-[9px] mr-1 text-amber-500" />
                {plugin.hooks} hook{plugin.hooks > 1 ? 's' : ''}
              </span>
            )}
            {plugin.commands > 0 && (
              <span>
                <i className="fa-solid fa-terminal text-[9px] mr-1 text-green-500" />
                {plugin.commands} command{plugin.commands > 1 ? 's' : ''}
              </span>
            )}
            <span className="ml-auto text-slate-600">
              <i className="fa-solid fa-file text-[9px] mr-1" />
              {fileNames.length} file{fileNames.length > 1 ? 's' : ''}
            </span>
          </div>

          {plugin.error && (
            <div className="mx-4 mt-3 text-[10px] text-red-400 bg-red-500/5 border border-red-500/20 rounded p-2 font-mono">
              {plugin.error}
            </div>
          )}

          {/* File tabs + viewer */}
          {fileNames.length > 0 && (
            <div className="p-4">
              {fileNames.length > 1 && (
                <div className="flex gap-1 mb-3 overflow-x-auto">
                  {fileNames.map((f) => (
                    <button
                      key={f}
                      className={`text-[10px] px-2.5 py-1.5 rounded whitespace-nowrap transition-colors ${
                        activeFile === f
                          ? 'bg-indigo-500/20 text-indigo-300 font-medium'
                          : 'text-slate-500 hover:text-slate-300 hover:bg-[#1a1c2e]'
                      }`}
                      onClick={() => setActiveFile(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}

              {activeFile && plugin.files[activeFile] && (
                <FileViewer filename={activeFile} content={plugin.files[activeFile]} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PluginsTab({ name, profile }: PluginsTabProps) {
  const pluginsQ = useAgentPlugins(name, profile);

  if (pluginsQ.isLoading) {
    return <div className="p-5 text-slate-500 text-sm">Loading plugins...</div>;
  }

  const plugins = pluginsQ.data ?? [];

  return (
    <div className="p-5 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[13px] font-semibold text-slate-200">
          <i className="fa-solid fa-puzzle-piece text-indigo-500 mr-2" />
          Installed Plugins
        </div>
        <span className="text-[11px] text-slate-500">{plugins.length} installed</span>
      </div>

      {plugins.length === 0 ? (
        <div className="text-center py-10 bg-[#161822] border border-[#2a2d3a] rounded-lg">
          <i className="fa-solid fa-puzzle-piece text-3xl mb-3 block text-slate-600" />
          <div className="text-slate-500 text-sm mb-1">No plugins installed</div>
          <div className="text-slate-600 text-[11px]">
            Plugins extend the agent with custom tools, hooks, and commands
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {plugins.map((p) => (
            <PluginCard key={p.name} plugin={p} />
          ))}
        </div>
      )}
    </div>
  );
}
