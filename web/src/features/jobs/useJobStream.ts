import { useState, useEffect, useRef } from 'react';
import { createWs } from '../../lib/ws';
import type { ReporterEvent } from '@hermes/dto';

const MAX_EVENTS = 1000;

export function useJobStream(jobId: string | null) {
  const [events, setEvents] = useState<ReporterEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!jobId) return;
    setEvents([]);

    const ws = createWs(`/ws/jobs/${jobId}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data as string) as ReporterEvent;
        setEvents((prev) => {
          if (prev.length >= MAX_EVENTS) {
            return [...prev.slice(prev.length - (MAX_EVENTS - 1)), event];
          }
          return [...prev, event];
        });
      } catch { /* ignore malformed */ }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [jobId]);

  const isDone = events.some(
    (e) => e.type === 'success' || e.type === 'error',
  );

  const isError = events.some((e) => e.type === 'error');

  const logs = events
    .filter((e) => e.type === 'log')
    .map((e) => (e as Extract<ReporterEvent, { type: 'log' }>).line);

  return { events, logs, connected, isDone, isError };
}
