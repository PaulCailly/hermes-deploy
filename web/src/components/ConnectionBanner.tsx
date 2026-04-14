interface ConnectionBannerProps {
  error: Error | null;
  onRetry?: () => void;
}

function isAuthError(err: Error | null): boolean {
  if (!err) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('unauthorized') || msg.includes('401') || msg === 'unauthorized';
}

/**
 * Shown at the top of the app when the base deployments query fails.
 * Distinguishes auth errors (missing token) from other connection issues.
 */
export function ConnectionBanner({ error, onRetry }: ConnectionBannerProps) {
  if (!error) return null;
  const auth = isAuthError(error);

  return (
    <div className={`px-4 py-3 flex items-start gap-3 border-b text-sm ${
      auth ? 'bg-amber-500/10 border-amber-500/30' : 'bg-red-500/10 border-red-500/30'
    }`}>
      <i className={`fa-solid ${auth ? 'fa-key text-amber-500' : 'fa-triangle-exclamation text-red-400'} text-base mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className={`font-medium ${auth ? 'text-amber-400' : 'text-red-400'}`}>
          {auth ? 'Authentication required' : 'Cannot connect to the dashboard server'}
        </div>
        <div className="text-[12px] text-slate-400 mt-0.5 leading-relaxed">
          {auth ? (
            <>
              The API returned <code className="bg-black/30 px-1 rounded font-mono text-amber-300">401 unauthorized</code>.
              {' '}Open the URL printed by <code className="bg-black/30 px-1 rounded font-mono text-slate-300">hermes-deploy dashboard</code>,
              which includes <code className="bg-black/30 px-1 rounded font-mono text-slate-300">#token=…</code> in the hash.
              {' '}For local development, run <code className="bg-black/30 px-1 rounded font-mono text-slate-300">hermes-deploy dashboard --no-auth</code>.
            </>
          ) : (
            <>
              {error.message}. Make sure <code className="bg-black/30 px-1 rounded font-mono text-slate-300">hermes-deploy dashboard</code> is running.
            </>
          )}
        </div>
      </div>
      {onRetry && (
        <button
          className="text-[12px] text-slate-400 hover:text-slate-200 px-2 py-1 rounded transition-colors flex-shrink-0"
          onClick={onRetry}
        >
          <i className="fa-solid fa-rotate-right mr-1" />Retry
        </button>
      )}
    </div>
  );
}
