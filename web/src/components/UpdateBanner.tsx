import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';

interface UpdateCheckResponse {
  hermesDeploy: {
    current: string;
    latest: string;
    updateAvailable: boolean;
  };
}

export function UpdateBanner() {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('hermes-deploy-update-dismissed') === 'true',
  );

  const { data } = useQuery({
    queryKey: ['update-check'],
    queryFn: () => apiFetch<UpdateCheckResponse>('/api/updates'),
    refetchInterval: 60_000,
    retry: false,
  });

  if (dismissed || !data?.hermesDeploy.updateAvailable) return null;

  function dismiss() {
    sessionStorage.setItem('hermes-deploy-update-dismissed', 'true');
    setDismissed(true);
  }

  return (
    <div className="px-4 py-3 flex items-start gap-3 border-b bg-indigo-500/10 border-indigo-500/30 text-sm">
      <i className="fa-solid fa-arrow-up-right-dots text-indigo-400 text-base mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-indigo-300">
          hermes-deploy v{data.hermesDeploy.latest} is available
        </div>
        <div className="text-[12px] text-slate-400 mt-0.5 leading-relaxed">
          You have v{data.hermesDeploy.current}. Run{' '}
          <code className="bg-black/30 px-1 rounded font-mono text-slate-300">
            npm install -g @paulcailly/hermes-deploy@latest
          </code>
        </div>
      </div>
      <button
        className="text-[12px] text-slate-500 hover:text-slate-200 px-2 py-1 rounded transition-colors flex-shrink-0"
        onClick={dismiss}
        title="Dismiss"
      >
        <i className="fa-solid fa-xmark" />
      </button>
    </div>
  );
}
