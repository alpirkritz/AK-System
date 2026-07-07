# Notification Preferences Hub

> **Slug:** `notification-preferences`
> **Status:** Implemented
> **Detected stack:** `next-trpc-monorepo`
> **Last Updated:** 2026-07-07

## Goal

Give the owner a single screen that shows every notification the system can send (system briefings, WhatsApp group alerts, Hugo replies, scheduled agents), and lets them turn each one on or off per channel (WhatsApp / Push / Telegram). Two daily briefings also become time-editable from the UI instead of only from the crontab.

## User Stories

- As the owner, I want one page that lists every kind of notification so I finally know what reaches me and when.
- As the owner, I want to disable a specific notification on WhatsApp while keeping it as an OS push (or the other way around).
- As the owner, I want to change the send time of the morning briefing and the daily meeting summary without editing the server crontab.
- As the owner, I want to see at a glance whether WhatsApp, Telegram and Push are actually connected on this device.
- As the owner, I want jumps to the existing WhatsApp-groups and agents screens for the settings that already live there.

## Acceptance Criteria

- Given the settings screen, when I open "התראות וערוצים", then I see every notification type grouped by category with its current channel toggles.
- Given a notification type with a WhatsApp toggle, when I turn it off and save, then that type is no longer sent to WhatsApp but other channels are unaffected.
- Given the morning briefing type, when I set its time to `08:30` and save, then the briefing is delivered at 08:30 (server timezone) and not at 07:00, and only once per slot per day.
- Given a type is disabled entirely, when its cron/fan-out runs, then no channel receives it and no `chat_messages`/notification row is written for it.
- Given the bridge/Telegram/Push are not configured, when I open the page, then the channel status row shows each as not-connected and the relevant toggles are disabled with an explanation.
- Given no preference row exists for a type, when the fan-out runs, then it behaves as today (all configured channels receive it).

## Data Model

New table `notification_preferences` in both `packages/database/src/schema.ts` (SQLite, `integer({ mode: 'boolean' })`) and `packages/database/src/schema.pg.ts` (Postgres, `integer`), mirroring the `agent_triggers` boolean convention. Migration is additive: add a `NOTIFICATION_PREFERENCES_TABLE` `CREATE TABLE IF NOT EXISTS` block to `packages/database/src/index.ts` and export the table + types.

| Column | Type | Notes |
|--------|------|-------|
| `type_id` | text PK | e.g. `morning_briefing`, `whatsapp_fomo`, `hugo_reply`, `agent_run` |
| `enabled` | boolean | default `true` |
| `channel_whatsapp` | boolean | default `true` |
| `channel_push` | boolean | default `true` (Web Push + Expo bundled as one "push" channel) |
| `channel_telegram` | boolean | default `true` |
| `schedule_times` | text nullable | JSON `["07:00"]`; only used by schedulable types |
| `last_sent_at` | text nullable | ISO timestamp for per-slot dedup of schedulable types |
| `updated_at` | text | ISO timestamp |

Rows are created lazily on first `upsert`. Absence of a row means "enabled, all channels on" (backwards compatible).

The catalog of types is static code (not a table), defined in `packages/api/src/services/notification-preferences.ts`:

| type_id | category | channels | schedulable | default time |
|---------|----------|----------|-------------|--------------|
| `morning_briefing` | cron | whatsapp, push, telegram | yes | `07:00` |
| `task_reminder` | cron | whatsapp, push, telegram | no | — |
| `pre_meeting_briefing` | cron | whatsapp, push, telegram | no | — |
| `daily_meeting_summary` | cron | whatsapp, push, telegram | yes | `20:00` |
| `feed_digest` | cron | whatsapp, push, telegram | no | — |
| `agent_run` | agent | whatsapp, push, telegram | no | — (times per agent in `/agents`) |
| `whatsapp_fomo` | whatsapp | push | no | — |
| `whatsapp_keyword` | whatsapp | push | no | — |
| `whatsapp_group_summary` | whatsapp | push | no | — |
| `hugo_reply` | hugo | push | no | — |

The four `push`-only types gate only the OS-push mirror; their WhatsApp delivery is produced by the bridge itself and stays out of app control (see Out of scope).

## tRPC API

Extend `settings` router (`packages/api/src/routers/settings.ts`) with a `notifications` sub-router. Service logic lives in `packages/api/src/services/notification-preferences.ts` and is exported from `packages/api/src/index.ts`.

| Procedure | Kind | Input | Returns | Auth |
|-----------|------|-------|---------|------|
| `settings.notifications.list` | query | — | `{ items: NotificationPrefItem[]; channels: ChannelStatus }` | protected |
| `settings.notifications.upsert` | mutation | `{ typeId, enabled?, channels?: { whatsapp?, push?, telegram? }, scheduleTimes? }` | `NotificationPrefItem` | protected |
| `settings.notifications.resetDefaults` | mutation | — | `{ reset: number }` | protected |

- `NotificationPrefItem` = catalog entry (`typeId`, `category`, `label`, `description`, `availableChannels`, `schedulable`) merged with current DB values (`enabled`, `channels`, `scheduleTimes`).
- `ChannelStatus` = `{ whatsapp: boolean; telegram: boolean; push: boolean }` derived from bridge config (`isBridgeConfigured`), `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_CHAT_ID`, and VAPID presence. `push` reflects server capability; the browser permission state stays client-side.
- `upsert` rejects `scheduleTimes` for a non-schedulable type with a `BAD_REQUEST`.

Service functions:
- `resolveNotificationChannels(typeId): Promise<ResolvedChannels>` — returns `{ enabled, whatsapp, push, telegram }` from DB row or catalog defaults.
- `getSchedulablePreference(typeId): Promise<{ enabled, scheduleTimes, lastSentAt }>`.
- `markNotificationSent(typeId): Promise<void>` — stamps `last_sent_at`.
- `wasNotificationSentInSlot(lastSentAt, slot, tz): boolean` — mirrors `wasAgentRunInSlot`.

## UI Surface

- **Route:** new `apps/web/src/app/settings/notifications/page.tsx` (`"use client"`, RTL, reuses `.card`/`.btn`, gold `#e8c547`, and the existing `Toggle` pattern).
- **Entry point:** `apps/web/src/app/settings/page.tsx` — add a card/link above `NotificationsCard` ("התראות וערוצים" → `/settings/notifications`); keep the existing device-push enable/test control where it is.

Page structure (top to bottom):
1. **מצב ערוצים** — three read-only status pills (WhatsApp / Telegram / Push) from `channels` + browser permission.
2. **תדריכי מערכת** — one row per `cron` type: enable toggle, per-channel toggles (only `availableChannels`), and a time input for schedulable types (`morning_briefing`, `daily_meeting_summary`).
3. **סוכנים** — `agent_run` channel toggles + a "ערוך שעות" link to `/agents`; below it a compact read-only list of agents with their schedule (from `agents.triggers.list`).
4. **WhatsApp** — the four `push`-only types (FOMO, keyword, group summary, Hugo reply) with a push toggle each + "נהל קבוצות" link to `/settings/whatsapp`.

States: loading skeleton while `list` query runs; saving indicator per row; disabled toggles with tooltip when the channel is not connected; a "שוחזרו ברירות מחדל" confirmation for reset. Microcopy examples: `task_reminder` → "נשלח כשמשימה מגיעה למועד או באיחור — לא ניתן לקבוע שעה"; `pre_meeting_briefing` → "15 דקות לפני כל פגישה".

## Fan-out wiring

- `apps/web/src/lib/push-notifications.ts` — `pushAssistantMessage(text, source, options?)` gains `options.typeId`. Before sending, call `resolveNotificationChannels(typeId)`; if `!enabled` skip everything (no chat/notification write); otherwise gate WhatsApp/Push/Telegram individually. No `typeId` = current behavior.
- Cron routes pass their `typeId`: `morning-briefing` → `morning_briefing`, `task-reminder` → `task_reminder`, `pre-meeting-briefing` → `pre_meeting_briefing`, `daily-meeting-summary` → `daily_meeting_summary`, `feed-sync` → `feed_digest`.
- `apps/web/src/lib/agent-trigger-runner.ts` — pass `agent_run`.
- `morning-briefing` and `daily-meeting-summary` routes additionally gate on `getSchedulablePreference` + `wasNotificationSentInSlot` and call `markNotificationSent` on success; `deploy/crontab.example` changes those two lines to run every 15 min.
- `apps/web/src/lib/agent-notifications.ts` — gate the push mirror by `agent_run` (or `hugo_reply` for Hugo) push channel.
- `apps/web/src/lib/whatsapp-bot.ts` (Hugo inbound push mirror) → `hugo_reply` push channel.
- `apps/web/src/app/api/whatsapp/group-alert/route.ts` → `whatsapp_fomo` / `whatsapp_keyword` push channel.
- `apps/web/src/app/api/whatsapp/group-summary/route.ts` → `whatsapp_group_summary` push channel.

## Out of scope

- Changing the underlying cron frequencies for anything other than the two schedulable briefings (they move to every 15 min so the DB time can take effect).
- Gating WhatsApp delivery for `whatsapp_fomo`/`whatsapp_keyword`/`whatsapp_group_summary`/`hugo_reply` (those messages are sent by the bridge, not the app) — only their OS-push mirror is controllable.
- Global WhatsApp on/off via env (`WHATSAPP_BRIDGE_URL` etc.) or choosing a different JID/account.
- Per-agent notification channels (single `agent_run` control covers all scheduled agent output); per-agent schedules stay in `/agents`.
- Per-group FOMO/keyword/summary editing (stays in `/settings/whatsapp`).
- Splitting Web Push and Expo into separate toggles (bundled as one "push" channel).

## Open questions

- None.
