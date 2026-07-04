# Hugo — Multi-Account Notion Access (Meetings + Tasks)

> **Slug:** `hugo-notion-access`
> **Status:** Draft
> **Last Updated:** 2026-07-02

## Goal

When the user asks Hugo questions (especially "prepare me for the day"), Hugo replies that it has no access to Notion. Today Notion is only injected as a static, pre-fetched text block (tasks from 3 hardcoded databases + one "Calendar Review" page) on a **single** integration token, and there is **no Notion tool** Hugo can call on demand. This spec gives Hugo real, on-demand access to Notion across **two accounts**, scans **both meetings and tasks**, exposes Notion as callable tools (so both the WhatsApp/`runGeminiAgentChat` path and the web/`resolveIntent` path can reach it), routes the daily-prep flow through Notion, and adds a connection-status check so a missing database share is diagnosable instead of failing silently.

## User Stories

- As the user, I want Hugo to read my meetings and tasks from **both** my Notion accounts, so its recommendations reflect everything.
- As the user, when I ask "prepare me for the day", I want Hugo to scan Notion (meetings + tasks) before answering.
- As the user, I want Hugo to stop saying "I have no access to Notion" — it should query Notion live or clearly tell me which database isn't shared.
- As the user, I want to see in Settings whether each Notion account/database is reachable.

## Acceptance Criteria

- [ ] `NOTION_ACCOUNTS` env (JSON array of `{ label, token, databases: [{ id, name, type }] }`) configures N accounts with typed databases (`tasks` | `meetings` | `assistant`).
- [ ] Backward compatible: if `NOTION_ACCOUNTS` is absent but `NOTION_API_KEY` is set, a single legacy account is synthesized from the current 3 task DBs + assistant DB.
- [ ] `getNotionContext()` aggregates tasks **and** meetings across all configured accounts, and is fault-tolerant: one failing database/account does not blank the whole block; failures are reported per account/database.
- [ ] New agent tools available to both engines: `get_notion_tasks`, `get_notion_meetings`, `search_notion`, `notion_status`.
- [ ] Hugo prompt + `resolveIntent` prompt advertise Notion tools and route daily-prep through them; Hugo never claims "no access" when a tool exists.
- [ ] Hugo agent card + morning-brief workflow explicitly pull Notion meetings + tasks from both accounts.
- [ ] Settings shows a Notion connection-status card (per account + database) via a `/api/notion/status` route.
- [ ] Vitest covers config parsing (valid, invalid, legacy fallback) and the new tool dispatch/partial-failure behavior. Lint + build pass.

## Data Model

No database schema changes. Notion account/database configuration is env-based (matches the existing Google/WhatsApp secrets pattern; single-user app). No changes to `packages/database/src/schema.ts` or `schema.pg.ts`.

## tRPC API

No new tRPC procedures. The Notion client lives in `apps/web/src/lib/notion.ts` (not `packages/api`), so the status surface is a Next.js route handler `apps/web/src/app/api/notion/status/route.ts` (auth via `getApiSession`) rather than a tRPC procedure. Agent access is via Gemini function-calling tools, not tRPC.

## UI Surface

- `apps/web/src/app/settings/page.tsx`: new `NotionCard` (`Section` + `Row`) listing each configured account and database with a reachable/error badge, fetched from `/api/notion/status`. RTL Hebrew, design-system classes.

## Env / Config

- `apps/web/src/lib/notion-config.ts` (new): `getNotionAccounts()`, `isNotionConfigured()`, `getAssistantTarget()`; parses `NOTION_ACCOUNTS`, validates, falls back to legacy single account.
- Document `NOTION_ACCOUNTS` format in `apps/web/.env.local.example` and `deploy/production.env.example`.

## Tools (Gemini function-calling)

Added in `apps/web/src/lib/conversation-engine.ts` (`baseToolDeclarations` + `executeTool`):

- `get_notion_tasks({ filter?: 'overdue' | 'today' | 'soon' | 'all' })`
- `get_notion_meetings({ range?: 'today' | 'upcoming' })`
- `search_notion({ query })` — keyword match across configured task/meeting databases.
- `notion_status()` — per-account/per-database connectivity for diagnosing "no access".

These reach both `resolveIntent()` (web/Telegram) and `runGeminiAgentChat()` (WhatsApp/agents) because both share `getToolDeclarations()`/`executeTool()`.

## Prompt / Agent updates

- `apps/web/src/lib/gemini-agent-engine.ts`: Hugo block advertises Notion tools; daily-prep uses `get_notion_meetings` + `get_notion_tasks`.
- `apps/web/src/lib/conversation-engine.ts`: `resolveIntent` system prompt gains a Notion line.
- `A_Agents/01_Hugo_orchestrator.md`, `S_Skills/wf_morning_brief.md`: daily prep scans Notion meetings + tasks from both accounts.

## Out of Scope

- Writing to Notion beyond the existing Inbox notification (`notifyNotionInbox`) — recommendations only.
- A per-user credential UI or DB-backed credential store.
- Embeddings/semantic search over Notion content (keyword match only).

## Open Questions

- None blocking. Tokens + database IDs are supplied via `NOTION_ACCOUNTS` at deploy time; each database must be shared with its integration in Notion (surfaced by `notion_status`).
