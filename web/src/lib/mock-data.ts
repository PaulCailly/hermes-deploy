import type {
  AgentSession, AgentMessage, AgentStats, AgentSkillCategory,
  AgentCronJob, AgentGatewayState,
} from './agent-types';

export function getMockStats(): AgentStats {
  return {
    totalSessions: 1247,
    totalMessages: 18400,
    totalToolCalls: 5621,
    totalInputTokens: 8100000,
    totalOutputTokens: 4200000,
    totalCacheReadTokens: 1700000,
    totalCacheWriteTokens: 900000,
    totalReasoningTokens: 400000,
    totalCostUSD: 47.82,
    todaySessions: 23,
    todayMessages: 342,
    todayCostUSD: 3.20,
  };
}

export function getMockSessions(): AgentSession[] {
  return [
    {
      id: 's1', title: 'Debug payment webhook timeout issue', source: 'telegram',
      model: 'claude-sonnet-4-6', startedAt: new Date(Date.now() - 120_000).toISOString(),
      messageCount: 12, toolCallCount: 5, inputTokens: 16000, outputTokens: 8000,
      cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, estimatedCostUSD: 0.42,
    },
    {
      id: 's2', title: 'Generate weekly analytics report', source: 'cron',
      model: 'claude-sonnet-4-6', startedAt: new Date(Date.now() - 3600_000).toISOString(),
      endedAt: new Date(Date.now() - 3000_000).toISOString(), endReason: 'completed',
      messageCount: 34, toolCallCount: 18, inputTokens: 98000, outputTokens: 58000,
      cacheReadTokens: 12000, cacheWriteTokens: 4000, reasoningTokens: 8000, estimatedCostUSD: 1.87,
    },
    {
      id: 's3', title: 'Help user set up CI/CD pipeline', source: 'slack',
      model: 'claude-sonnet-4-6', startedAt: new Date(Date.now() - 10800_000).toISOString(),
      endedAt: new Date(Date.now() - 7200_000).toISOString(), endReason: 'completed',
      messageCount: 28, toolCallCount: 12, inputTokens: 56000, outputTokens: 33000,
      cacheReadTokens: 8000, cacheWriteTokens: 2000, reasoningTokens: 4000, estimatedCostUSD: 2.14,
    },
    {
      id: 's4', title: 'Review PR #847 — auth middleware refactor', source: 'cli',
      model: 'claude-haiku-4-5', startedAt: new Date(Date.now() - 18000_000).toISOString(),
      endedAt: new Date(Date.now() - 16000_000).toISOString(), endReason: 'completed',
      messageCount: 8, toolCallCount: 3, inputTokens: 22000, outputTokens: 10000,
      cacheReadTokens: 3000, cacheWriteTokens: 1000, reasoningTokens: 0, estimatedCostUSD: 0.63,
    },
    {
      id: 's5', title: 'Deploy staging environment', source: 'telegram',
      model: 'claude-sonnet-4-6', startedAt: new Date(Date.now() - 28800_000).toISOString(),
      endedAt: new Date(Date.now() - 28000_000).toISOString(), endReason: 'error',
      messageCount: 4, toolCallCount: 2, inputTokens: 5000, outputTokens: 3000,
      cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, estimatedCostUSD: 0.11,
    },
  ];
}

export function getMockMessages(sessionId: string): AgentMessage[] {
  if (sessionId !== 's1') return [];
  return [
    {
      id: 'm1', sessionId: 's1', role: 'user',
      content: 'The payment webhook is timing out after 30 seconds. Can you check the logs and find out what\'s blocking?',
      timestamp: new Date(Date.now() - 240_000).toISOString(), tokenCount: 42,
    },
    {
      id: 'm2', sessionId: 's1', role: 'assistant',
      content: 'I\'ll check the webhook handler logs to find the bottleneck. Let me start by looking at the recent error logs.',
      reasoning: 'I need to check the webhook handler logs. The 30s timeout suggests a database query or external API call is hanging.',
      timestamp: new Date(Date.now() - 230_000).toISOString(), tokenCount: 156,
    },
    {
      id: 'm3', sessionId: 's1', role: 'tool',
      content: 'Apr 13 14:23:01 webhook[1234]: Processing payment event evt_12345...\nApr 13 14:23:31 webhook[1234]: ERROR: Database query timeout after 30000ms\nApr 13 14:23:31 webhook[1234]: Query: SELECT * FROM transactions WHERE...',
      toolCalls: [{
        callId: 'tc1', functionName: 'execute',
        arguments: '{"command":"journalctl -u webhook --since \\"1h ago\\" --no-pager | tail -50"}',
        kind: 'execute', summary: 'journalctl -u webhook --since "1h ago" | tail -50',
      }],
      timestamp: new Date(Date.now() - 220_000).toISOString(), tokenCount: 340,
    },
    {
      id: 'm4', sessionId: 's1', role: 'assistant',
      content: 'Found it. The database query on the `transactions` table is timing out. The query is doing a full table scan because there\'s no index on the `event_id` column. Let me check the table structure.',
      timestamp: new Date(Date.now() - 210_000).toISOString(), tokenCount: 89,
    },
  ];
}

export function getMockSkills(): AgentSkillCategory[] {
  return [
    {
      name: 'coding',
      skills: [
        { id: 'coding/code-review', name: 'code-review', category: 'coding', files: ['skill.yaml', 'prompt.md', 'handler.py'], requiredConfig: ['GITHUB_TOKEN'] },
        { id: 'coding/refactor', name: 'refactor', category: 'coding', files: ['skill.yaml', 'prompt.md'], requiredConfig: [] },
        { id: 'coding/test-writer', name: 'test-writer', category: 'coding', files: ['skill.yaml', 'prompt.md'], requiredConfig: [] },
        { id: 'coding/debug', name: 'debug', category: 'coding', files: ['skill.yaml', 'prompt.md', 'tools.py'], requiredConfig: [] },
      ],
    },
    {
      name: 'devops',
      skills: [
        { id: 'devops/deploy', name: 'deploy', category: 'devops', files: ['skill.yaml', 'prompt.md'], requiredConfig: ['SSH_KEY_PATH'] },
        { id: 'devops/monitoring', name: 'monitoring', category: 'devops', files: ['skill.yaml', 'prompt.md'], requiredConfig: ['GRAFANA_URL'] },
        { id: 'devops/incident', name: 'incident', category: 'devops', files: ['skill.yaml', 'prompt.md', 'runbook.md'], requiredConfig: ['PAGERDUTY_KEY'] },
      ],
    },
    {
      name: 'research',
      skills: [
        { id: 'research/web-search', name: 'web-search', category: 'research', files: ['skill.yaml', 'prompt.md'], requiredConfig: [] },
        { id: 'research/summarize', name: 'summarize', category: 'research', files: ['skill.yaml', 'prompt.md'], requiredConfig: [] },
      ],
    },
  ];
}

const SKILL_FILE_CONTENTS: Record<string, string> = {
  'skill.yaml': `name: code-review
description: Review pull requests and suggest improvements
required_config:
  - GITHUB_TOKEN
model: claude-sonnet-4-6`,
  'prompt.md': `# Code Review Skill

You are a code reviewer. When given a PR URL or diff, analyze the changes and provide:

1. **Summary** of what changed
2. **Issues** found (bugs, security, performance)
3. **Suggestions** for improvement
4. **Approval** recommendation`,
  'handler.py': `import subprocess

def fetch_pr(pr_url: str) -> dict:
    """Fetch PR details from GitHub API."""
    result = subprocess.run(
        ["gh", "pr", "view", pr_url, "--json", "title,body,diff"],
        capture_output=True, text=True
    )
    return json.loads(result.stdout)`,
};

export function getMockSkillFileContent(fileName: string): string {
  return SKILL_FILE_CONTENTS[fileName] ?? `# ${fileName}\n\nFile content not available.`;
}

export function getMockCronJobs(): AgentCronJob[] {
  return [
    {
      id: 'cj1', name: 'Weekly analytics report',
      prompt: 'Generate the weekly analytics report and deliver via email',
      model: 'claude-sonnet-4-6',
      schedule: { kind: 'weekly', display: 'Mon 9:00' },
      enabled: true, state: 'running', deliver: 'email',
      lastRunAt: new Date(Date.now() - 3600_000).toISOString(),
      nextRunAt: 'Mon 9:00',
    },
    {
      id: 'cj2', name: 'Daily backup verification',
      prompt: 'Check all backup targets and verify integrity, report failures',
      model: 'claude-haiku-4-5',
      schedule: { kind: 'daily', display: 'daily 06:00' },
      enabled: true, state: 'scheduled', deliver: 'slack',
      lastRunAt: new Date(Date.now() - 57600_000).toISOString(),
      nextRunAt: 'tomorrow 06:00',
    },
    {
      id: 'cj3', name: 'Dependency audit',
      prompt: 'Audit all project dependencies for security vulnerabilities',
      schedule: { kind: 'cron', expression: '0 0 * * 0', display: 'weekly Sun 00:00' },
      enabled: false, state: 'scheduled',
      lastRunAt: new Date(Date.now() - 1209600_000).toISOString(),
    },
  ];
}

export function getMockGatewayState(): AgentGatewayState {
  return {
    isRunning: true,
    pid: 48291,
    uptime: '14d 6h',
    platforms: [
      { name: 'telegram', connected: true, sessionCount: 562, trafficPercent: 45 },
      { name: 'slack', connected: true, sessionCount: 374, trafficPercent: 30 },
      { name: 'discord', connected: true, sessionCount: 89, trafficPercent: 7 },
      { name: 'whatsapp', connected: false, sessionCount: 0, trafficPercent: 0 },
      { name: 'email', connected: false, sessionCount: 0, trafficPercent: 0 },
      { name: 'webhook', connected: true, sessionCount: 22, trafficPercent: 2 },
    ],
  };
}

// Org-level aggregates (for Plan 3)
export function getMockOrgStats() {
  return {
    totalAgents: 4,
    onlineAgents: 3,
    totalSessions: 3842,
    weekSessions: 127,
    totalTokens: 41200000,
    inputTokens: 28000000,
    outputTokens: 13200000,
    activeSessions: 2,
    totalCostUSD: 142.67,
    weekCostUSD: 18.40,
  };
}

export function getMockLiveActivity() {
  return [
    { id: 'la1', title: 'Debug payment webhook timeout', agent: 'hermes-prod', source: 'telegram', active: true, timeAgo: '2m' },
    { id: 'la2', title: 'Run test suite for feature branch', agent: 'hermes-dev', source: 'cli', active: true, timeAgo: '8m' },
    { id: 'la3', title: 'Generate weekly analytics report', agent: 'hermes-staging', source: 'cron', active: false, timeAgo: '1h' },
    { id: 'la4', title: 'Help user set up CI/CD pipeline', agent: 'hermes-prod', source: 'slack', active: false, timeAgo: '3h' },
  ];
}

export function getMockUpcomingCrons() {
  return [
    { id: 'uc1', name: 'Daily backup verification', agent: 'hermes-staging', nextRun: 'tomorrow 06:00' },
    { id: 'uc2', name: 'Weekly analytics report', agent: 'hermes-staging', nextRun: 'Mon 09:00' },
    { id: 'uc3', name: 'Code quality scan', agent: 'hermes-dev', nextRun: 'Mon 08:00' },
  ];
}
