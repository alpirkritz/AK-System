# AK System — Project Guide

A personal "second brain" workspace app for Alpir: dashboard, projects, meetings, people, tasks, recurring meetings, plus an AI-agent layer (Hugo) that runs morning briefings, meeting prep, calendar optimization, email triage, IBKR trade import, and WhatsApp summaries. Hebrew-first UI/copy, English code. Monorepo managed with pnpm workspaces + Turbo.

## Mandatory workflow for any code change

**Before writing code in `apps/` or `packages/`, always start with a spec.** This is a hard rule (`.cursor/rules/dev-pipeline.mdc`), not a suggestion — skip only for trivial one-line fixes with zero behavioral change, and say why.

Pipeline, in order, each with its own skill file under `.cursor/skills/<agent>/SKILL.md`:

1. **PM Agent** — write/update spec at `docs/specs/<slug>.md` (template: Goal, user stories, acceptance criteria, data model changes for both `schema.pg.ts` and `schema.ts`, tRPC API shape, UI surface, out of scope, open questions). Wait for approval before coding.
2. **UI Designer Agent** — required if `apps/web/` UI/styling changes. Checks RTL, dark theme, `.btn`/`.input`/`.card` design-system classes.
3. **Dev Agent** — implement per spec. Backend in `packages/api` + `packages/database`, frontend in `apps/web`. tRPC client only — never inline `fetch` to `/api/trpc`.
4. **Dev Tests Agent** — Vitest for new tRPC procedures, Playwright for new user-facing flows.
5. **QA Agent** — `pnpm test && pnpm e2e` from repo root; fix failures caused by the change.
6. **Reviewer Agent** — `pnpm -r run lint` + `pnpm --filter @ak-system/web build`; writes verdict to `reports/<slug>.md` (APPROVED / APPROVED WITH NITS / CHANGES REQUESTED).

Don't call a task done until: spec exists, UI review passed (if relevant), implementation matches spec, tests pass, lint/build pass, reviewer verdict is APPROVED(-ish). There's also a Cursor-based DAG runner (`tools/agent-pipelines/run.mjs`, pipelines: feature/bugfix/audit/smoke) that mechanizes this whole chain and logs live progress into `.canvas/<slug>.{dag.json,canvas.tsx,log}` — worth knowing about but not something to hand-run manually.

Separately, there's an **"ABC Agentic System"** governance layer (`.cursorrules`) for the six `A_Agents/B_Brain/C_Core/S_Skills/O_Output/M_Memory` folders described below — that ruleset applies to *that* system, not to ordinary `apps/`/`packages/` engineering.

## Repo layout

```
apps/
  web/            Next.js 14 app (the actual product UI + API + cron)
  mobile/         Expo/React Native app, branded "ARO" (bundle com.alpir.helm)
  whatsapp-bridge/  Standalone Baileys WhatsApp-Web bridge service
packages/
  api/            tRPC routers — the backend
  database/       Drizzle ORM schema + getDb()
  types/          Shared constants (priorities, statuses, VAT rules, Hebrew labels)
A_Agents/ B_Brain/ C_Core/ S_Skills/ O_Output/ M_Memory/   "ABC" agent-definition system (see below)
docs/specs/       ~50 feature specs (PM-agent output)
reports/          Reviewer/QA verdicts, one per spec slug
scripts/          Deploy, DB, OAuth, EC2/tunnel, and Python demo scripts
deploy/, docs/deploy/   Infra configs + guides (EC2, Railway-legacy, Docker, Cloudflare/ngrok tunnel)
.cursor/skills/   The agent SKILL.md files that define the dev pipeline above
```

## apps/web — the main product

Next.js 14 App Router, TypeScript, Tailwind, tRPC + React Query, NextAuth. Pages under `src/app/`: dashboard (`/`), `projects`, `meetings` (+ `[id]`), `people`, `tasks`, `recurring`, `calendar`, `chat`, `finance` (VAT + IBKR trading journal + bulk expense import), `reading-list`, `memory`, `notifications`, `agents/manage`, `settings` (+ notifications/notion-statuses/whatsapp/workspaces), `updates`, `login`. Feature code is colocated per route (`app/<feature>/components`, `app/<feature>/lib`) rather than in global dirs; `lib/*.ts` files pair with `lib/*.test.ts` siblings.

tRPC wiring: client in `src/lib/trpc.ts` (`httpBatchLink` + superjson), server in `src/app/api/trpc/[trpc]/route.ts` — resolves session via NextAuth or a bearer token (mobile app), with a dev-session fallback when `NODE_ENV=development` or `SKIP_AUTH_IN_PRODUCTION=1`.

Cron endpoints (`src/app/api/cron/*`, optional `CRON_SECRET` bearer auth), run via OS cron on the EC2 box (not GitHub Actions — that workflow is disabled/legacy): `morning-briefing`, `pre-meeting-briefing`, `daily-meeting-summary`, `task-reminder`, `feed-sync`, `calendar-sync`, `notion-sync`, `agent-triggers`, `whatsapp-group-summary`, `whatsapp-message-retention`.

Integrations: Google Calendar (OAuth, multi-account), Notion (multi-account, per-workspace DBs for tasks/meetings/assistant/people/projects/companies), Telegram bot, WhatsApp (via the bridge service), Gemini (primary agent/LLM engine, `AGENT_ENGINE=gemini|cursor`), IBKR trade import (Gmail scan + parser), Web Push (VAPID) + Expo push (mobile) — **no Firebase**.

Testing: Vitest (`src/**/*.test.ts`, node env) for units; Playwright e2e in `apps/web/e2e` (port 3002, Hebrew `he-IL` locale, dedicated `e2e.sqlite`) covering core flows, agent triggers, notifications, reading list, task workspaces, trading journal, VAT bulk import, WhatsApp insights.

## packages/database

Two schema files kept in sync by hand: `schema.pg.ts` (canonical Postgres, source of type truth) and `schema.ts` (SQLite mirror). `getDb()` picks Postgres if `DATABASE_URL` is set, else opens local SQLite at `DATABASE_PATH` (default `apps/web/data/ak_system.sqlite`) and runs ~30 idempotent `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS` statements on every call as a hand-rolled SQLite migration mechanism.

Adding a table: edit `schema.pg.ts` first (source of truth for types), mirror in `schema.ts`, add the bootstrap SQL block in `database/src/index.ts` for SQLite, export table + inferred types from `index.ts`.

Key tables: people, projects, workspaces (+ `workspaceNotionDatabases`), `notionStatusOverrides`, meetingSeries/meetingTypes/meetings/meetingPeople, tasks/taskPeople, financeTrades/financeTransactions, feedSources/feedItems, readingListItems, facts, chatMessages, agentThreads/agentMessages/agentTriggers, healthMetrics, vatEntries, pushSubscriptions/expoPushTokens, notifications, whatsappLabels/whatsappGroups/whatsappMessages, hugoInstructions, memories, userSettings, notificationPreferences, googleConnections.

`pnpm db:push` (drizzle-kit push, SQLite only) is the everyday command; `db:generate`/`db:migrate` exist for formal migrations. `drizzle.config.ts` only targets SQLite — Postgres/prod schema changes are applied manually.

## packages/api

21 tRPC routers in `src/routers/*`, all on `protectedProcedure`. Notable business logic lives in `src/services/*`: `notion-tasks-sync.ts` (Notion → tasks, status-override mapping), `google-calendar*.ts` (sync/health), `ibkr-parser.ts` / `ibkr-import-service.ts` / `pnl.ts` (trading journal), `vat-excel-export.ts` / `invoice-ocr.ts` / `expense-folders.ts` (VAT), `whatsapp-bridge-client.ts` / `whatsapp-insights.ts`, `agent-calendar-context.ts`, `notification-preferences.ts`. Tests use a shared seeded SQLite file (`test-data/`) with `fileParallelism: false` since suites share/reset the same DB.

New router: add `routers/<name>.ts`, register in `src/index.ts`'s `appRouter`.

## packages/types

`PRIORITY_COLORS`/`PRIORITY_LABELS`, `DAYS_HE`, `TASK_STATUS_ORDER`/`STATUS_COLORS`/`STATUS_LABELS` (Hebrew, canonical statuses), VAT constants/helpers (`VAT_RATE`, `VAT_CATEGORIES`, period helpers). Treat this as the single source of truth for status/priority styling — don't hardcode Hebrew labels or colors elsewhere.

## apps/mobile ("ARO" / "Helm")

Expo ~56 + Expo Router (file-based, typed routes), React Native 0.85, dark theme (`#0e1626` bg, `#2dd4bf` accent). Talks to the same tRPC API as web (`@trpc/client` + superjson) over `EXPO_PUBLIC_API_URL`. Auth: Google Sign-In → `POST /api/auth/mobile/google` → JWT (signed with the same `NEXTAUTH_SECRET` as web) in SecureStore → Bearer header. Push via `expo-notifications` + `POST /api/push/expo/register`. Screens: home dashboard, chat, meetings, people, tasks (+ detail), login, settings, notifications, reading-list. Build: `pnpm mobile:build:apk` (EAS build, "Helm APK"). **Note:** `apps/mobile/AGENTS.md` warns Expo APIs change fast — check versioned docs at docs.expo.dev before writing mobile code.

## apps/whatsapp-bridge

Standalone service bridging a personal WhatsApp account (Baileys linked-device protocol, not Business API) to the main app. Express + pino + qrcode for pairing. Needs a persistent volume for auth state (can't run serverless). Endpoints: `/` (QR pairing page), `/status`, `/qr`, `POST /send` (bearer), `/groups`, `/groups/summarize(-all)`. Talks to web app via webhook (`AK_WEBHOOK_URL`) and shared-secret callback (`WHATSAPP_BRIDGE_URL`/`WHATSAPP_BRIDGE_SECRET`). Deployed as an optional Docker Compose profile (`--profile whatsapp`) because it's heavy for the 1GB EC2 free-tier box; can alternatively run on a separate small VPS.

## Deployment

Current recommended path: **EC2 + Docker Compose**, driven from the Mac — `pnpm run ci:local` then `pnpm deploy:ec2` (rsync + `docker compose up`), cron runs directly on the instance. **Railway is legacy** (kept only for reference; `railway.toml`/`nixpacks.toml` still exist for it). Public HTTPS access uses a static **ngrok** domain running as a systemd unit on EC2 (Cloudflare quick-tunnel URLs used to rotate and break push notifications / baked-in APK API URLs — that's why ngrok replaced Cloudflare Tunnel for production, though Cloudflare Tunnel is still documented as an option). See `DEPLOY.md` and `docs/deploy/*.md` for step-by-step guides (ec2-production, railway-production [legacy], google-oauth-setup, cron-setup, helm-apk-build, whatsapp-bridge-vm, cloudflare-stable-url).

There's also a **macOS-only Outlook→Google Calendar bridge** (`scripts/install-outlook-bridge.sh`, launchd agent `com.ak.outlook-bridge`, runs every 15 min) that syncs a local Outlook calendar into a "Dragontail" Google Calendar — unrelated to the WhatsApp bridge.

## The "ABC" agent system (A_Agents / B_Brain / C_Core / S_Skills / O_Output / M_Memory)

This is a separate, markdown-defined agent framework (not code) governed by `.cursorrules`, distinct from the dev pipeline above:

- **A_Agents/** — 8 agent cards (Role/Boundaries/Data Access/Sub-agents/Run Protocol): Hugo orchestrator (the WhatsApp-facing router agent), agent trainer, morning briefing, meeting prep herald, IBKR daily import (deterministic, no LLM), calendar optimizer (recommend-only), email assistant (confirmation-gated), startup COO (on-demand advisor persona).
- **S_Skills/** — one `wf_*.md` per agent: step-by-step logic maps (stages/steps/input-action-output) plus error handling.
- **C_Core/brand_dna_and_compliance.md** — mandatory pre-flight read: values, formatting rules, PII/legal guardrails. Every agent run is supposed to check this first.
- **B_Brain/organization_knowledge.md** — org facts template (currently mostly unfilled placeholders).
- **O_Output/** — dated staged artifacts (`YYYY-MM-DD_<agent>.md`), marked `DRAFT — REQUIRES HUMAN REVIEW`.
- **M_Memory/agents_daily_sync.md** — append-only run log/changelog (also used broadly as a general dev journal, not just for the 8 agents).

**Important nuance:** `scripts/run_daily_agents.py` (Python, direct Notion API calls, no LLM, generates the O_Output examples) is a standalone offline demo generator — **not** wired into production. The real, live agent logic runs through the Next.js cron routes in `apps/web/src/app/api/cron/*` calling an LLM-backed engine (Gemini by default). Don't confuse the two when tracing "what actually runs in prod."

## docs/specs & reports conventions

Every feature/fix should have a spec at `docs/specs/<slug>.md` (Goal → acceptance criteria → data model → tRPC API → UI surface → out of scope) and, once implemented, a verdict at `reports/<slug>.md` (or `reports/qa-<slug>.md` for pure test-focused QA passes). When picking up new work, check `docs/specs/` first for whether a spec already exists for the area, and `reports/` for whether it's already been implemented/reviewed.

## Quick commands

```
pnpm install
pnpm db:push          # create/update SQLite schema — do this first
pnpm dev               # http://localhost:3000
pnpm test              # Vitest (packages/api)
pnpm e2e                # Playwright (apps/web, port 3002)
pnpm qa                 # test + e2e
pnpm -r run lint
pnpm --filter @ak-system/web build
pnpm mobile             # expo start
pnpm whatsapp-bridge:dev
pnpm deploy:ec2         # ship to production
```
