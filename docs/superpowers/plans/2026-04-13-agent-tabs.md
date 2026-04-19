# Agent Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 6 new agent tabs (Overview, Sessions, Analytics, Skills, Cron, Gateway) with mock data services, replacing the placeholders from Plan 1.

**Architecture:** A mock data module provides typed fake data matching the future agent API shape. Each tab consumes this mock data via React Query hooks. When the real agent API ships, we swap the data source without changing components.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, FontAwesome, React Query, hand-rolled SVG charts

---

## File Map

**New files:**
- `web/src/lib/mock-data.ts` — Mock data generators for sessions, stats, skills, cron, gateway
- `web/src/lib/agent-types.ts` — TypeScript interfaces for agent API data shapes
- `web/src/features/agent/OverviewTab.tsx` — Stats + recent sessions + activity
- `web/src/features/agent/SessionsTab.tsx` — Master-detail session browser
- `web/src/features/agent/SessionList.tsx` — Left panel: session list with search/filters
- `web/src/features/agent/MessageDetail.tsx` — Right panel: chat message thread
- `web/src/features/agent/AnalyticsTab.tsx` — Charts, breakdowns, time period selector
- `web/src/features/agent/SkillsTab.tsx` — Category tree + skill file viewer
- `web/src/features/agent/CronTab.tsx` — Cron job cards
- `web/src/features/agent/GatewayTab.tsx` — Gateway status + platform grid
- `web/src/components/shared/SessionRow.tsx` — Reusable session list item

**Modified files:**
- `web/src/features/agent/AgentWorkspace.tsx` — Replace placeholders with real tab components

---

### Task 1: Define agent data types

**Files:**
- Create: `web/src/lib/agent-types.ts`

- [ ] **Step 1: Create type definitions**

```typescript
// Agent session data (matches future Hermes API shape)
export interface AgentSession {
  id: string;
  title: string;
  source: string; // telegram, slack, cli, cron, etc.
  model: string;
  userId?: string;
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
```

- [ ] **Step 2: Verify types compile**
- [ ] **Step 3: Commit** — `feat(web): add agent API type definitions`

---

### Task 2: Create mock data service

**Files:**
- Create: `web/src/lib/mock-data.ts`

- [ ] **Step 1: Create mock data generators**

Provide static mock data that matches the agent types. Include 5-8 mock sessions, stats, 3 skill categories, 3 cron jobs, and a gateway state with 4 platforms. Each mock function returns typed data.

- [ ] **Step 2: Verify it compiles**
- [ ] **Step 3: Commit** — `feat(web): add mock data service for agent tabs`

---

### Task 3: Create SessionRow shared component

**Files:**
- Create: `web/src/components/shared/SessionRow.tsx`

- [ ] **Step 1: Create SessionRow**

Reusable session list item showing: status indicator (StatusPulse for active, fa-circle-check for completed, fa-circle-xmark for failed), title, platform icon + name, message count, tool count, token count, cost, time ago.

- [ ] **Step 2: Verify it compiles**
- [ ] **Step 3: Commit** — `feat(web): add SessionRow shared component`

---

### Task 4: Create OverviewTab

**Files:**
- Create: `web/src/features/agent/OverviewTab.tsx`

- [ ] **Step 1: Implement OverviewTab**

Four zones as per design spec:
1. Status row (4 cards): Agent status, Model, Gateway, Infrastructure — using StatusPulse, ModelIcon, CloudIcon
2. Stats grid (5 cards): Sessions, Messages, Tool Calls, Tokens, Cost — using StatCard
3. Recent Sessions (bottom-left): Last 4 sessions using SessionRow
4. Activity + Platforms (bottom-right): 7-day bar chart (hand-rolled div bars) + platform breakdown bars

Uses mock data from `mock-data.ts` via React Query with a `mockAgent` query key.

- [ ] **Step 2: Verify it compiles**
- [ ] **Step 3: Commit** — `feat(web): add agent OverviewTab with stats and recent sessions`

---

### Task 5: Create SessionsTab (SessionList + MessageDetail)

**Files:**
- Create: `web/src/features/agent/SessionList.tsx`
- Create: `web/src/features/agent/MessageDetail.tsx`
- Create: `web/src/features/agent/SessionsTab.tsx`

- [ ] **Step 1: Create SessionList**

Left panel with: search input, platform filter pills, scrollable session list using SessionRow, footer with count + DB size. Selected session highlighted with indigo border.

- [ ] **Step 2: Create MessageDetail**

Right panel with: session header (title, platform, stats), chat message thread. User messages (blue), assistant messages (indigo with collapsible reasoning), tool calls (green card with command summary + output), subagent spawns (amber card, clickable).

- [ ] **Step 3: Create SessionsTab**

Master-detail container: SessionList (340px fixed) + MessageDetail (flex-1). Manages selected session state. Uses mock sessions and messages.

- [ ] **Step 4: Verify all compile**
- [ ] **Step 5: Commit** — `feat(web): add SessionsTab with session list and message detail`

---

### Task 6: Create AnalyticsTab

**Files:**
- Create: `web/src/features/agent/AnalyticsTab.tsx`

- [ ] **Step 1: Implement AnalyticsTab**

As per design spec:
- Time period selector (7d/30d/90d/All toggle)
- Top stats row (6 compact cards)
- Cost Over Time area chart (hand-rolled SVG with gradient fill)
- Token Breakdown donut chart (SVG circles with stroke-dasharray)
- Top Tools (ranked bars with color-coded icons) + hourly activity heat strip
- Model Usage cards + Platform Breakdown bars + Notable Sessions

All data from mock-data.ts.

- [ ] **Step 2: Verify it compiles**
- [ ] **Step 3: Commit** — `feat(web): add AnalyticsTab with charts and breakdowns`

---

### Task 7: Create SkillsTab

**Files:**
- Create: `web/src/features/agent/SkillsTab.tsx`

- [ ] **Step 1: Implement SkillsTab**

Master-detail layout: Left panel with search, collapsible category tree, skill items. Right panel with skill header (name, required config), file tabs, syntax-highlighted code viewer (Monaco read-only or pre block). Uses mock skill data.

- [ ] **Step 2: Verify it compiles**
- [ ] **Step 3: Commit** — `feat(web): add SkillsTab with category tree and file viewer`

---

### Task 8: Create CronTab

**Files:**
- Create: `web/src/features/agent/CronTab.tsx`

- [ ] **Step 1: Implement CronTab**

Vertical card layout: Header with job count. Job cards showing: status indicator (StatusPulse for running, clock for scheduled, pause for disabled), name + badge, prompt in monospace, metadata row (schedule, model, delivery, last/next run). Uses mock cron data.

- [ ] **Step 2: Verify it compiles**
- [ ] **Step 3: Commit** — `feat(web): add CronTab with scheduled job cards`

---

### Task 9: Create GatewayTab

**Files:**
- Create: `web/src/features/agent/GatewayTab.tsx`

- [ ] **Step 1: Implement GatewayTab**

Gateway status bar (running/stopped + PID + uptime + restart/stop buttons). 3-column platform grid: brand icons, connection status (StatusPulse), session count + traffic %. Unconfigured platforms dimmed. Uses mock gateway data.

- [ ] **Step 2: Verify it compiles**
- [ ] **Step 3: Commit** — `feat(web): add GatewayTab with platform status grid`

---

### Task 10: Wire tabs into AgentWorkspace

**Files:**
- Modify: `web/src/features/agent/AgentWorkspace.tsx`

- [ ] **Step 1: Replace PlaceholderTab imports with real tab components**

Import and render: OverviewTab, SessionsTab, AnalyticsTab, SkillsTab, CronTab, GatewayTab. Remove PlaceholderTab function. Pass `name` prop to each tab.

- [ ] **Step 2: Verify all compiles + build passes**
- [ ] **Step 3: Browser test all 11 tabs**
- [ ] **Step 4: Commit** — `feat(web): wire all agent tabs into workspace`

---

## Summary

After Plan 2, all 11 agent tabs will render with data (mock for new tabs, real for infra tabs). Components are structured to swap mock data for real API calls when the Hermes agent API ships.
