import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

interface Props {
  name: string;
}

export function SecretsTab({ name }: Props) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const secretsQuery = useQuery({
    queryKey: ['secrets', name],
    queryFn: () => apiFetch<{ keys: string[] }>(`/api/deployments/${encodeURIComponent(name)}/secrets`),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      return apiFetch(`/api/deployments/${encodeURIComponent(name)}/secrets/${encodeURIComponent(newKey)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: newValue }),
      });
    },
    onSuccess: () => {
      setNewKey('');
      setNewValue('');
      setShowAdd(false);
      queryClient.invalidateQueries({ queryKey: ['secrets', name] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => {
      return apiFetch(`/api/deployments/${encodeURIComponent(name)}/secrets/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets', name] });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-400">Encrypted secrets (sops)</h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {showAdd ? 'Cancel' : '+ Add secret'}
        </button>
      </div>

      {showAdd && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4 space-y-3">
          <input
            placeholder="KEY"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase())}
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
          />
          <input
            placeholder="value"
            type="password"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
          />
          {addMutation.isError && (
            <div className="text-red-400 text-sm">{(addMutation.error as Error).message}</div>
          )}
          <button
            onClick={() => addMutation.mutate()}
            disabled={!newKey || !newValue || addMutation.isPending}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {addMutation.isPending ? 'Saving...' : 'Save secret'}
          </button>
        </div>
      )}

      {secretsQuery.isLoading && <div className="text-gray-400 text-center py-8">Loading...</div>}

      {secretsQuery.data && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {secretsQuery.data.keys.length === 0 ? (
            <div className="text-gray-500 text-center py-8">No secrets configured</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Key</th>
                  <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {secretsQuery.data.keys.map((key) => (
                  <tr key={key} className="border-b border-gray-800/50 last:border-0">
                    <td className="px-5 py-3 text-sm font-mono text-gray-200">{key}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => {
                          if (confirm(`Delete secret "${key}"?`)) {
                            deleteMutation.mutate(key);
                          }
                        }}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
