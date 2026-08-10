# Agent Precision & Push Reliability

> **Status:** APPROVED by Alpir (2026-08-03, "תעשה כל מה שאמרת") — IMPLEMENTED same day; QA pending on Mac (see reports/agent-precision-and-push-reliability.md)
> **Context:** Investigation on 2026-08-03 found (a) push notifications to the Helm APK silently die because Expo *receipts* are never checked and no scheduler invokes `/api/cron/*` in the local-Mac deployment, and (b) agent output precision suffers from contradictory prompt layers, truncated user instructions, and missing channel-format guards. Agent-card/workflow markdown contradictions were already fixed directly (no code). This spec covers the remaining **code** changes.

## Goal

Scheduled agents run reliably, push delivery failures become visible and self-healing, and user-written instructions actually win over boilerplate.

## User stories

- As Alpir, when a push fails at the Expo→FCM hop, I see the exact error in the app instead of silence.
- As Alpir, my instructions in `/memory` are applied in full, and beat conflicting defaults.
- As Alpir, the email assistant's WhatsApp output is readable (no Markdown tables), like meeting-prep already is.
- As Alpir, my morning briefing at 07:00 uses my customized `03_morning_briefing` instructions, not a dumb template.

## Acceptance criteria

1. **Push receipts** — `packages/api/src/lib/expo-push.ts`: after send, ticket ids are persisted; a follow-up check (≥15 min later, piggybacked on an existing frequent cron route) fetches receipts. `DeviceNotRegistered` → delete token row. `InvalidCredentials` / `MismatchSenderId` → create an in-app notification ("Push credentials broken: <error>") once per 24h. Receipt outcomes logged.
2. **Memory budget & precedence** — `apps/web/src/lib/agent-memory.ts`: budget 4000 → 12000 chars; never truncate mid-line; if truncated, append an explicit `[הוראות נחתכו]` marker. `gemini-agent-engine.ts` `buildSystemInstruction`: user instructions block moves to the **end** of the system instruction with an explicit precedence statement; the "MANDATORY overrides" blocks are amended to "…except where the user's saved instructions explicitly say otherwise."
3. **Universal channel-format guard** — the no-tables / concise WhatsApp rules currently applied only to agents 04/06 become a channel-level block applied to **all** agents on whatsapp/telegram/cron channels.
4. **Morning-briefing routing default** — `packages/api/src/services/notification-preferences.ts`: `suggestedAgentId` for `morning_briefing` changes `06_calendar_optimizer` → `03_morning_briefing`. Unrouted (template) mode prepends a one-line label "(תבנית ללא סוכן — אפשר לנתב סוכן בהגדרות)".
5. **Cron history isolation** — `agent-trigger-runner.ts` + event-routed cron runs: include at most the **3** most recent history messages (or none), so yesterday's malformed output can't become today's few-shot example.
6. **Context caps** — Notion `calendarReview` injection capped (e.g. 6000 chars) in `packages/api/src/routers/notion.ts`.
7. **Deterministic cron runs** — temperature 0.3 for cron-channel runs in `gemini-config.ts` / engine call.
8. Vitest coverage for: receipt handling (mock Expo API), memory truncation marker, preference default. `pnpm test`, `pnpm -r run lint`, web build pass.

## Data model changes

New table `pushDeliveryLog` — `schema.pg.ts` (canonical) + `schema.ts` (SQLite mirror) + bootstrap SQL in `database/src/index.ts`:
`id`, `ticketId`, `token`, `status` ('ok'|'error'), `errorCode`, `message`, `sentAt`, `checkedAt`.

## tRPC API

`push.deliveryLog` (protectedProcedure, query, last 50 entries) — surfaced later in Settings ▸ Notifications for debugging. No other API changes.

## UI surface

Settings ▸ Notifications: small "יומן מסירה" section reading `push.deliveryLog` (read-only list). Out of scope to redesign anything else.

## Out of scope

- EC2/ngrok topology changes; FCM credential upload (manual, via `eas credentials` — see `scripts/push-doctor.mjs` / `scripts/check-helm-fcm.sh`).
- Rewriting agent cards (done separately, 2026-08-03).
- `local-cron.mjs` scheduler (already added under `scripts/`, exempt from this pipeline).

## Open questions

1. Receipt check placement: piggyback on `task-reminder` (runs every minute) or a new dedicated cron route?
2. Memory budget 12000 — enough? (hugoInstructions allows 20000; Gemini context is not the constraint.)
3. Should unrouted template mode be removed entirely in favor of always-routed?
