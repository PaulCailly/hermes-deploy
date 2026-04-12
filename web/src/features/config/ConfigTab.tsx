import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

interface ConfigFile {
  key: string;
  name: string;
  exists: boolean;
}

interface ConfigContent {
  file: string;
  name: string;
  language: string;
  content: string;
}

interface Props {
  name: string;
}

const LANGUAGE_MAP: Record<string, string> = {
  toml: 'toml',
  yaml: 'yaml',
  markdown: 'markdown',
};

export function ConfigTab({ name }: Props) {
  const [activeFile, setActiveFile] = useState<string>('hermes-toml');
  const [editorContent, setEditorContent] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const queryClient = useQueryClient();

  const filesQuery = useQuery({
    queryKey: ['config-files', name],
    queryFn: () => apiFetch<{ files: ConfigFile[] }>(`/api/deployments/${encodeURIComponent(name)}/config/files`),
  });

  const contentQuery = useQuery({
    queryKey: ['config-content', name, activeFile],
    queryFn: async () => {
      const data = await apiFetch<ConfigContent>(`/api/deployments/${encodeURIComponent(name)}/config/${activeFile}`);
      setEditorContent(data.content);
      setDirty(false);
      return data;
    },
    enabled: !!activeFile,
  });

  const saveMutation = useMutation({
    mutationFn: async (content: string) => {
      return apiFetch(`/api/deployments/${encodeURIComponent(name)}/config/${activeFile}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['config-content', name, activeFile] });
    },
  });

  const MonacoEditor = useMonacoEditor();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          {filesQuery.data?.files.map((f) => (
            <button
              key={f.key}
              onClick={() => { setActiveFile(f.key); setDirty(false); }}
              disabled={!f.exists}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                activeFile === f.key
                  ? 'bg-indigo-600 text-white'
                  : f.exists
                    ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    : 'bg-gray-900 text-gray-600 cursor-not-allowed'
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-yellow-400">Unsaved changes</span>}
          <button
            onClick={() => saveMutation.mutate(editorContent)}
            disabled={!dirty || saveMutation.isPending}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {saveMutation.isError && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
          {(saveMutation.error as Error).message}
        </div>
      )}

      {contentQuery.isLoading && <div className="text-gray-400 text-center py-12">Loading...</div>}

      {contentQuery.data && MonacoEditor && (
        <div className="border border-gray-800 rounded-xl overflow-hidden">
          <MonacoEditor
            height="500px"
            language={LANGUAGE_MAP[contentQuery.data.language] ?? 'plaintext'}
            value={editorContent}
            onChange={(value: string | undefined) => { setEditorContent(value ?? ''); setDirty(true); }}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              padding: { top: 12, bottom: 12 },
            }}
          />
        </div>
      )}

      {contentQuery.data && !MonacoEditor && (
        <textarea
          value={editorContent}
          onChange={(e) => { setEditorContent(e.target.value); setDirty(true); }}
          className="w-full h-[500px] bg-gray-950 border border-gray-800 rounded-xl p-4 font-mono text-sm text-gray-300 resize-none focus:outline-none focus:border-indigo-500"
          spellCheck={false}
        />
      )}
    </div>
  );
}

// Lazy-load Monaco to avoid blocking initial bundle
function useMonacoEditor() {
  const [Editor, setEditor] = useState<any>(null);

  if (!Editor) {
    import('@monaco-editor/react').then((mod) => {
      setEditor(() => mod.default);
    }).catch(() => {
      // Monaco failed to load — fallback to textarea
    });
  }

  return Editor;
}
