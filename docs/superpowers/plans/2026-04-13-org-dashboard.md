# Org Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the global Org Dashboard landing page that aggregates data across all agents, showing fleet overview, cost breakdown, live activity feed, and upcoming cron jobs.

**Architecture:** The OrgDashboard component aggregates mock agent data across all deployments. It reuses shared components (StatCard, StatusPulse, PlatformIcon, CloudIcon) and the mock data service from Plan 2. When real agent APIs ship, the aggregation moves server-side.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, FontAwesome, React Query

---

## File Map

**New files:**
- `web/src/features/dashboard/OrgDashboard.tsx` — Main dashboard page

**Modified files:**
- `web/src/App.tsx` — Replace AgentList fallback with OrgDashboard on dashboard route
- `web/src/lib/mock-data.ts` — Add org-level mock aggregates

---

### Task 1: Add org-level mock data

**Files:**
- Modify: `web/src/lib/mock-data.ts`

- [ ] **Step 1: Add org aggregate functions**

Add functions that aggregate mock stats across agents: `getMockOrgStats()` returning total agents, total sessions, total tokens, active session count, total cost. Add `getMockLiveActivity()` returning recent sessions tagged with agent name. Add `getMockUpcomingCrons()` returning next scheduled jobs across agents.

- [ ] **Step 2: Verify it compiles**
- [ ] **Step 3: Commit** — `feat(web): add org-level mock data aggregates`

---

### Task 2: Create OrgDashboard

**Files:**
- Create: `web/src/features/dashboard/OrgDashboard.tsx`

- [ ] **Step 1: Implement OrgDashboard**

As per design spec, the dashboard has 4 zones:

**Top stats row** — 5 StatCards: Agents (total + online count), Total Sessions (weekly delta), Total Tokens (in/out split), Active Now, Total Est. Cost (weekly delta).

**Agent Fleet** (left, wider) — Agent rows with StatusPulse, name, CloudIcon + region, session count, cost, platform icons. Click navigates to agent workspace. Offline agents dimmed.

**Cost Per Agent** (right) — Horizontal bar chart comparing spend per agent. Below: cost by model cards.

**Live Activity** (bottom-left) — Global session feed tagged with agent name badges. Active sessions pulse, completed muted.

**Upcoming Cron Jobs** (bottom-right) — Next scheduled jobs with agent name + run time. Below: Fleet Health widget (healthy/offline counts).

Uses: `getMockOrgStats()`, `getMockLiveActivity()`, `getMockUpcomingCrons()`, and the real `agents` list passed as prop.

- [ ] **Step 2: Verify it compiles**
- [ ] **Step 3: Commit** — `feat(web): add OrgDashboard with fleet overview and cost breakdown`

---

### Task 3: Wire OrgDashboard into App.tsx

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Replace dashboard route**

Import OrgDashboard and render it for `{ page: 'dashboard' }` route instead of falling through to AgentList.

- [ ] **Step 2: Verify build passes**
- [ ] **Step 3: Browser test**: App opens to Org Dashboard, can navigate to agents, can click into agent workspace, can come back to dashboard via sidebar.
- [ ] **Step 4: Commit** — `feat(web): wire OrgDashboard as landing page`

---

### Task 4: Add test setup and component tests

**Files:**
- Modify: `web/package.json` — Add vitest, @testing-library/react, @testing-library/jest-dom, jsdom
- Create: `web/vitest.config.ts`
- Create: `web/src/test-setup.ts`
- Create: `web/src/components/shared/__tests__/StatusPulse.test.tsx`
- Create: `web/src/components/shared/__tests__/StatCard.test.tsx`
- Create: `web/src/components/shared/__tests__/PlatformIcon.test.tsx`
- Create: `web/src/features/agent/__tests__/AgentTabBar.test.tsx`
- Create: `web/src/features/dashboard/__tests__/OrgDashboard.test.tsx`

- [ ] **Step 1: Install test dependencies**

```bash
cd web && npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: Create vitest config**

```typescript
// web/vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@hermes/dto': path.resolve(__dirname, '../src/schema/dto.ts') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    globals: true,
  },
});
```

- [ ] **Step 3: Create test setup**

```typescript
// web/src/test-setup.ts
import '@testing-library/jest-dom';
```

- [ ] **Step 4: Write StatusPulse test**

Test: renders SVG, renders animation for 'online', no animation for 'offline', respects size prop.

- [ ] **Step 5: Write StatCard test**

Test: renders label, value, sub text, applies custom subColor.

- [ ] **Step 6: Write PlatformIcon test**

Test: renders correct FA class for known platforms, renders fallback for unknown.

- [ ] **Step 7: Write AgentTabBar test**

Test: renders all 11 tabs, highlights active tab, calls onSelect on click.

- [ ] **Step 8: Write OrgDashboard test**

Test: renders stat cards, renders agent fleet rows, renders with empty agents array.

- [ ] **Step 9: Run all tests**

```bash
cd web && npx vitest run
```
Expected: All tests pass.

- [ ] **Step 10: Add test script to package.json**

Add `"test": "vitest run"` and `"test:watch": "vitest"` to scripts.

- [ ] **Step 11: Commit** — `test(web): add vitest setup and component tests`

---

## Summary

After Plan 3, the app opens to a polished Org Dashboard showing fleet health, aggregate stats, cost breakdown, live activity, and upcoming cron jobs. Test infrastructure is in place with component tests for shared components and key pages.

**Full flow after all 3 plans:**
1. App opens → Org Dashboard (fleet overview)
2. Click agent → Agent Workspace with 11 working tabs
3. Sidebar navigation between all pages
4. All existing infra features preserved
5. Mock data everywhere agent API is needed
6. Component tests passing
