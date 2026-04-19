export interface AgentSession {
  id: string;
  title: string;
  source: string;
  model: string;
  parentSessionId?: string;
  startedAt: string;
  endedAt?: string;
  endReason?: string;
  messageCount: number;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  estimatedCostUSD: number;
}

export interface AgentMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: AgentToolCall[];
  toolCallId?: string;
  reasoning?: string;
  timestamp: string;
  tokenCount: number;
}

export interface AgentToolCall {
  callId: string;
  functionName: string;
  arguments: string;
  kind: 'read' | 'edit' | 'execute' | 'fetch' | 'browser' | 'other';
  summary: string;
}

export interface AgentStats {
  totalSessions: number;
  totalMessages: number;
  totalToolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalReasoningTokens: number;
  totalCostUSD: number;
  todaySessions: number;
  todayMessages: number;
  todayCostUSD: number;
}

export interface AgentSkillCategory {
  name: string;
  skills: AgentSkill[];
}

export interface AgentSkill {
  id: string;
  name: string;
  category: string;
  files: string[];
  requiredConfig: string[];
}

export interface AgentCronJob {
  id: string;
  name: string;
  prompt: string;
  skills?: string[];
  model?: string;
  schedule: { kind: string; display?: string; expression?: string };
  enabled: boolean;
  state: 'scheduled' | 'running' | 'completed' | 'failed';
  deliver?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastError?: string;
}

export interface AgentGatewayState {
  isRunning: boolean;
  pid?: number;
  uptime?: string;
  platforms: AgentPlatformState[];
}

export interface AgentPlatformState {
  name: string;
  connected: boolean;
  sessionCount: number;
  trafficPercent: number;
}
