# Real Agent Data Implementation Plan

**Goal:** Replace mock data in the web dashboard with real data queried from each deployed Hermes agent's SQLite database (`~/.hermes/state.db`) and config files, accessed over the existing SSH infrastructure.

**Architecture:**
- **Server-side proxy:** New `agent-data-source.ts` module maintains a short-TTL SSH session cache and exposes typed helpers for `sqlite3 -json` queries and file reads over SSH.
- **Agent data routes:** 6 new REST endpoints under `/api/agents/:name/*` return JSON matching the existing frontend types (`AgentSession`, `AgentStats`, etc.).
- **Frontend integration:** Replace `getMockX()` imports with React Query hooks that call the new endpoints.
- **Graceful degradation:** When the Hermes DB/file is missing on the agent, endpoints return empty arrays/zeros (UI shows empty states, not errors).

**Why SSH+SQLite instead of a Hermes-side API:**
The Hermes CLI does not expose an HTTP API for session data. We already have SSH access to every deployed agent, and the Hermes DB schema is stable enough (learned from the Scarf analysis) that `sqlite3 -json` queries give us typed JSON directly. When Hermes eventually adds a native API, swapping the data source is a single-file change in `agent-data-source.ts`.

---

## Server-Side

### `src/server/agent-data-source.ts`
- `getAgentSshSession(name)` — returns cached `SshSession` for an agent, creates one if missing or expired (30s TTL). Disposes on eviction.
- `runSqliteJson<T>(name, sql)` — executes `sqlite3 -json ~/.hermes/state.db <sql>`, parses JSON, returns `T[]` or `[]` on any error.
- `readRemoteFile(name, path)` — cats a file, returns contents or `null`.
- `readRemoteJson<T>(name, path)` — reads + parses JSON, returns `T` or `null`.
- `listRemoteDir(name, path)` — `ls -1` a directory, returns entries or `[]`.

### `src/server/routes/agent-data.ts`
Routes registered under `/api/agents/:name/*`:
- `GET /stats` → aggregates from `sessions` table (sums, today deltas)
- `GET /sessions?limit=50&platform=telegram` → `SELECT ... FROM sessions ORDER BY started_at DESC`
- `GET /sessions/:sid/messages` → `SELECT ... FROM messages WHERE session_id = ?`
- `GET /skills` → enumerate `~/.hermes/skills/<category>/<skill>/` directories + parse skill.yaml
- `GET /cron` → parse `~/.hermes/cron/jobs.json`
- `GET /gateway` → parse `~/.hermes/gateway_state.json`

All routes:
- Return 404 if agent not in state store
- Return 200 with empty data on SSH failure (with `{ degraded: true, error: string }` in body for debugging)
- Share the auth hook via `app.authHook`

### Register in `src/server/index.ts`
Add one-line registration of `agentDataRoutes` after existing routes.

---

## Frontend

### `web/src/lib/agent-api.ts`
React Query hooks with 15s refetch:
- `useAgentStats(name)`
- `useAgentSessions(name, { platform?, limit? })`
- `useAgentMessages(name, sessionId)`
- `useAgentSkills(name)`
- `useAgentCron(name)`
- `useAgentGateway(name)`

All hooks return `{ data, isLoading, error }`. On error or empty data, the tab components show an empty state.

### Tab rewrites
Each tab that used `getMockX()` now consumes the hook. Loading states show a spinner. Empty states show "No sessions yet" / "No skills installed" / etc. No mock fallback — if it's empty, it's empty.

### Keep `mock-data.ts` but only for tests
Mock data stays for the existing component tests and for the unused tabs where backend isn't wired (Org Dashboard live activity still uses mocks since it spans agents — that's Plan 5).

---

## Out of Scope
- WebSocket streaming for live session updates (Plan 5)
- Org-level live activity aggregation across agents (Plan 5)
- Cron job create/edit, skill editing, gateway platform config (read-only for now)
- Schema migration resilience beyond "query fails → empty result"
