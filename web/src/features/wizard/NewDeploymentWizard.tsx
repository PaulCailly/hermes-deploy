import { useState } from 'react';
import { apiFetch } from '../../lib/api';

interface Props {
  onBack: () => void;
  onCreated: (name: string) => void;
}

function extractDirName(dir: string): string {
  // Normalize trailing slashes and extract last segment
  const trimmed = dir.replace(/\/+$/, '');
  return trimmed.split('/').pop() || 'my-agent';
}

export function NewDeploymentWizard({ onBack, onCreated }: Props) {
  const [dir, setDir] = useState('');
  const [name, setName] = useState('');
  const [dirError, setDirError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const validateDir = (value: string) => {
    if (value && !value.startsWith('/')) {
      setDirError('Path must be absolute (start with /)');
    } else {
      setDirError(null);
    }
  };

  const handleInit = async () => {
    if (!dir || dirError) return;
    setLoading(true);
    setError(null);

    try {
      await apiFetch('/api/projects/init', {
        method: 'POST',
        body: JSON.stringify({ dir, name: name || undefined }),
      });
      setSuccess(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    const derivedName = name || extractDirName(dir);
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <div className="text-emerald-400 text-4xl mb-4">&#10003;</div>
          <h2 className="text-xl font-bold text-white mb-2">Project initialized</h2>
          <p className="text-gray-400 mb-6">
            Your hermes-deploy project has been scaffolded at <code className="text-gray-300 font-mono text-sm">{dir}</code>.
            Edit <code className="text-gray-300 font-mono text-sm">hermes.toml</code> and <code className="text-gray-300 font-mono text-sm">config.yaml</code>,
            set your secrets, then run <strong>up</strong> to deploy.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => onCreated(derivedName)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Go to deployment
            </button>
            <button
              onClick={onBack}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Back to list
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors text-sm">
          &larr; Back
        </button>
        <h1 className="text-2xl font-bold">New Deployment</h1>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Project directory <span className="text-red-400">*</span>
          </label>
          <input
            value={dir}
            onChange={(e) => { setDir(e.target.value); validateDir(e.target.value); }}
            onBlur={() => validateDir(dir)}
            placeholder="/home/user/my-agent"
            className={`w-full bg-gray-950 border rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none ${
              dirError ? 'border-red-500 focus:border-red-500' : 'border-gray-700 focus:border-indigo-500'
            }`}
          />
          {dirError
            ? <p className="text-xs text-red-400 mt-1">{dirError}</p>
            : <p className="text-xs text-gray-500 mt-1">Absolute path to the directory where hermes.toml will be created</p>
          }
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Deployment name <span className="text-gray-500">(optional)</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-agent"
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
          />
          <p className="text-xs text-gray-500 mt-1">Defaults to the directory name</p>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleInit}
          disabled={!dir || !!dirError || loading}
          className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {loading ? 'Initializing...' : 'Initialize project'}
        </button>
      </div>
    </div>
  );
}
