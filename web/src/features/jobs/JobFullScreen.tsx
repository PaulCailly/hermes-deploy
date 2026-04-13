import { useEffect, useRef } from 'react';
import { PhaseTimeline } from './PhaseTimeline';
import { useJobStream } from './useJobStream';

interface Props {
  jobId: string;
  onBack: () => void;
}

export function JobFullScreen({ jobId, onBack }: Props) {
  const { events, logs, isDone, isError } = useJobStream(jobId);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors text-sm">
          &larr; Back
        </button>
        <h1 className="text-2xl font-bold">Job {jobId.slice(0, 8)}</h1>
        {!isDone && <span className="text-sm text-indigo-400 animate-pulse">Running...</span>}
        {isDone && !isError && <span className="text-sm text-emerald-400">Complete</span>}
        {isDone && isError && <span className="text-sm text-red-400">Failed</span>}
      </div>

      <div className="mb-6">
        <PhaseTimeline events={events} />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800">
          <h3 className="text-sm font-medium text-gray-400">Output</h3>
        </div>
        <div className="bg-gray-950 max-h-[600px] overflow-y-auto px-5 py-3">
          <pre className="text-sm text-gray-300 font-mono whitespace-pre-wrap">
            {logs.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={logEndRef} />
          </pre>
          {logs.length === 0 && <div className="text-gray-600 text-sm">Waiting for output...</div>}
        </div>
      </div>
    </div>
  );
}
