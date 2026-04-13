import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onHome: () => void;
}

export function AppShell({ children, onHome }: Props) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-4">
          <button onClick={onHome} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 bg-indigo-500 rounded-md flex items-center justify-center text-white font-bold text-sm">H</div>
            <span className="font-semibold text-lg">Hermes Deploy</span>
          </button>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">Dashboard</span>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}
