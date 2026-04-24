import { useState } from 'react';
import { StatusPulse } from '../../components/shared/StatusPulse';
import { useAgentWebhooks } from '../../lib/agent-api';
import type { AgentWebhookRoute, AgentWebhookDelivery } from '../../lib/agent-types';

interface WebhooksTabProps {
  name: string;
  profile: string;
}

function DeliverBadge({ deliver }: { deliver: string }) {
  const colors: Record<string, string> = {
    discord: 'bg-indigo-500/15 text-indigo-400',
    telegram: 'bg-sky-500/15 text-sky-400',
    slack: 'bg-purple-500/15 text-purple-400',
    github_comment: 'bg-slate-500/15 text-slate-300',
    log: 'bg-slate-500/15 text-slate-500',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${colors[deliver] ?? colors.log}`}>
      {deliver}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-green-500/15 text-green-400',
    running: 'bg-blue-500/15 text-blue-400',
    error: 'bg-red-500/15 text-red-400',
    skipped: 'bg-slate-500/15 text-slate-500',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${styles[status] ?? styles.completed}`}>
      {status}
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  if (!action) return null;
  const styles: Record<string, string> = {
    edited: 'bg-amber-500/15 text-amber-400',
    created: 'bg-green-500/15 text-green-400',
    reordered: 'bg-slate-500/15 text-slate-500',
    deleted: 'bg-red-500/15 text-red-400',
    archived: 'bg-slate-500/15 text-slate-500',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${styles[action] ?? 'bg-slate-500/15 text-slate-500'}`}>
      {action}
    </span>
  );
}

function RouteCard({ route, expanded, onToggle }: { route: AgentWebhookRoute; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-[#1a1c2e] transition-colors"
        onClick={onToggle}
      >
        <i className="fa-solid fa-link text-indigo-500 text-sm" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-slate-200 truncate">{route.name}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {route.events.length > 0 ? route.events.join(', ') : 'all events'}
          </div>
        </div>
        <DeliverBadge deliver={route.deliver} />
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          route.source === 'config' ? 'bg-slate-500/15 text-slate-500' : 'bg-cyan-500/15 text-cyan-400'
        }`}>
          {route.source}
        </span>
        <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-slate-600 text-[10px]`} />
      </button>

      {expanded && (
        <div className="border-t border-[#2a2d3a] p-3.5 text-[11px]">
          <div className="mb-3">
            <span className="text-slate-500 font-medium">Endpoint: </span>
            <code className="text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">
              POST /webhooks/{route.name}
            </code>
          </div>
          {route.prompt && (
            <div className="mb-3">
              <div className="text-slate-500 mb-1 font-medium">Prompt template</div>
              <pre className="text-slate-400 bg-[#0f1117] rounded p-2.5 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto text-[10px] leading-relaxed">
                {route.prompt}
              </pre>
            </div>
          )}
          {route.deliverExtra && Object.keys(route.deliverExtra).length > 0 && (
            <div className="mb-3">
              <span className="text-slate-500 font-medium">Delivery: </span>
              <span className="text-slate-400 font-mono text-[10px]">
                {Object.entries(route.deliverExtra).map(([k, v]) => `${k}=${v}`).join(', ')}
              </span>
            </div>
          )}
          {route.createdAt && (
            <div>
              <span className="text-slate-500 font-medium">Created: </span>
              <span className="text-slate-400">{new Date(route.createdAt).toLocaleString()}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DeliveryRow({ delivery }: { delivery: AgentWebhookDelivery }) {
  const age = timeSince(delivery.timestamp);
  const isSkipped = delivery.event === 'skipped';

  return (
    <div className={`flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[#2a2d3a] last:border-0 text-[11px] ${
      isSkipped ? 'opacity-50' : ''
    }`}>
      <StatusBadge status={delivery.status} />
      <ActionBadge action={delivery.action} />
      {delivery.detail && (
        <span className="text-slate-300 font-medium truncate max-w-[160px]" title={delivery.detail}>
          {delivery.detail}
        </span>
      )}
      <span className="text-slate-500 flex-1 truncate">
        {isSkipped ? 'filtered' : delivery.event}
      </span>
      {delivery.messageCount > 0 && (
        <span className="text-slate-600 text-[10px]" title="Messages in session">
          <i className="fa-solid fa-message text-[8px] mr-0.5" />
          {delivery.messageCount}
        </span>
      )}
      {delivery.duration != null && (
        <span className="text-slate-600 text-[10px] whitespace-nowrap">
          {delivery.duration}s
        </span>
      )}
      <span className="text-slate-600 whitespace-nowrap">{age}</span>
    </div>
  );
}

function timeSince(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function WebhooksTab({ name, profile }: WebhooksTabProps) {
  const whQ = useAgentWebhooks(name, profile);
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);

  if (whQ.isLoading) {
    return <div className="p-5 text-slate-500 text-sm">Loading webhook state...</div>;
  }

  const data = whQ.data;

  if (!data) {
    return (
      <div className="p-5 text-slate-500 text-sm text-center">
        <i className="fa-solid fa-globe text-3xl mb-3 block text-slate-600" />
        Could not load webhook data from this agent
      </div>
    );
  }

  const skippedCount = data.recentDeliveries.filter(d => d.event === 'skipped').length;

  return (
    <div className="p-5 max-w-4xl">
      {/* Webhook Platform Status */}
      <div className="flex items-center gap-3 mb-5 bg-[#161822] border border-[#2a2d3a] rounded-lg p-3.5">
        <div className="flex items-center gap-2 flex-1">
          <i className="fa-solid fa-globe text-indigo-500 text-base" />
          <div>
            <div className="text-sm font-semibold text-slate-200">Webhook Platform</div>
            <div className="text-[11px] text-slate-500">
              HTTP server on port 8644
            </div>
          </div>
        </div>
        <StatusPulse status={data.healthy ? 'online' : 'offline'} size={10} />
        <span className={`text-[12px] font-medium ${data.healthy ? 'text-green-500' : 'text-red-500'}`}>
          {data.healthy ? 'Healthy' : 'Unreachable'}
        </span>
      </div>

      {/* Routes */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-semibold text-slate-200">
          <i className="fa-solid fa-route text-indigo-500 mr-2" />
          Routes
        </div>
        <span className="text-[11px] text-slate-500">{data.routes.length} configured</span>
      </div>

      {data.routes.length === 0 ? (
        <div className="text-slate-500 text-sm text-center py-6 bg-[#161822] border border-[#2a2d3a] rounded-lg mb-5">
          No webhook routes configured
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-5">
          {data.routes.map((route) => (
            <RouteCard
              key={route.name}
              route={route}
              expanded={expandedRoute === route.name}
              onToggle={() => setExpandedRoute(expandedRoute === route.name ? null : route.name)}
            />
          ))}
        </div>
      )}

      {/* Event Log */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-semibold text-slate-200">
          <i className="fa-solid fa-clock-rotate-left text-indigo-500 mr-2" />
          Event Log
        </div>
        <div className="flex items-center gap-2">
          {skippedCount > 0 && (
            <span className="text-[10px] text-slate-600">{skippedCount} filtered</span>
          )}
          <span className="text-[11px] text-slate-500">{data.recentDeliveries.length} total</span>
        </div>
      </div>

      {data.recentDeliveries.length === 0 ? (
        <div className="text-slate-500 text-sm text-center py-6 bg-[#161822] border border-[#2a2d3a] rounded-lg">
          No webhook events yet
        </div>
      ) : (
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg overflow-hidden">
          {data.recentDeliveries.map((d, i) => (
            <DeliveryRow key={d.id + '-' + i} delivery={d} />
          ))}
        </div>
      )}
    </div>
  );
}
