# Agent Runtime Resilience

## Goal

Transform the agent runtime from a direct-call, fail-fast architecture into a resilient system that handles API rate limits, load bursts, and LLM failures gracefully. Ensure user-facing queries always receive a response, even under quota pressure or service degradation.

## User stories

- As a user sending a WhatsApp query, I want to receive an answer even when the system is under load, so that I never see "לא התקבלה תשובה מהסוכן" without explanation.
- As a user, I want my live queries prioritized over background cron jobs, so that my interaction is not starved by batch processing.
- As an admin, I want visibility into agent run health (queue depth, breaker state, degraded-response rate), so that I can diagnose quota issues before users complain.
- As a developer, I want all Gemini API calls routed through a single gateway, so that rate limiting and backoff are enforced uniformly.
- As a user asking about a WhatsApp group when the LLM is unavailable, I want to see raw message statistics and recent messages, so that I get useful information even in degraded mode.
- As a system, I want to cache expensive computations (group insights, Notion context, calendar context), so that repeated queries within a short window do not burn quota.
- As a user, I want WhatsApp replies to be delivered asynchronously when under load, so that webhook timeouts do not cause message loss.

## Acceptance criteria

### Rate limiting and prioritization
- **Given** Gemini API calls exceed the configured `GEMINI_MAX_RPM`, **when** a new request arrives, **then** it waits in a priority queue (interactive > event > batch) rather than failing with 429.
- **Given** the circuit breaker is open due to repeated rate-limit failures, **when** a `batch` priority request arrives, **then** it is deferred (via `nextRunAt` for jobs, or skipped for cron) without consuming quota.
- **Given** an `interactive` request when the breaker is open, **when** the tier fallback (flash-lite) also fails, **then** a degraded answer from the DB is returned with a `⚠️ מצב מופחת` prefix.

### Call reduction
- **Given** a user asks "על מה מדברים בקבוצה של autotech", **when** the agent runs, **then** the `query_whatsapp_group` tool returns raw structured data (message count, sender stats, time window, sample messages) and the orchestrating model writes the prose, consuming **one** LLM call instead of three.
- **Given** two Gemini-backed tools are called in one agent run, **when** a third Gemini-backed tool is requested, **then** it returns `{ error: 'quota_budget' }` to prevent quota burn.

### Caching
- **Given** a WhatsApp group insight was generated 8 minutes ago, **when** the same group/window/mode is queried again, **then** the cached insight is returned without calling the LLM.
- **Given** the circuit breaker is open, **when** a cache entry exists but is stale (beyond TTL), **then** the stale entry is served with an age annotation rather than failing.

### Never-empty guarantee
- **Given** all LLM call attempts fail (rate limit, network, breaker open), **when** the query is about a WhatsApp group with stored messages, **then** a degraded response is constructed from DB data (message count, top senders, recent messages) and returned with `status='degraded'` logged.
- **Given** the DB has no relevant data and all LLM paths failed, **when** the user receives a fallback, **then** it includes a machine-readable reason code (e.g., `MALFORMED_FUNCTION_CALL`, `RATE_LIMIT_EXCEEDED`) and actionable guidance, never the generic `לא התקבלה תשובה מהסוכן.`.

### Async delivery (WhatsApp)
- **Given** `WHATSAPP_ASYNC_REPLY=1` is set, **when** a WhatsApp inbound message arrives at the webhook, **then** the webhook returns 200 immediately, writes an `agent_jobs` row (idempotent on `messageId`), and a worker processes it out-of-band.
- **Given** an agent job fails due to rate limit, **when** the worker retries with exponential backoff, **then** the reply is eventually delivered via `/send` to the bridge, and the user receives the answer minutes later rather than seeing a timeout error.

### Observability
- **Given** an agent run completes, **when** logging, **then** an `agent_run_logs` row is written with `runId`, `status` (ok/degraded/rate_limited/error), `finishReason`, `queueWaitMs`, `geminiCalls`, `modelTier`, and `cacheHit`.
- **Given** an admin opens `/agents/manage`, **when** they view runtime health, **then** they see current breaker state, queue length, daily budget remaining, and degraded-response percentage.

### Load shaping for cron
- **Given** a scheduled agent (e.g., morning briefing) is due to run, **when** the circuit breaker is open or daily budget is exhausted, **then** the cron defers the run to the next 15-minute window and logs the skip reason.

## Data model

All three tables must be added to **both** `packages/database/src/schema.pg.ts` (Postgres, source of truth) **and** `packages/database/src/schema.ts` (SQLite mirror). Bootstrap SQL for SQLite in `packages/database/src/index.ts`. Export table definitions and inferred types from `packages/database/src/index.ts`.

### Table: `agent_run_logs`

```typescript
{
  id: string (uuid, primary key)
  runId: string (indexed)
  agentId: string
  channel: 'web' | 'whatsapp' | 'telegram' | 'cron'
  priority: 'interactive' | 'event' | 'batch'
  status: 'ok' | 'degraded' | 'empty' | 'rate_limited' | 'error'
  finishReason: string | null  // Gemini finishReason
  blockReason: string | null   // Gemini blockReason
  toolsCalled: JSON            // array of tool names
  geminiCalls: number          // count of LLM calls in this run
  queueWaitMs: number          // milliseconds spent waiting in gateway queue
  attempts: number             // retry count
  modelTier: string            // e.g., 'flash-thinking', 'flash', 'flash-lite'
  cacheHit: boolean
  durationMs: number
  replyChars: number
  errorMessage: string | null
  createdAt: timestamp (default now)
}
```

Migration: Additive. No breaking changes to existing tables.

### Table: `agent_jobs`

```typescript
{
  id: string (uuid, primary key)
  dedupeKey: string (unique index) // messageId for WhatsApp
  channel: 'whatsapp' | 'telegram'
  agentId: string
  payload: JSON                    // { message, from, chatJid, messageId, ... }
  status: 'pending' | 'running' | 'done' | 'failed'
  attempts: number (default 0)
  nextRunAt: timestamp | null
  lastError: string | null
  createdAt: timestamp (default now)
  completedAt: timestamp | null
}
```

Migration: Additive. Unique constraint on `dedupeKey` ensures idempotency.

### Table: `agent_cache`

```typescript
{
  key: string (primary key)       // e.g., 'group_insight:972544...@g.us:24h:summary'
  value: JSON
  expiresAt: timestamp
  createdAt: timestamp (default now)
}
```

Migration: Additive. No foreign keys. Periodically cleaned by a background task (outside scope of this spec).

## tRPC API

Router: `packages/api/src/routers/agents.ts` (existing file, extend it)

### Procedure: `agents.runLogs.list`

- **Kind**: `query`
- **Auth**: `protectedProcedure`
- **Input**:
  ```typescript
  {
    limit?: number      // default 50, max 200
    status?: 'ok' | 'degraded' | 'empty' | 'rate_limited' | 'error'
    agentId?: string
    channel?: 'web' | 'whatsapp' | 'telegram' | 'cron'
  }
  ```
- **Output**:
  ```typescript
  {
    logs: Array<{
      id: string
      runId: string
      agentId: string
      channel: string
      priority: string
      status: string
      finishReason: string | null
      geminiCalls: number
      queueWaitMs: number
      modelTier: string
      cacheHit: boolean
      durationMs: number
      createdAt: string // ISO timestamp
    }>
  }
  ```

### Procedure: `agents.runtimeHealth`

- **Kind**: `query`
- **Auth**: `protectedProcedure`
- **Input**: none
- **Output**:
  ```typescript
  {
    breakerState: 'closed' | 'open' | 'half_open'
    queueLength: number
    dailyBudgetRemaining: number
    degradedResponseRate: number  // percentage, last 100 runs
    cacheHitRate: number          // percentage, last 100 runs
  }
  ```

Implementation note: These stats come from the in-process gateway singleton and recent `agent_run_logs` rows.

## UI surface

Route: `apps/web/src/app/agents/manage/page.tsx` (existing)

Add a collapsible `.card` section below the existing agent grid:

**Section title**: "תפעול זמן ריצה" (Runtime Operations)

**Contents**:
- **Status badge**: Breaker state (ירוק=closed, אדום=open, כתום=half_open)
- **Queue depth**: `queueLength` requests waiting
- **Budget**: `dailyBudgetRemaining` of `GEMINI_DAILY_BUDGET`
- **Degraded rate**: percentage with visual bar
- **Recent runs table** (last 20, collapsible):
  - Columns: `agentId`, `channel`, `status`, `modelTier`, `queueWaitMs`, `geminiCalls`, `createdAt`
  - Status column uses color coding (green=ok, yellow=degraded, red=error)
- **Refresh button** (re-fetches `runtimeHealth` and `runLogs`)

RTL layout, dark theme compatible, consistent with existing `.card` styles in the agents page. No new top-level route — embed in the existing manage page.

## Out of scope

- Redis or external queue systems (in-process queue is sufficient for single-process deployment).
- Automatic Gemini API key rotation or multi-account failover.
- Historical metrics beyond the last 100 runs (no time-series DB).
- Circuit breaker tuning UI (breaker thresholds are env-configured only).
- User-facing explanations of why a specific response was degraded (logged for admin, not surfaced to end user beyond the `⚠️` prefix).
- Gemini prompt caching (separate optimization).
- Retry of failed `agent_jobs` by external scheduler (in-process timer + cron endpoint is sufficient).

## Open questions

- Should the gateway track per-agent budgets, or is a global daily budget sufficient? (Answer: global for MVP; per-agent can be added later without schema changes.)
- When the async worker sends a reply via bridge `/send`, should it also create a push notification? (Answer: yes, mirroring the sync path.)
- How long should stale cache entries be served when the breaker is open? (Answer: up to 2x the original TTL, annotated with age.)

## WhatsApp call diet — one LLM, not two

WhatsApp group Q&A (`query_whatsapp_group`, `summarize_whatsapp_groups`, `whatsapp_now`) currently burn 2–3 Gemini calls per user question (outer Hugo + inner `insights.forGroup`). Under Free-tier quota, this causes most group asks to return empty.

**Call-diet implementation:**

Tools return **structured DB facts**, not nested Gemini prose:
- `groupName`, `window`, `messageCount`, sender stats (top N by message count)
- Time span (`sinceMs`, `untilMs`) 
- Sample/recent messages `[HH:MM] sender: text` (capped to ~20 most recent)
- Empty/unknown-group errors as data

Hugo (outer model) writes the Hebrew brief from raw data. One user question → **one Gemini call** (or zero when degraded).

Settings UI Insights tab keeps calling `insights.forGroup` (dedicated summarizer, one Gemini, no Hugo layer) so UI summaries still have LLM polish.

**Degraded WhatsApp brief (never-empty guarantee):**

When outer Gemini fails (429 / breaker / empty) and tool returned DB data with `messageCount > 0`:
1. Build deterministic Hebrew brief: "⚠️ מצב מופחת — [group] ([window], [count] הודעות)" 
2. Top 3 senders by volume: `[sender]: [count] הודעות`
3. Last 8–12 message lines verbatim
4. Log status `degraded`, never return generic empty for a group with stored messages

This guarantees a usable brief even when LLM quota is exhausted.

## Recovery matrix

| Failure scenario | Gateway response | User sees | Logged status |
|---|---|---|---|
| Rate limit 429, interactive, first attempt | Exponential backoff + retry, tier fallback | Full answer (may be slower/cheaper model) | `ok` or `rate_limited` if exhausted |
| Rate limit 429, batch, breaker open | Immediate defer to `nextRunAt` | (cron skipped, user unaware) | (no row, deferred) |
| MALFORMED_FUNCTION_CALL | Retry with `FunctionCallingMode.NONE` | Text answer without tools, or degraded if retry fails | `ok` or `degraded` |
| All LLM paths fail, DB has data | Construct answer from DB | Structured data with `⚠️ מצב מופחת` prefix | `degraded` |
| WhatsApp group Q&A, LLM fails, stored msgs exist | Deterministic brief from DB rows | `⚠️ מצב מופחת — [group] ([window], [count] הודעות)` + top senders + recent lines | `degraded` |
| All LLM paths fail, DB empty | Return reason-coded message | `לא הצלחתי לייצר תשובה (RATE_LIMIT_EXCEEDED). נסה שוב בעוד דקה.` | `error` |
| Cache hit within TTL | Serve from cache | Full answer, no LLM call | `ok`, `cacheHit=true` |
| Cache stale, breaker open | Serve stale with age | `(נתונים מלפני 12 דקות) ...` | `degraded`, `cacheHit=true` |
| Empty response, no tools called | Nudge retry | Full answer after retry, or fallback | `ok` or `empty` |
| Async job, rate limit on first attempt | Write `nextRunAt`, worker retries later | (eventual delivery, no immediate error) | (job row `status='pending'`) |
