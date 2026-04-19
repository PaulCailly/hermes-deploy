# Foundation & Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the web dashboard navigation from flat deployment-centric to agent-centric with sidebar, agent workspace tabs, and shared components — while preserving all existing functionality.

**Architecture:** Two-level navigation: primary sidebar (always visible) with org-level pages + agent shortcuts, and per-agent tab bar (Overview through Secrets). Existing deployment features migrate into the agent workspace "Infra" tab. "Deployments" are renamed to "Agents" throughout.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Vite, FontAwesome (CDN), React Query, Zustand, xterm.js, Monaco Editor

**Note:** This project has no test runner. Verification uses TypeScript compilation (`tsc --noEmit`) and manual browser testing. Build verification at each commit.

---

## File Map

**New files:**
- `web/index.html` — Add FontAwesome CDN link
- `web/src/components/shared/StatusPulse.tsx` — Animated SVG online indicator
- `web/src/components/shared/PlatformIcon.tsx` — Brand icon mapper (Telegram, Slack, etc.)
- `web/src/components/shared/ModelIcon.tsx` — Anthropic/OpenAI SVG logos
- `web/src/components/shared/CloudIcon.tsx` — AWS/GCP icon mapper
- `web/src/components/shared/StatCard.tsx` — Reusable metric card
- `web/src/components/shared/SessionRow.tsx` — Reusable session list item
- `web/src/components/layout/Sidebar.tsx` — Primary sidebar navigation
- `web/src/features/agent/AgentHeader.tsx` — Agent name, health, cloud, model bar
- `web/src/features/agent/AgentTabBar.tsx` — 11-tab navigation bar
- `web/src/features/agent/AgentWorkspace.tsx` — Tab container routing to tab content
- `web/src/features/agent/InfraTab.tsx` — Merged OverviewTab + ActionsTab
- `web/src/features/agents/AgentList.tsx` — Enhanced deployment grid (renamed)
- `web/src/lib/types.ts` — Route types, AgentTab type, shared interfaces

**Modified files:**
- `web/src/App.tsx` — New route state machine + sidebar layout
- `web/src/components/layout/AppShell.tsx` — Sidebar + content area layout
- `web/src/features/wizard/NewDeploymentWizard.tsx` — Rename references to "Agent"

**Unchanged files (migrated by reference):**
- `web/src/features/config/ConfigTab.tsx`
- `web/src/features/logs/LogsTab.tsx`
- `web/src/features/ssh/SshTab.tsx`
- `web/src/features/secrets/SecretsTab.tsx`
- `web/src/features/jobs/*`
- `web/src/lib/api.ts`, `ws.ts`, `token.ts`, `queryClient.ts`

---

### Task 1: Add FontAwesome CDN and define route types

**Files:**
- Modify: `web/index.html`
- Create: `web/src/lib/types.ts`

- [ ] **Step 1: Add FontAwesome CSS to index.html**

Add the FontAwesome 6 CDN link in the `<head>` of `web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hermes Deploy</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
  </head>
  <body class="bg-gray-950 text-gray-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create route types**

Create `web/src/lib/types.ts`:

```typescript
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
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: No errors from `types.ts`

- [ ] **Step 4: Commit**

```bash
git add web/index.html web/src/lib/types.ts
git commit -m "feat(web): add FontAwesome CDN and route types for agent-centric navigation"
```

---

### Task 2: Create StatusPulse component

**Files:**
- Create: `web/src/components/shared/StatusPulse.tsx`

- [ ] **Step 1: Create the animated SVG pulse component**

Create `web/src/components/shared/StatusPulse.tsx`:

```tsx
interface StatusPulseProps {
  status: 'online' | 'offline' | 'warning';
  size?: number;
}

const colors = {
  online: '#22c55e',
  offline: '#64748b',
  warning: '#f59e0b',
};

export function StatusPulse({ status, size = 10 }: StatusPulseProps) {
  const color = colors[status];
  const r = size * 0.35;

  if (status === 'offline') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill={color} />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill={color}>
        <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="1" opacity="0.3">
        <animate attributeName="r" values={`${r};${r * 1.6};${r}`} dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/components/shared/StatusPulse.tsx
git commit -m "feat(web): add StatusPulse animated SVG component"
```

---

### Task 3: Create icon mapper components

**Files:**
- Create: `web/src/components/shared/PlatformIcon.tsx`
- Create: `web/src/components/shared/ModelIcon.tsx`
- Create: `web/src/components/shared/CloudIcon.tsx`

- [ ] **Step 1: Create PlatformIcon**

Create `web/src/components/shared/PlatformIcon.tsx`:

```tsx
interface PlatformIconProps {
  platform: string;
  className?: string;
}

const platformMap: Record<string, { icon: string; color: string; label: string }> = {
  telegram:  { icon: 'fa-brands fa-telegram',   color: '#26a5e4', label: 'Telegram' },
  slack:     { icon: 'fa-brands fa-slack',       color: '#e01e5a', label: 'Slack' },
  discord:   { icon: 'fa-brands fa-discord',     color: '#5865f2', label: 'Discord' },
  whatsapp:  { icon: 'fa-brands fa-whatsapp',    color: '#25d366', label: 'WhatsApp' },
  signal:    { icon: 'fa-solid fa-comment-dots',  color: '#3a76f0', label: 'Signal' },
  email:     { icon: 'fa-solid fa-envelope',      color: '#94a3b8', label: 'Email' },
  webhook:   { icon: 'fa-solid fa-globe',         color: '#94a3b8', label: 'Webhook' },
  matrix:    { icon: 'fa-solid fa-hashtag',       color: '#0dbd8b', label: 'Matrix' },
  cli:       { icon: 'fa-solid fa-terminal',      color: '#94a3b8', label: 'CLI' },
  cron:      { icon: 'fa-solid fa-clock',         color: '#8b5cf6', label: 'Cron' },
};

const fallback = { icon: 'fa-solid fa-circle-question', color: '#64748b', label: 'Unknown' };

export function PlatformIcon({ platform, className }: PlatformIconProps) {
  const p = platformMap[platform.toLowerCase()] ?? fallback;
  return <i className={`${p.icon} ${className ?? ''}`} style={{ color: p.color }} title={p.label} />;
}

export function platformLabel(platform: string): string {
  return (platformMap[platform.toLowerCase()] ?? fallback).label;
}
```

- [ ] **Step 2: Create ModelIcon**

Create `web/src/components/shared/ModelIcon.tsx`:

```tsx
interface ModelIconProps {
  model: string;
  size?: number;
}

function AnthropicLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 46 32" fill="#d9ac78">
      <path d="M32.73 0H26.l-13.27 32h6.73L32.73 0Zm-19.46 0H6.73L0 32h6.54l1.36-3.83h11.08L20.34 32h6.73L19.27 0Zm-2.64 22.61 3.56-10.05 3.56 10.05H10.63Z" />
    </svg>
  );
}

function OpenAILogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#10a37f">
      <path d="M22.28 9.37a5.88 5.88 0 0 0-.51-4.84 5.97 5.97 0 0 0-6.43-2.88A5.9 5.9 0 0 0 10.9 0a5.97 5.97 0 0 0-5.69 4.1 5.89 5.89 0 0 0-3.93 2.85 5.97 5.97 0 0 0 .74 7.01 5.88 5.88 0 0 0 .5 4.84 5.97 5.97 0 0 0 6.44 2.88A5.9 5.9 0 0 0 13.1 24a5.97 5.97 0 0 0 5.7-4.1 5.89 5.89 0 0 0 3.92-2.86 5.97 5.97 0 0 0-.73-7.01ZM13.1 22.43a4.47 4.47 0 0 1-2.87-1.04l.14-.08 4.77-2.76a.78.78 0 0 0 .39-.67v-6.73l2.02 1.16a.07.07 0 0 1 .04.06v5.58a4.49 4.49 0 0 1-4.49 4.48Z" />
    </svg>
  );
}

export function ModelIcon({ model, size = 18 }: ModelIconProps) {
  const lower = model.toLowerCase();
  if (lower.includes('claude') || lower.includes('anthropic')) {
    return <AnthropicLogo size={size} />;
  }
  if (lower.includes('gpt') || lower.includes('openai')) {
    return <OpenAILogo size={size} />;
  }
  return <i className="fa-solid fa-robot" style={{ fontSize: size, color: '#818cf8' }} />;
}
```

- [ ] **Step 3: Create CloudIcon**

Create `web/src/components/shared/CloudIcon.tsx`:

```tsx
interface CloudIconProps {
  cloud: string;
  className?: string;
}

const cloudMap: Record<string, { icon: string; color: string; label: string }> = {
  aws: { icon: 'fa-brands fa-aws', color: '#ff9900', label: 'AWS' },
  gcp: { icon: 'fa-brands fa-google', color: '#4285f4', label: 'Google Cloud' },
  azure: { icon: 'fa-brands fa-microsoft', color: '#0078d4', label: 'Azure' },
  hetzner: { icon: 'fa-solid fa-server', color: '#d50c2d', label: 'Hetzner' },
};

const fallback = { icon: 'fa-solid fa-cloud', color: '#64748b', label: 'Cloud' };

export function CloudIcon({ cloud, className }: CloudIconProps) {
  const c = cloudMap[cloud.toLowerCase()] ?? fallback;
  return <i className={`${c.icon} ${className ?? ''}`} style={{ color: c.color }} title={c.label} />;
}

export function cloudLabel(cloud: string): string {
  return (cloudMap[cloud.toLowerCase()] ?? fallback).label;
}
```

- [ ] **Step 4: Verify all compile**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add web/src/components/shared/PlatformIcon.tsx web/src/components/shared/ModelIcon.tsx web/src/components/shared/CloudIcon.tsx
git commit -m "feat(web): add PlatformIcon, ModelIcon, CloudIcon mapper components"
```

---

### Task 4: Create StatCard component

**Files:**
- Create: `web/src/components/shared/StatCard.tsx`

- [ ] **Step 1: Create StatCard**

Create `web/src/components/shared/StatCard.tsx`:

```tsx
interface StatCardProps {
  icon: string;
  label: string;
  value: string | number;
  sub?: string;
  subColor?: string;
}

export function StatCard({ icon, label, value, sub, subColor }: StatCardProps) {
  return (
    <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-3.5">
      <div className="flex items-center gap-1.5 mb-1">
        <i className={`${icon} text-[11px] text-slate-500`} />
        <span className="text-[11px] text-slate-500">{label}</span>
      </div>
      <div className="text-[22px] font-bold text-slate-200">{value}</div>
      {sub && (
        <div className={`text-[11px] mt-0.5 ${subColor ?? 'text-slate-400'}`}>{sub}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/components/shared/StatCard.tsx
git commit -m "feat(web): add StatCard reusable metric component"
```

---

### Task 5: Create Sidebar component

**Files:**
- Create: `web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create Sidebar**

Create `web/src/components/layout/Sidebar.tsx`:

```tsx
import { StatusPulse } from '../shared/StatusPulse';
import { CloudIcon } from '../shared/CloudIcon';
import type { Route, Navigate } from '../../lib/types';
import type { DeploymentSummaryDto } from '@hermes/dto';

interface SidebarProps {
  route: Route;
  navigate: Navigate;
  agents: DeploymentSummaryDto[];
}

export function Sidebar({ route, navigate, agents }: SidebarProps) {
  const isActive = (page: string) =>
    route.page === page ? 'text-indigo-300 bg-indigo-500/10 border-l-2 border-indigo-500' : 'text-slate-400 border-l-2 border-transparent';

  const isAgentActive = (name: string) =>
    route.page === 'agent' && route.name === name;

  return (
    <aside className="w-[200px] bg-[#161822] border-r border-[#2a2d3a] flex flex-col flex-shrink-0 h-screen sticky top-0">
      {/* Logo */}
      <div
        className="px-4 py-4 pb-5 font-bold text-[15px] text-slate-200 tracking-tight cursor-pointer"
        onClick={() => navigate({ page: 'dashboard' })}
      >
        <span className="text-slate-200">hermes</span>
        <span className="text-indigo-500">deploy</span>
      </div>

      {/* Overview Section */}
      <div className="px-4 text-[10px] uppercase text-slate-500 tracking-widest mb-1">
        Overview
      </div>
      <button
        className={`px-4 py-2 text-left text-[13px] ${isActive('dashboard')} hover:text-indigo-300 transition-colors`}
        onClick={() => navigate({ page: 'dashboard' })}
      >
        <i className="fa-solid fa-gauge-high mr-2 text-[12px]" />
        Dashboard
      </button>
      <button
        className={`px-4 py-2 text-left text-[13px] ${isActive('agents')} hover:text-indigo-300 transition-colors`}
        onClick={() => navigate({ page: 'agents' })}
      >
        <i className="fa-solid fa-robot mr-2 text-[12px]" />
        Agents
      </button>

      {/* Shared Resources */}
      <div className="px-4 text-[10px] uppercase text-slate-500 tracking-widest mt-4 mb-1">
        Shared Resources
      </div>
      <div className="px-4 py-2 text-[13px] text-slate-500 cursor-not-allowed">
        <i className="fa-solid fa-book mr-2 text-[12px]" />
        Skills Library
      </div>
      <div className="px-4 py-2 text-[13px] text-slate-500 cursor-not-allowed">
        <i className="fa-solid fa-gear mr-2 text-[12px]" />
        Settings
      </div>

      {/* Agent Shortcuts */}
      <div className="px-4 text-[10px] uppercase text-slate-500 tracking-widest mt-4 mb-1">
        Agents
      </div>
      <div className="flex-1 overflow-y-auto">
        {agents.map((agent) => (
          <button
            key={agent.name}
            className={`w-full px-4 py-1.5 text-left text-[12px] flex items-center gap-2 hover:text-indigo-300 transition-colors ${
              isAgentActive(agent.name) ? 'text-indigo-300 bg-indigo-500/5' : 'text-slate-400'
            }`}
            onClick={() => navigate({ page: 'agent', name: agent.name, tab: 'overview' })}
          >
            <StatusPulse
              status={agent.storedHealth === 'healthy' ? 'online' : agent.storedHealth === 'unhealthy' ? 'warning' : 'offline'}
              size={6}
            />
            <span className="truncate">{agent.name}</span>
          </button>
        ))}
      </div>

      {/* New Agent Button */}
      <button
        className="px-4 py-2.5 text-[12px] text-indigo-500 hover:text-indigo-400 transition-colors border-t border-[#2a2d3a]"
        onClick={() => navigate({ page: 'new' })}
      >
        <i className="fa-solid fa-plus mr-1" />
        New Agent
      </button>
    </aside>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: No errors (may need to check that `DeploymentSummaryDto` has `storedHealth` and `name` fields — it does based on current codebase)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/layout/Sidebar.tsx
git commit -m "feat(web): add Sidebar with agent shortcuts and navigation"
```

---

### Task 6: Redesign AppShell with sidebar layout

**Files:**
- Modify: `web/src/components/layout/AppShell.tsx`

- [ ] **Step 1: Rewrite AppShell**

Replace the contents of `web/src/components/layout/AppShell.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import type { Route, Navigate } from '../../lib/types';
import type { DeploymentSummaryDto } from '@hermes/dto';

interface AppShellProps {
  children: ReactNode;
  route: Route;
  navigate: Navigate;
  agents: DeploymentSummaryDto[];
}

export function AppShell({ children, route, navigate, agents }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-[#0f1117]">
      <Sidebar route={route} navigate={navigate} agents={agents} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: Errors in `App.tsx` (it still uses old AppShell signature) — that's expected, we'll fix in Task 11.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/layout/AppShell.tsx
git commit -m "feat(web): redesign AppShell with sidebar layout"
```

---

### Task 7: Create AgentHeader and AgentTabBar

**Files:**
- Create: `web/src/features/agent/AgentHeader.tsx`
- Create: `web/src/features/agent/AgentTabBar.tsx`

- [ ] **Step 1: Create AgentHeader**

Create `web/src/features/agent/AgentHeader.tsx`:

```tsx
import { StatusPulse } from '../../components/shared/StatusPulse';
import { CloudIcon } from '../../components/shared/CloudIcon';
import { ModelIcon } from '../../components/shared/ModelIcon';
import type { StatusPayloadDto } from '@hermes/dto';

interface AgentHeaderProps {
  name: string;
  status: StatusPayloadDto | undefined;
}

export function AgentHeader({ name, status }: AgentHeaderProps) {
  const health = status?.storedHealth ?? 'unknown';
  const cloud = status?.cloud ?? '';
  const region = status?.region ?? '';
  const model = status?.liveState?.configHash ?? '';

  return (
    <div className="px-5 py-3 border-b border-[#2a2d3a] flex items-center gap-3 bg-[#161822]">
      <StatusPulse
        status={health === 'healthy' ? 'online' : health === 'unhealthy' ? 'warning' : 'offline'}
        size={8}
      />
      <span className="font-semibold text-slate-200 text-sm">{name}</span>
      {cloud && (
        <span className="text-[11px] text-slate-500 bg-[#1e2030] px-2 py-0.5 rounded flex items-center gap-1.5">
          <CloudIcon cloud={cloud} className="text-[11px]" />
          {cloud.toUpperCase()} {region}
        </span>
      )}
      <span className="flex-1" />
      <span className={`text-[11px] ${health === 'healthy' ? 'text-green-500' : health === 'unhealthy' ? 'text-red-400' : 'text-slate-500'}`}>
        {health === 'healthy' && '● healthy'}
        {health === 'unhealthy' && '● unhealthy'}
        {health === 'unknown' && '● unknown'}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Create AgentTabBar**

Create `web/src/features/agent/AgentTabBar.tsx`:

```tsx
import type { AgentTab } from '../../lib/types';

interface AgentTabBarProps {
  active: AgentTab;
  onSelect: (tab: AgentTab) => void;
}

const operationTabs: { id: AgentTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'skills', label: 'Skills' },
  { id: 'cron', label: 'Cron' },
  { id: 'gateway', label: 'Gateway' },
];

const infraTabs: { id: AgentTab; label: string }[] = [
  { id: 'infra', label: 'Infra' },
  { id: 'config', label: 'Config' },
  { id: 'logs', label: 'Logs' },
  { id: 'ssh', label: 'SSH' },
  { id: 'secrets', label: 'Secrets' },
];

function TabButton({ id, label, active, onSelect }: { id: AgentTab; label: string; active: boolean; onSelect: (tab: AgentTab) => void }) {
  return (
    <button
      className={`px-3.5 py-2.5 text-[12px] border-b-2 transition-colors ${
        active
          ? 'text-indigo-300 border-indigo-500 font-medium'
          : 'text-slate-500 border-transparent hover:text-slate-300'
      }`}
      onClick={() => onSelect(id)}
    >
      {label}
    </button>
  );
}

export function AgentTabBar({ active, onSelect }: AgentTabBarProps) {
  return (
    <div className="px-5 border-b border-[#2a2d3a] flex gap-0 bg-[#13141f]">
      {operationTabs.map((t) => (
        <TabButton key={t.id} {...t} active={active === t.id} onSelect={onSelect} />
      ))}
      <div className="border-l border-[#2a2d3a] ml-2" />
      {infraTabs.map((t) => (
        <TabButton key={t.id} {...t} active={active === t.id} onSelect={onSelect} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify both compile**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: No errors from these files

- [ ] **Step 4: Commit**

```bash
git add web/src/features/agent/AgentHeader.tsx web/src/features/agent/AgentTabBar.tsx
git commit -m "feat(web): add AgentHeader and AgentTabBar components"
```

---

### Task 8: Create InfraTab (merge OverviewTab + ActionsTab)

**Files:**
- Create: `web/src/features/agent/InfraTab.tsx`

- [ ] **Step 1: Create InfraTab**

This merges the current `OverviewTab` (status display) and `ActionsTab` (update/destroy) into a single tab. Create `web/src/features/agent/InfraTab.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { JobDrawer } from '../jobs/JobDrawer';
import type { StatusPayloadDto } from '@hermes/dto';

interface InfraTabProps {
  name: string;
  status: StatusPayloadDto | undefined;
  navigate: (route: { page: 'job'; jobId: string }) => void;
}

function healthBadge(h: string) {
  if (h === 'healthy') return 'bg-emerald-900/30 text-emerald-400';
  if (h === 'unhealthy') return 'bg-red-900/30 text-red-400';
  return 'bg-yellow-900/30 text-yellow-400';
}

function stateBadge(s: string) {
  if (s === 'running') return 'bg-emerald-900/30 text-emerald-400';
  if (s === 'stopped' || s === 'terminated') return 'bg-red-900/30 text-red-400';
  return 'bg-yellow-900/30 text-yellow-400';
}

function InfoRow({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className="text-slate-500 text-sm">{label}</span>
      {badge ? (
        <span className={`text-xs px-2 py-0.5 rounded ${badge}`}>{value}</span>
      ) : (
        <span className="text-slate-200 text-sm font-mono">{value || '—'}</span>
      )}
    </div>
  );
}

export function InfraTab({ name, status, navigate }: InfraTabProps) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  async function runAction(action: 'up' | 'update' | 'destroy') {
    setError('');
    try {
      const res = await apiFetch<{ jobId: string }>(
        `/api/deployments/${encodeURIComponent(name)}/${action}`,
        { method: 'POST' },
      );
      setJobId(res.jobId);
    } catch (e: any) {
      setError(e.message ?? 'Action failed');
    }
  }

  function startDestroy() {
    setConfirmDestroy(true);
    timerRef.current = setTimeout(() => setConfirmDestroy(false), 5000);
  }

  const s = status;
  const live = s?.liveState;

  return (
    <div className="p-5 max-w-4xl">
      {/* Status Section */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-server mr-2 text-indigo-500" />Deployment Info
          </h3>
          <InfoRow label="Cloud" value={s?.cloud ?? '—'} />
          <InfoRow label="Region" value={s?.region ?? '—'} />
          <InfoRow label="IP" value={s?.ip ?? '—'} />
          <InfoRow label="Health" value={s?.storedHealth ?? 'unknown'} badge={healthBadge(s?.storedHealth ?? 'unknown')} />
          <InfoRow label="Last Deployed" value={s?.lastDeployedAt ? new Date(s.lastDeployedAt).toLocaleString() : '—'} />
        </div>
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">
            <i className="fa-solid fa-satellite-dish mr-2 text-indigo-500" />Live State
          </h3>
          {live ? (
            <>
              <InfoRow label="Instance" value={live.instanceState ?? '—'} badge={stateBadge(live.instanceState ?? '')} />
              <InfoRow label="Public IP" value={live.publicIp ?? '—'} />
              <InfoRow label="Config Hash" value={live.configHash?.slice(0, 12) ?? '—'} />
              <InfoRow label="Nix Hash" value={live.nixHash?.slice(0, 12) ?? '—'} />
            </>
          ) : (
            <p className="text-slate-500 text-sm">No live state available</p>
          )}
        </div>
      </div>

      {/* Actions Section */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-2">
            <i className="fa-solid fa-arrow-up-from-bracket mr-2 text-indigo-500" />Update
          </h3>
          <p className="text-xs text-slate-500 mb-3">Push config changes to the running instance.</p>
          <button
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors"
            onClick={() => runAction('update')}
          >
            Update
          </button>
        </div>
        <div className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-2">
            <i className="fa-solid fa-trash mr-2 text-red-400" />Destroy
          </h3>
          <p className="text-xs text-slate-500 mb-3">Tear down all cloud resources for this agent.</p>
          {confirmDestroy ? (
            <button
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded transition-colors"
              onClick={() => { setConfirmDestroy(false); runAction('destroy'); }}
            >
              Confirm Destroy
            </button>
          ) : (
            <button
              className="px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-sm rounded transition-colors"
              onClick={startDestroy}
            >
              Destroy
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-900/20 border border-red-800/30 rounded text-red-400 text-sm">{error}</div>
      )}

      {jobId && (
        <div className="mt-4">
          <JobDrawer
            jobId={jobId}
            onClose={() => setJobId(null)}
            onFullScreen={() => navigate({ page: 'job', jobId })}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: No errors from InfraTab (may have errors in App.tsx — that's expected)

- [ ] **Step 3: Commit**

```bash
git add web/src/features/agent/InfraTab.tsx
git commit -m "feat(web): add InfraTab merging deployment overview and actions"
```

---

### Task 9: Create AgentWorkspace

**Files:**
- Create: `web/src/features/agent/AgentWorkspace.tsx`

- [ ] **Step 1: Create AgentWorkspace**

This is the tab container. For Phase 1, new tabs (overview, sessions, analytics, skills, cron, gateway) show placeholder content. Existing tabs are wired to their real components. Create `web/src/features/agent/AgentWorkspace.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { AgentHeader } from './AgentHeader';
import { AgentTabBar } from './AgentTabBar';
import { InfraTab } from './InfraTab';
import { ConfigTab } from '../config/ConfigTab';
import { LogsTab } from '../logs/LogsTab';
import { SshTab } from '../ssh/SshTab';
import { SecretsTab } from '../secrets/SecretsTab';
import type { AgentTab, Navigate } from '../../lib/types';
import type { StatusPayloadDto } from '@hermes/dto';

interface AgentWorkspaceProps {
  name: string;
  tab: AgentTab;
  navigate: Navigate;
}

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-96 text-slate-500">
      <div className="text-center">
        <i className="fa-solid fa-hammer text-3xl mb-3 block text-slate-600" />
        <p className="text-sm">{label} — coming in Plan 2</p>
      </div>
    </div>
  );
}

export function AgentWorkspace({ name, tab, navigate }: AgentWorkspaceProps) {
  const { data: status } = useQuery({
    queryKey: ['agent-status', name],
    queryFn: () => apiFetch<StatusPayloadDto>(`/api/deployments/${encodeURIComponent(name)}`),
    refetchInterval: 20_000,
  });

  function onTabSelect(t: AgentTab) {
    navigate({ page: 'agent', name, tab: t });
  }

  function renderTab() {
    switch (tab) {
      case 'overview':
        return <PlaceholderTab label="Overview" />;
      case 'sessions':
        return <PlaceholderTab label="Sessions" />;
      case 'analytics':
        return <PlaceholderTab label="Analytics" />;
      case 'skills':
        return <PlaceholderTab label="Skills" />;
      case 'cron':
        return <PlaceholderTab label="Cron" />;
      case 'gateway':
        return <PlaceholderTab label="Gateway" />;
      case 'infra':
        return <InfraTab name={name} status={status} navigate={navigate} />;
      case 'config':
        return <ConfigTab name={name} />;
      case 'logs':
        return <LogsTab name={name} />;
      case 'ssh':
        return <SshTab name={name} />;
      case 'secrets':
        return <SecretsTab name={name} />;
      default:
        return <PlaceholderTab label={tab} />;
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <AgentHeader name={name} status={status} />
      <AgentTabBar active={tab} onSelect={onTabSelect} />
      <div className="flex-1 overflow-auto bg-[#0f1117]">
        {renderTab()}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: No errors from AgentWorkspace. Existing tabs (ConfigTab, LogsTab, SshTab, SecretsTab) should import fine since their interfaces haven't changed.

- [ ] **Step 3: Commit**

```bash
git add web/src/features/agent/AgentWorkspace.tsx
git commit -m "feat(web): add AgentWorkspace tab container with migrated tabs"
```

---

### Task 10: Create AgentList

**Files:**
- Create: `web/src/features/agents/AgentList.tsx`

- [ ] **Step 1: Create AgentList**

Enhanced version of DeploymentList, renamed to "Agents" terminology. Create `web/src/features/agents/AgentList.tsx`:

```tsx
import { StatusPulse } from '../../components/shared/StatusPulse';
import { CloudIcon } from '../../components/shared/CloudIcon';
import type { Navigate } from '../../lib/types';
import type { DeploymentSummaryDto } from '@hermes/dto';

interface AgentListProps {
  agents: DeploymentSummaryDto[];
  navigate: Navigate;
}

function healthStatus(h: string): 'online' | 'warning' | 'offline' {
  if (h === 'healthy') return 'online';
  if (h === 'unhealthy') return 'warning';
  return 'offline';
}

function healthLabel(h: string) {
  if (h === 'healthy') return { text: 'healthy', cls: 'text-green-400 bg-green-900/20' };
  if (h === 'unhealthy') return { text: 'unhealthy', cls: 'text-red-400 bg-red-900/20' };
  return { text: 'unknown', cls: 'text-yellow-400 bg-yellow-900/20' };
}

export function AgentList({ agents, navigate }: AgentListProps) {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-slate-200">
          <i className="fa-solid fa-robot mr-2 text-indigo-500" />
          Agents
        </h1>
        <button
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors"
          onClick={() => navigate({ page: 'new' })}
        >
          <i className="fa-solid fa-plus mr-1.5" />
          New Agent
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <i className="fa-solid fa-robot text-4xl mb-4 block text-slate-600" />
          <p className="text-sm mb-4">No agents yet</p>
          <button
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors"
            onClick={() => navigate({ page: 'new' })}
          >
            Create your first agent
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => {
            const h = healthLabel(agent.storedHealth ?? 'unknown');
            return (
              <button
                key={agent.name}
                className="bg-[#161822] border border-[#2a2d3a] rounded-lg p-4 text-left hover:border-indigo-500/30 transition-colors"
                onClick={() => navigate({ page: 'agent', name: agent.name, tab: 'overview' })}
              >
                <div className="flex items-center gap-2 mb-3">
                  <StatusPulse status={healthStatus(agent.storedHealth ?? 'unknown')} size={8} />
                  <span className="font-semibold text-slate-200 text-sm truncate">{agent.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ml-auto ${h.cls}`}>{h.text}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-2">
                  <CloudIcon cloud={agent.cloud ?? ''} className="text-[12px]" />
                  <span>{agent.cloud?.toUpperCase()} {agent.region}</span>
                </div>
                {agent.ip && (
                  <div className="text-[11px] text-slate-500 font-mono">{agent.ip}</div>
                )}
                {agent.lastDeployedAt && (
                  <div className="text-[10px] text-slate-600 mt-2">
                    Deployed {new Date(agent.lastDeployedAt).toLocaleDateString()}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/features/agents/AgentList.tsx
git commit -m "feat(web): add AgentList with health indicators and cloud icons"
```

---

### Task 11: Update NewDeploymentWizard references

**Files:**
- Modify: `web/src/features/wizard/NewDeploymentWizard.tsx`

- [ ] **Step 1: Update wizard copy to use "Agent" terminology**

In `web/src/features/wizard/NewDeploymentWizard.tsx`, update the user-facing strings. The component name stays the same (it's internal), but all visible text changes from "deployment" to "agent":

Replace these strings in the file:
- `"New deployment"` → `"New Agent"`
- `"deployment name"` → `"agent name"`
- `"Go to deployment"` → `"Go to agent"`
- `"Project directory"` → `"Project directory"` (unchanged)
- Any heading or label containing "deployment" → "agent"

The `onCreated` callback interface stays the same.

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/features/wizard/NewDeploymentWizard.tsx
git commit -m "refactor(web): rename deployment references to agent in wizard"
```

---

### Task 12: Wire App.tsx with new routing and navigation

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Rewrite App.tsx**

Replace the entire contents of `web/src/App.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './lib/api';
import { AppShell } from './components/layout/AppShell';
import { AgentList } from './features/agents/AgentList';
import { AgentWorkspace } from './features/agent/AgentWorkspace';
import { NewDeploymentWizard } from './features/wizard/NewDeploymentWizard';
import { JobFullScreen } from './features/jobs/JobFullScreen';
import type { Route, Navigate } from './lib/types';
import type { DeploymentSummaryDto } from '@hermes/dto';

export default function App() {
  const [route, setRoute] = useState<Route>({ page: 'dashboard' });

  const navigate: Navigate = (r) => setRoute(r);

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => apiFetch<DeploymentSummaryDto[]>('/api/deployments'),
    refetchInterval: 15_000,
  });

  function renderPage() {
    switch (route.page) {
      case 'dashboard':
        // Phase 1: dashboard redirects to agents list
        // Will be replaced by OrgDashboard in Plan 3
        return <AgentList agents={agents} navigate={navigate} />;

      case 'agents':
        return <AgentList agents={agents} navigate={navigate} />;

      case 'agent':
        return (
          <AgentWorkspace
            name={route.name}
            tab={route.tab}
            navigate={navigate}
          />
        );

      case 'new':
        return (
          <NewDeploymentWizard
            onCreated={(name) => navigate({ page: 'agent', name, tab: 'infra' })}
            onBack={() => navigate({ page: 'agents' })}
          />
        );

      case 'job':
        return (
          <JobFullScreen
            jobId={route.jobId}
            onBack={() => navigate({ page: 'agents' })}
          />
        );

      default:
        return <AgentList agents={agents} navigate={navigate} />;
    }
  }

  return (
    <AppShell route={route} navigate={navigate} agents={agents}>
      {renderPage()}
    </AppShell>
  );
}
```

- [ ] **Step 2: Run full type check**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit`
Expected: PASS — all types should resolve. If there are errors related to prop mismatches on existing components (e.g. `NewDeploymentWizard` or `JobFullScreen`), fix the prop names to match their current signatures.

- [ ] **Step 3: Run the build**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx vite build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(web): wire new agent-centric routing and navigation"
```

---

### Task 13: Browser verification and cleanup

**Files:**
- Possibly modify: any file with remaining issues

- [ ] **Step 1: Start the dev server**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx vite dev`

Open `http://localhost:5173` (or whatever port Vite picks) in a browser.

- [ ] **Step 2: Verify navigation**

Test each navigation path:
1. App loads → should show sidebar + agent list (dashboard route)
2. Sidebar "Agents" link → agent list page
3. Click an agent card → agent workspace with Overview tab (placeholder)
4. Click through all 11 tabs — 6 placeholders + 5 working (Infra, Config, Logs, SSH, Secrets)
5. Sidebar agent shortcuts → clicking an agent name navigates to its workspace
6. "New Agent" button → wizard page
7. Back navigation works from wizard
8. Infra tab shows deployment info + actions correctly

- [ ] **Step 3: Fix any visual issues found during browser testing**

Common things to check:
- Sidebar height fills viewport
- Tab bar scrolls if window is narrow
- Content area scrolls independently
- Active tab/sidebar highlights are correct
- Dark theme colors are consistent

- [ ] **Step 4: Remove unused old files**

Delete the files that have been superseded:
- `web/src/features/detail/DeploymentDetail.tsx` — replaced by AgentWorkspace
- `web/src/features/detail/OverviewTab.tsx` — merged into InfraTab
- `web/src/features/detail/ActionsTab.tsx` — merged into InfraTab
- `web/src/features/deployments/DeploymentList.tsx` — replaced by AgentList
- `web/src/features/deployments/useDeployments.ts` — query moved into App.tsx

```bash
rm web/src/features/detail/DeploymentDetail.tsx
rm web/src/features/detail/OverviewTab.tsx
rm web/src/features/detail/ActionsTab.tsx
rm web/src/features/deployments/DeploymentList.tsx
rm web/src/features/deployments/useDeployments.ts
```

- [ ] **Step 5: Verify build still passes after cleanup**

Run: `cd /Users/paulcailly/hermes-deploy/web && npx tsc --noEmit && npx vite build`
Expected: Both pass with no errors.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "refactor(web): remove superseded deployment components after migration"
```

---

## Summary

After completing all 13 tasks, the web dashboard will have:

- **Sidebar navigation** with Dashboard, Agents, Skills Library (placeholder), Settings (placeholder), and agent shortcuts with live health indicators
- **Agent workspace** with 11-tab navigation bar (6 placeholders + 5 working)
- **InfraTab** merging the old Overview and Actions into one tab
- **AgentList** page with health badges, cloud icons, and status pulses
- **Shared components** ready for Plan 2: StatusPulse, StatCard, PlatformIcon, ModelIcon, CloudIcon
- **Agent-centric terminology** throughout ("Agents" not "Deployments")
- All existing functionality (Config, Logs, SSH, Secrets, Jobs) preserved and working

**Next:** Plan 2 will implement the 6 placeholder tabs (Overview, Sessions, Analytics, Skills, Cron, Gateway) with mock data services.
