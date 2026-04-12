import { useState, useEffect, useRef, useCallback } from 'react';
import { createWs } from '../../lib/ws';

interface Props {
  name: string;
}

export function LogsTab({ name }: Props) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ws = createWs(`/ws/logs/${encodeURIComponent(name)}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.line !== undefined) {
          setLines((prev) => {
            const next = [...prev, msg.line];
            // Cap at 5000 lines
            return next.length > 5000 ? next.slice(-5000) : next;
          });
        }
      } catch { /* ignore */ }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [name]);

  useEffect(() => {
    if (!paused) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines.length, paused]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setPaused(!atBottom);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
          <span className="text-sm text-gray-400">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div className="flex items-center gap-3">
          {paused && <span className="text-xs text-yellow-400">Scroll paused</span>}
          <button
            onClick={() => setLines([])}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="bg-gray-950 border border-gray-800 rounded-xl h-[500px] overflow-y-auto p-4"
      >
        <pre className="text-sm font-mono text-gray-300 whitespace-pre-wrap">
          {lines.map((line, i) => (
            <div key={i} className="hover:bg-gray-900/50">{line}</div>
          ))}
          <div ref={logEndRef} />
        </pre>
        {lines.length === 0 && connected && (
          <div className="text-gray-600 text-sm">Waiting for logs...</div>
        )}
      </div>
    </div>
  );
}
