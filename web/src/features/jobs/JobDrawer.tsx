import { useEffect, useRef } from 'react';
import { PhaseTimeline } from './PhaseTimeline';
import { useJobStream } from './useJobStream';

interface Props {
  jobId: string;
  onClose: () => void;
  onFullScreen: () => void;
}

export function JobDrawer({ jobId, onClose, onFullScreen }: Props) {
  const { events, logs, isDone } = useJobStream(jobId);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  return (
    <div className="mt-6 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-white text-sm">Job {jobId.slice(0, 8)}</h3>
          {!isDone && <span className="text-xs text-indigo-400 animate-pulse">Running...</span>}
          {isDone && <span className="text-xs text-emerald-400">Complete</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={onFullScreen} className="text-xs text-gray-400 hover:text-white transition-colors">
            Full screen
          </button>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-white transition-colors">
            Close
          </button>
        </div>
      </div>

      <div className="px-5 py-3">
        <PhaseTimeline events={events} />
      </div>

      <div className="bg-gray-950 border-t border-gray-800 max-h-60 overflow-y-auto px-5 py-3">
        <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap">
          {logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <div ref={logEndRef} />
        </pre>
        {logs.length === 0 && <div className="text-gray-600 text-xs">Waiting for output...</div>}
      </div>
    </div>
  );
}
