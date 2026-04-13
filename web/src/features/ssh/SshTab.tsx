import { useEffect, useRef, useState } from 'react';
import { getToken } from '../../lib/token';

interface Props {
  name: string;
}

export function SshTab({ name }: Props) {
  const termRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!termRef.current) return;

      // Dynamic import to avoid SSR and reduce initial bundle
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');
      // Import xterm CSS
      await import('xterm/css/xterm.css');

      if (cancelled) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        theme: {
          background: '#0a0a0f',
          foreground: '#e5e5e5',
          cursor: '#818cf8',
          selectionBackground: '#4338ca50',
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(termRef.current!);
      fitAddon.fit();

      const token = getToken();
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/ssh/${encodeURIComponent(name)}${token ? `?token=${token}` : ''}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        if (cancelled) { ws.close(); return; }
        setConnected(true);
        // Send initial size
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };

      ws.onclose = () => setConnected(false);
      ws.onerror = () => setError('WebSocket connection failed');

      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data));
        } else {
          term.write(ev.data as string);
        }
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(termRef.current!);

      cleanupRef.current = () => {
        resizeObserver.disconnect();
        ws.close();
        term.dispose();
      };
    }

    init();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
    };
  }, [name]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
        <span className="text-sm text-gray-400">{connected ? 'Connected' : 'Disconnected'}</span>
        {error && <span className="text-sm text-red-400 ml-2">{error}</span>}
      </div>
      <div
        ref={termRef}
        className="bg-[#0a0a0f] border border-gray-800 rounded-xl p-2 h-[500px]"
      />
    </div>
  );
}
