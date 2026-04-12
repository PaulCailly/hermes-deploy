import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { OverviewTab } from './OverviewTab';
import { ActionsTab } from './ActionsTab';
import { LogsTab } from '../logs/LogsTab';
import { SshTab } from '../ssh/SshTab';
import { ConfigTab } from '../config/ConfigTab';
import { SecretsTab } from '../secrets/SecretsTab';
import type { StatusPayloadDto } from '@hermes/dto';

interface Props {
  name: string;
  initialTab?: string;
  onBack: () => void;
  onJob: (jobId: string) => void;
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'actions', label: 'Actions' },
  { id: 'logs', label: 'Logs' },
  { id: 'ssh', label: 'SSH' },
  { id: 'config', label: 'Config' },
  { id: 'secrets', label: 'Secrets' },
] as const;

export function DeploymentDetail({ name, initialTab, onBack, onJob }: Props) {
  const [tab, setTab] = useState(initialTab ?? 'overview');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['deployment', name],
    queryFn: () => apiFetch<StatusPayloadDto>(`/api/deployments/${encodeURIComponent(name)}`),
    refetchInterval: 20_000,
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors text-sm">
          &larr; Back
        </button>
        <h1 className="text-2xl font-bold">{name}</h1>
        {data?.stored && (
          <span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded-full uppercase">
            {data.stored.cloud}
          </span>
        )}
      </div>

      <div className="border-b border-gray-800 mb-6">
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {isLoading && <div className="text-gray-400 text-center py-12">Loading...</div>}
      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 text-red-400">
          {(error as Error).message}
        </div>
      )}

      {data && (
        <>
          {tab === 'overview' && <OverviewTab status={data} />}
          {tab === 'actions' && <ActionsTab name={name} onJob={onJob} onRefresh={refetch} />}
          {tab === 'logs' && <LogsTab name={name} />}
          {tab === 'ssh' && <SshTab name={name} />}
          {tab === 'config' && <ConfigTab name={name} />}
          {tab === 'secrets' && <SecretsTab name={name} />}
        </>
      )}
    </div>
  );
}
