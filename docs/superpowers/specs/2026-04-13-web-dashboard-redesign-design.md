# Web Dashboard Redesign: Agent-Centric Control Plane

**Date:** 2026-04-13
**Phase:** 1 — Single-agent observability (Scarf-inspired)
**Status:** Design approved

## Context

hermes-deploy's web dashboard currently focuses on infrastructure deployment management (provision, update, destroy, config, logs, SSH, secrets). The goal is to redesign it into an agent-centric control plane that treats infrastructure as one aspect of managing an agent, not the entire product.

This is Phase 1 of a three-phase roadmap:
1. **Phase 1 (this spec):** Single-agent observability — dashboard stats, sessions, cost tracking, skills library, cron/scheduling, gateway status per agent
2. **Phase 2:** Multi-agent fleet view — aggregate stats, global session feed, cross-agent overview
3. **Phase 3:** Orchestration primitives — agent groups, inter-agent communication, shared knowledge bases, hierarchy/roles

### Inspiration

The Scarf macOS app (SwiftUI, MVVM-Feature architecture) provides a rich native GUI for Hermes with dashboard stats, session browsing, analytics, skills management, cron job management, and gateway controls. This redesign brings equivalent capabilities to the web, plus infrastructure management that Scarf does not have.

## Architecture Decisions

### Approach: Agent-Centric (Option C)

Each agent is the central entity. Infrastructure is one tab in an agent's workspace, not a separate domain. This aligns with the long-term orchestration vision where agents are first-class organizational units.

### Data Access: API Layer

Each deployed Hermes agent exposes a REST API for stats, sessions, messages, tool calls, and configuration. The dashboard calls these APIs rather than querying SQLite directly over SSH or replicating data centrally.

### Real-Time: Full WebSocket Streaming

All agent telemetry streams live via WebSocket — session updates, token counters, cost accrual, active session messages. Extends the existing WS infrastructure (logs, SSH, jobs).

### Cost Tracking: Token-Based Estimation

Cost calculated from token counts against a model pricing table. No billing provider integration for Phase 1. Fields: `estimatedCostUSD` per session, aggregated at agent and org level.

### UI Direction: Complete Redesign

New navigation structure, new pages, existing infra features migrated into the agent workspace. Same tech stack (React 19, Vite, Tailwind CSS 4, Zustand, React Query, xterm.js, Monaco).

### Icons

No emojis anywhere. Use:
- **Brand SVGs** for company logos (Anthropic, OpenAI, AWS, GCP, Telegram, Slack, Discord, WhatsApp)
- **FontAwesome Pro** for all UI icons (user has premium license)
- **Animated SVG circles** for live/online status indicators (radiating pulse effect)

## App Structure & Navigation

### Two-Level Navigation

**Primary sidebar** (always visible):

| Section | Description |
|---------|-------------|
| Dashboard | Org-level aggregate stats across all agents |
| Agents | Grid/list of all agents |
| Skills Library | Shared skills across the org |
| Settings | App and org configuration |
| Agent shortcuts | Quick-access list with live health dots |

The sidebar also shows a "New Agent" button at the bottom of the agent shortcuts.

**Agent workspace** (when an agent is selected):

Header bar displays: agent name, health status (animated SVG pulse), cloud/region badge, model badge.

Tab bar with 11 tabs in two groups:

| Group | Tabs |
|-------|------|
| Agent Operations | Overview, Sessions, Analytics, Skills, Cron, Gateway |
| Infrastructure | Infra, Config, Logs, SSH, Secrets |

A subtle visual separator (border) divides the two groups in the tab bar.

### Conceptual Shift

"Deployments" become "Agents." The current `DeploymentList` becomes the agent list. All existing infrastructure features (provision, update, destroy, cloud state, health checks) move under the "Infra" tab within each agent's workspace. The `NewDeploymentWizard` becomes "New Agent."

### Routing

Extend the current state-based routing:

```
{ page: 'dashboard' }                           // Org dashboard
{ page: 'agents' }                               // Agent list/grid
{ page: 'agent', name: string, tab: AgentTab }   // Agent workspace
{ page: 'new' }                                  // New agent wizard
{ page: 'job', jobId: string }                   // Job full screen (unchanged)
```

`AgentTab = 'overview' | 'sessions' | 'analytics' | 'skills' | 'cron' | 'gateway' | 'infra' | 'config' | 'logs' | 'ssh' | 'secrets'`

## Page Designs

### 1. Org Dashboard (Landing Page)

The first page users see. Aggregates data across all agents.

**Top stats row** — 5 metric cards:
- Agents (total + online count)
- Total Sessions (with weekly delta)
- Total Tokens (with in/out split)
- Active Now (live session count)
- Total Est. Cost (with weekly delta)

**Agent Fleet** (left, wider column) — Each agent as a row showing: health pulse, name, cloud/region with provider icon, session count, cost, connected platform icons. Click navigates to agent workspace. Offline agents dimmed at 50% opacity.

**Cost Per Agent** (right column) — Horizontal bar chart comparing spend. Below: cost split by model in compact cards.

**Live Activity** (bottom-left) — Global session feed across all agents. Each entry tagged with agent name badge. Active sessions show animated pulse, completed sessions muted. Updated via WebSocket.

**Upcoming Cron Jobs** (bottom-right) — Next scheduled jobs across all agents with agent name and run time. Below: Fleet Health widget (healthy count / offline count).

### 2. Agent Overview Tab

Landing page when clicking into an agent. Four zones:

**Status row** — 4 cards:
- Agent Status: animated SVG pulse when running, static gray when stopped
- Model: Anthropic/OpenAI SVG logo + model name
- Gateway: `fa-tower-broadcast` + connected platform count
- Infrastructure: `fa-brands fa-aws` or `fa-brands fa-google` + region

**Stats grid** — 5 metric cards: Sessions, Messages, Tool Calls, Total Tokens (in/out split), Est. Cost. Each shows "today" delta. Live-updated via WebSocket.

**Recent Sessions** (bottom-left) — Last 4-5 sessions. Each row: status indicator (pulse for active, `fa-circle-check` for completed, `fa-circle-xmark` for failed), title, platform icon + name, message count, time ago, cost. "View all" links to Sessions tab.

**Activity & Platforms** (bottom-right):
- 7-day activity bar chart (gradient fill bars, day labels)
- Platform source breakdown with brand icons and percentage bars

### 3. Sessions Tab

Master-detail split panel layout.

**Left panel — Session List:**
- Search bar with `fa-magnifying-glass` (full-text search via SQLite FTS5 on remote agent)
- Platform filter pills: All, Telegram, Slack, CLI, Cron (with brand icons)
- Session rows: status indicator, title (truncated), time ago, platform icon, message count (`fa-message`), tool call count (`fa-wrench`), token count (`fa-microchip`), cost
- Active sessions: animated SVG pulse, green-tinted background
- Failed sessions: `fa-circle-xmark` in red
- Footer: total session count + database size

**Right panel — Message Detail:**
- Session header: title, active badge, platform, started time, message/tool/token/cost stats
- Chat-style message thread:
  - **User messages**: blue avatar (`fa-user`), blue bubble, left-aligned
  - **Assistant messages**: indigo avatar (`fa-robot`), dark bubble with optional collapsible reasoning block (`fa-brain` icon, purple tint, `fa-chevron-down` toggle)
  - **Tool calls**: green avatar (`fa-wrench`), green-tinted card showing function name, command summary, truncated output in monospace block
  - **Subagent spawns**: amber avatar (`fa-diagram-project`), clickable card showing subagent session name, message/tool counts, status. Click navigates to child session.
- Active sessions: messages stream in real-time via WebSocket

### 4. Analytics Tab

Deep insights with time period filtering.

**Time period selector** — Toggle: 7d / 30d / 90d / All (top-right)

**Top stats row** — 6 compact cards: Sessions, Messages, Tool Calls, Tokens, Active Time, Est. Cost

**Cost Over Time** (left, wider) — Area chart with gradient fill showing daily cost trend. SVG-based with data points at key intervals. Y-axis labels, X-axis date labels.

**Token Breakdown** (right) — Donut chart (SVG) splitting 5 token types: Input, Output, Cache Read, Cache Write, Reasoning. Center shows total. Legend with color dots and values.

**Top Tools** (bottom-left) — Ranked list of 5 most-used tools. Each: tool kind icon (color-coded), name, count + percentage, horizontal bar. Below: compact hourly activity heat strip (24 cells, single row, intensity mapped to session count per hour, with Less/More legend).

**Model Usage** (bottom-right) — Cards per model with Anthropic/OpenAI SVG logo, session count, token count, cost. Below: Platform Breakdown with brand icons and percentage bars. Below: Notable Sessions (longest, most messages, most expensive).

### 5. Skills Tab

Master-detail layout mirroring Sessions.

**Left panel — Category Tree:**
- Search/filter input
- Collapsible category groups (`fa-chevron-down`/`fa-chevron-right`) with skill count
- Skills listed under each category, highlight on selection
- Footer: total skill count + category count

**Right panel — Skill Detail:**
- Header: category/name, file count, required config keys (with warning styling if missing)
- File tab bar: skill.yaml, prompt.md, handler.py, etc.
- Syntax-highlighted file viewer (Monaco editor, read-only by default)
- Edit button for markdown files (inline editing)

### 6. Cron Tab

Vertical card layout.

**Header:** "Scheduled Jobs" with job count + enabled count.

**Job cards** — each shows:
- Status indicator: animated pulse (running), `fa-regular fa-clock` (scheduled), `fa-circle-pause` (disabled, 50% opacity), `fa-circle-xmark` (failed, red)
- Job name + status badge
- Prompt text in monospace block with quote icon
- Metadata row: schedule (human-readable), model, delivery method, last run time, next run time
- Click to expand: last output in scrollable monospace viewer

### 7. Gateway Tab

**Gateway status bar** — `fa-tower-broadcast` icon, gateway name, PID + uptime, animated running pulse, Restart/Stop buttons.

**Connected Platforms** — 3-column grid of platform cards:
- Brand icon (large, `fa-brands` for Telegram/Slack/Discord/WhatsApp, `fa-solid` for Email/Webhook)
- Platform name + health pulse
- Session count + traffic percentage
- Unconfigured platforms: dimmed at 50% opacity, "Not configured" label

### 8. Existing Tabs (Migrated)

These tabs move into the agent workspace unchanged in functionality:

| Tab | Current Component | Notes |
|-----|------------------|-------|
| Infra | `OverviewTab` + `ActionsTab` | Merged into single Infra tab with sub-sections for status and actions |
| Config | `ConfigTab` | Unchanged — Monaco editor for hermes.toml, config.yaml, SOUL.md |
| Logs | `LogsTab` | Unchanged — live journalctl stream via WebSocket |
| SSH | `SshTab` | Unchanged — xterm.js PTY terminal via WebSocket |
| Secrets | `SecretsTab` | Unchanged — SOPS secret management |

## Data Flow

### Agent API (new)

Each deployed Hermes instance exposes REST endpoints consumed by the dashboard:

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/api/stats` | GET | Aggregate stats (sessions, messages, tools, tokens, cost) |
| `/api/sessions` | GET | Session list with pagination, search, platform filter |
| `/api/sessions/:id` | GET | Single session with messages |
| `/api/sessions/:id/messages` | GET | Message list for a session |
| `/api/skills` | GET | Skill categories and skills |
| `/api/skills/:category/:name` | GET | Skill detail with file contents |
| `/api/cron/jobs` | GET | Cron job list |
| `/api/cron/jobs/:id/output` | GET | Last output for a cron job |
| `/api/gateway/state` | GET | Gateway status + platform states |
| `/api/gateway/:action` | POST | Start/stop/restart gateway |
| `/api/config` | GET | Agent config (model, provider, settings) |

### WebSocket Streams (new)

| Endpoint | Events |
|----------|--------|
| `/ws/stats` | Real-time stat updates (session count, token count, cost deltas) |
| `/ws/sessions` | New session created, session ended, session updated |
| `/ws/sessions/:id` | Live message stream for active session |

### Dashboard Server Changes

The hermes-deploy server acts as a proxy/aggregator:
- Proxies API calls to individual agent APIs (via SSH tunnel or direct network access)
- Aggregates stats from all agents for the Org Dashboard
- Maintains WebSocket connections to each agent and fans out to browser clients

## Tech Stack

No changes to the core stack:
- **React 19** + TypeScript
- **Vite** (dev + build)
- **Tailwind CSS 4** (utility-first styling)
- **Zustand** (client state — navigation, selected agent)
- **React Query** (server state — API calls with refetch)
- **xterm.js** (SSH terminal)
- **Monaco Editor** (config + skill editing)
- **FontAwesome Pro** (all UI icons)
- **Inline SVGs** (brand logos, status indicators)

### New Dependencies

- A charting library may be needed for Analytics (recharts, visx, or hand-rolled SVG)
- Consider evaluating this during implementation — hand-rolled SVG may suffice for the chart types needed (area, donut, bar)

## Component Architecture

```
App.tsx (router)
├── AppShell.tsx (sidebar + header)
│   ├── Sidebar.tsx (primary nav + agent shortcuts)
│   └── ContentArea
│       ├── OrgDashboard.tsx
│       ├── AgentList.tsx
│       ├── AgentWorkspace.tsx
│       │   ├── AgentHeader.tsx
│       │   ├── AgentTabBar.tsx
│       │   └── Tab content:
│       │       ├── OverviewTab.tsx (new)
│       │       ├── SessionsTab.tsx (new)
│       │       │   ├── SessionList.tsx
│       │       │   └── MessageDetail.tsx
│       │       ├── AnalyticsTab.tsx (new)
│       │       ├── SkillsTab.tsx (new)
│       │       ├── CronTab.tsx (new)
│       │       ├── GatewayTab.tsx (new)
│       │       ├── InfraTab.tsx (migrated from OverviewTab + ActionsTab)
│       │       ├── ConfigTab.tsx (migrated)
│       │       ├── LogsTab.tsx (migrated)
│       │       ├── SshTab.tsx (migrated)
│       │       └── SecretsTab.tsx (migrated)
│       ├── NewAgentWizard.tsx (renamed)
│       └── JobFullScreen.tsx (unchanged)
└── Shared components:
    ├── StatCard.tsx
    ├── StatusPulse.tsx (animated SVG)
    ├── PlatformIcon.tsx (brand SVG mapper)
    ├── ModelIcon.tsx (Anthropic/OpenAI SVG)
    ├── CloudIcon.tsx (AWS/GCP icon mapper)
    └── SessionRow.tsx
```

## Scope Boundaries

### In scope (Phase 1)
- Complete navigation redesign (sidebar + agent workspace tabs)
- Org Dashboard landing page
- Agent Overview tab
- Sessions tab (list + message detail)
- Analytics tab (stats, charts, breakdowns)
- Skills tab (browse + view)
- Cron tab (view jobs + output)
- Gateway tab (status + platform cards)
- Migration of existing Infra/Config/Logs/SSH/Secrets into agent workspace
- Agent API design (endpoint specification)
- WebSocket streaming for live data
- Token-based cost estimation

### Out of scope (Phase 1)
- Agent API implementation on Hermes side (separate work)
- Multi-agent communication / orchestration
- Team/hierarchy management
- Actual billing provider integration
- Skill editing beyond markdown files
- Cron job creation/editing via UI
- Gateway platform configuration via UI
- User authentication / RBAC
- Dark/light mode toggle
