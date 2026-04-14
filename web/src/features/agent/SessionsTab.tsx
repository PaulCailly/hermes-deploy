import { useState, useEffect } from 'react';
import { StatusPulse } from '../../components/shared/StatusPulse';
import { PlatformIcon, platformLabel } from '../../components/shared/PlatformIcon';
import { useAgentSessions, useAgentMessages } from '../../lib/agent-api';
import type { AgentSession, AgentMessage } from '../../lib/agent-types';

interface SessionsTabProps {
  name: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function SessionListItem({ session, selected, onSelect }: { session: AgentSession; selected: boolean; onSelect: () => void }) {
  const isActive = !session.endedAt;
  const isFailed = session.endReason === 'error';

  return (
    <button
      className={`w-full p-3 border-b border-[#2a2d3a] text-left cursor-pointer transition-colors ${
        selected ? 'bg-indigo-500/8 border-l-2 border-l-indigo-500' : 'border-l-2 border-l-transparent hover:bg-white/[0.02]'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {isActive ? <StatusPulse status="online" size={8} /> : isFailed ? <i className="fa-solid fa-circle-xmark text-red-500 text-[8px]" /> : <i className="fa-solid fa-circle-check text-slate-600 text-[8px]" />}
        <span className="text-[12px] text-slate-200 font-medium flex-1 truncate">{session.title}</span>
        <span className="text-[10px] text-slate-600">{timeAgo(session.startedAt)}</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <span><PlatformIcon platform={session.source} className="text-[9px] mr-0.5" />{platformLabel(session.source)}</span>
        <span><i className="fa-solid fa-message text-[9px] mr-0.5" />{session.messageCount}</span>
        <span><i className="fa-solid fa-wrench text-[9px] mr-0.5" />{session.toolCallCount}</span>
        <span><i className="fa-solid fa-microchip text-[9px] mr-0.5" />{formatTokens(session.inputTokens + session.outputTokens)}</span>
        <span className="ml-auto text-amber-500">${session.estimatedCostUSD.toFixed(2)}</span>
      </div>
    </button>
  );
}

function MessageBubble({ msg }: { msg: AgentMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="flex gap-2.5">
        <div className="w-7 h-7 bg-blue-900/40 rounded-md flex items-center justify-center flex-shrink-0">
          <i className="fa-solid fa-user text-blue-400 text-[11px]" />
        </div>
        <div className="flex-1">
          <div className="text-[11px] text-blue-400 font-medium mb-1">User <span className="text-slate-600 font-normal ml-1.5">{timeAgo(msg.timestamp)} ago</span></div>
          <div className="bg-blue-900/30 rounded-tr-lg rounded-br-lg rounded-bl-lg p-2.5 text-slate-200 text-[12px] leading-relaxed inline-block whitespace-pre-wrap">
            {msg.content}
          </div>
        </div>
      </div>
    );
  }

  if (msg.role === 'tool') {
    const tc = msg.toolCalls?.[0];
    return (
      <div className="flex gap-2.5">
        <div className="w-7 h-7 bg-green-500/10 rounded-md flex items-center justify-center flex-shrink-0">
          <i className="fa-solid fa-wrench text-green-500 text-[11px]" />
        </div>
        <div className="flex-1">
          <div className="text-[11px] text-green-500 font-medium mb-1">Tool Call <span className="text-slate-600 font-normal ml-1.5">{timeAgo(msg.timestamp)} ago</span></div>
          <div className="bg-green-500/5 border border-green-500/15 rounded-md p-2.5">
            {tc && (
              <div className="flex items-center gap-1.5 mb-1.5">
                <i className="fa-solid fa-terminal text-green-500 text-[10px]" />
                <span className="text-[12px] text-slate-200 font-medium">{tc.kind}</span>
                <span className="text-[11px] text-slate-500 font-mono truncate">{tc.summary}</span>
              </div>
            )}
            <div className="bg-[#0d1117] rounded p-2 font-mono text-[11px] text-slate-400 max-h-[120px] overflow-auto leading-snug whitespace-pre-wrap">
              {msg.content}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <div className="w-7 h-7 bg-indigo-500/15 rounded-md flex items-center justify-center flex-shrink-0">
        <i className="fa-solid fa-robot text-indigo-400 text-[11px]" />
      </div>
      <div className="flex-1">
        <div className="text-[11px] text-indigo-400 font-medium mb-1">Assistant <span className="text-slate-600 font-normal ml-1.5">{timeAgo(msg.timestamp)} ago</span></div>
        {msg.reasoning && (
          <div className="bg-purple-500/8 border border-purple-500/20 rounded-md p-2 mb-1.5 text-[11px] text-purple-300">
            <i className="fa-solid fa-brain mr-1 text-[10px]" />
            <span className="font-medium">Reasoning</span>
            <div className="mt-1 text-purple-400/70 italic leading-snug whitespace-pre-wrap">{msg.reasoning}</div>
          </div>
        )}
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-tr-lg rounded-br-lg rounded-bl-lg p-2.5 text-slate-200 text-[12px] leading-relaxed whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    </div>
  );
}

export function SessionsTab({ name }: SessionsTabProps) {
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQ, setSearchQ] = useState('');

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearchQ(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const sessionsQ = useAgentSessions(name, { platform: filter, limit: 100, q: searchQ || undefined });
  const messagesQ = useAgentMessages(name, selectedId);

  const sessions = sessionsQ.data ?? [];

  // Auto-select first session when data arrives
  useEffect(() => {
    if (!selectedId && sessions.length > 0) {
      setSelectedId(sessions[0]!.id);
    }
  }, [sessions, selectedId]);

  const selected = sessions.find((s) => s.id === selectedId);
  const messages = messagesQ.data ?? [];
  const filters = ['all', 'telegram', 'slack', 'cli', 'cron', 'discord'];

  return (
    <div className="flex h-full">
      {/* Session List */}
      <div className="w-[340px] border-r border-[#2a2d3a] flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-[#2a2d3a]">
          <div className="flex items-center gap-2 bg-[#161822] border border-[#2a2d3a] rounded-md px-2.5 py-2">
            <i className="fa-solid fa-magnifying-glass text-slate-600 text-[12px]" />
            <input
              className="bg-transparent text-[12px] text-slate-200 outline-none flex-1 placeholder:text-slate-600"
              placeholder="Search sessions..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button className="text-slate-600 hover:text-slate-400 text-[11px]" onClick={() => setSearchInput('')}>
                <i className="fa-solid fa-xmark" />
              </button>
            )}
          </div>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {filters.map((f) => (
              <button
                key={f}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  filter === f ? 'text-indigo-300 bg-indigo-500/15 border-indigo-500/30' : 'text-slate-500 bg-[#161822] border-[#2a2d3a] hover:text-slate-300'
                }`}
                onClick={() => setFilter(f)}
              >
                {f !== 'all' && <PlatformIcon platform={f} className="text-[9px] mr-1" />}
                {f === 'all' ? 'All' : platformLabel(f)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessionsQ.isLoading ? (
            <div className="text-slate-500 text-sm text-center py-6">Loading…</div>
          ) : sessions.length === 0 ? (
            <div className="text-slate-500 text-sm text-center py-6">No sessions</div>
          ) : (
            sessions.map((s) => (
              <SessionListItem key={s.id} session={s} selected={s.id === selectedId} onSelect={() => setSelectedId(s.id)} />
            ))
          )}
        </div>
        <div className="p-2.5 border-t border-[#2a2d3a] flex justify-between text-[11px] text-slate-600 bg-[#161822]">
          <span>{sessions.length} sessions</span>
        </div>
      </div>

      {/* Message Detail */}
      <div className="flex-1 flex flex-col">
        {selected && (
          <div className="px-4 py-3 border-b border-[#2a2d3a] bg-[#161822]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-semibold text-slate-200">{selected.title}</span>
              {!selected.endedAt && (
                <>
                  <StatusPulse status="online" size={8} />
                  <span className="text-[11px] text-green-500">active</span>
                </>
              )}
            </div>
            <div className="flex gap-3 text-[11px] text-slate-500 flex-wrap">
              <span><PlatformIcon platform={selected.source} className="text-[10px] mr-1" />{platformLabel(selected.source)}</span>
              <span><i className="fa-solid fa-clock mr-1" />Started {timeAgo(selected.startedAt)} ago</span>
              <span><i className="fa-solid fa-message mr-1" />{selected.messageCount} messages</span>
              <span><i className="fa-solid fa-wrench mr-1" />{selected.toolCallCount} tool calls</span>
              <span><i className="fa-solid fa-microchip mr-1" />{formatTokens(selected.inputTokens + selected.outputTokens)} tokens</span>
              <span className="text-amber-500"><i className="fa-solid fa-dollar-sign mr-0.5" />${selected.estimatedCostUSD.toFixed(2)}</span>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-slate-500 text-sm">
              <div className="text-center">
                <i className="fa-solid fa-comments text-2xl mb-2 block text-slate-600" />
                Select a session to view messages
              </div>
            </div>
          ) : messagesQ.isLoading ? (
            <div className="text-slate-500 text-sm text-center">Loading messages…</div>
          ) : messages.length === 0 ? (
            <div className="text-slate-500 text-sm text-center">No messages</div>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} msg={m} />)
          )}
        </div>
      </div>
    </div>
  );
}
