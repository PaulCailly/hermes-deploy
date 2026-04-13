export const AGENT_TABS = [
  'overview', 'sessions', 'analytics', 'skills', 'cron', 'gateway',
  'infra', 'config', 'logs', 'ssh', 'secrets',
] as const;

export type AgentTab = (typeof AGENT_TABS)[number];

export type Route =
  | { page: 'dashboard' }
  | { page: 'agents' }
  | { page: 'agent'; name: string; tab: AgentTab }
  | { page: 'new' }
  | { page: 'job'; jobId: string };

export type Navigate = (route: Route) => void;
