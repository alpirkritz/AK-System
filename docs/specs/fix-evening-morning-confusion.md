# Fix evening “morning” branding + morning יועץ יומן WhatsApp delivery

> **Slug:** `fix-evening-morning-confusion`
> **Status:** Draft
> **Last Updated:** 2026-07-26

## Goal

Stop the 20:00 Israel daily summary from looking like a morning brief (Hugo titled it `☀️ עדכון בוקר`), and make the 07:00 יועץ יומן (`morning_briefing` → `06_calendar_optimizer`) reliably visible on WhatsApp Message Yourself — with clear delivery logging so silent WhatsApp failures cannot look like “nothing was sent.”

## User Stories

- As the owner, I want the 20:00 summary to read as an **end-of-day** wrap-up, never as a morning update, so I do not confuse it with יועץ יומן.
- As the owner, I want יועץ יומן at 07:00 to arrive on WhatsApp (Message Yourself) every day when the WhatsApp channel is enabled.
- As the owner, I want cron/agent fan-out to report whether WhatsApp/Telegram/push actually succeeded, so a chat-only save is not mistaken for full delivery.

## Acceptance Criteria

### A — Evening summary branding

- [ ] When `daily_meeting_summary` runs via an agent (currently Hugo), the delivered text **must not** contain morning framing: no `עדכון בוקר`, no `☀️` morning emoji title, no “Morning Brief” / `תדריך בוקר` as the headline.
- [ ] The agent prompt for this event includes an explicit override: this is an **evening / end-of-day** summary; do **not** call `03_morning_briefing` or `06_calendar_optimizer` unless the user text explicitly asks for calendar advice.
- [ ] Production `notification_preferences.trigger_message` for `daily_meeting_summary` is updated to an evening-oriented instruction (Hebrew), or the runner injects the override so a stale DB string cannot reintroduce morning branding.
- [ ] Built-in template path (no agent) already uses `📊 סיכום יומי` — leave that title; no regression.

### B — Morning יועץ יומן → WhatsApp

- [ ] `pushAssistantMessage` / WhatsApp outbound prefers **phone JID** (`WHATSAPP_ALLOWED_JID` / `SELF_JID`) over LID when both are set (Message Yourself is the phone JID chat).
- [ ] If the primary target send fails, retry once with the alternate self identity (LID ↔ JID) before returning `whatsapp: false`.
- [ ] `runEventAgentIfRouted` returns (or the morning/daily cron JSON includes) channel results: `{ whatsapp, telegram, webPush, expoPush }` — same shape as the template path already returns for daily summary.
- [ ] Morning briefing cron logs a single line when WhatsApp is enabled but send returns false (so EC2 logs show the miss).
- [ ] Manual resend of today’s יועץ יומן content via `/send` to phone JID succeeds (smoke); after deploy, a one-shot cron trigger at a test slot or `curl` morning-briefing (with temporary schedule / force) is optional QA — at minimum unit tests cover target preference + retry.

### C — Tests

- [ ] Vitest: WhatsApp `getSelfChatTarget` (or equivalent helper) prefers JID over LID when both set.
- [ ] Vitest: daily-summary / event-runner prompt override contains evening rules and forbids morning titles (string contract test), or Hugo/cron instruction builder test if override lives in `gemini-agent-engine` / `notification-event-runner`.
- [ ] Vitest: `sendWhatsAppMessage` retries alternate target on first failure (mock fetch).

## Data Model

No schema changes to `schema.ts` / `schema.pg.ts`.

Operational data (production SQLite), if needed during impl:

- `notification_preferences` row `type_id = 'daily_meeting_summary'`: update `trigger_message` to evening wrap-up copy (keep `agent_id = 01_Hugo_orchestrator`, `schedule_times = ["20:00"]`).
- `morning_briefing` row: leave as-is (`schedule_times = ["07:00"]`, `agent_id = 06_calendar_optimizer`, WhatsApp channel on) unless a bug is found in channel flags.

## tRPC API

No new procedures. Existing notification prefs upsert may be used to update `trigger_message` from settings UI; impl may also set via one-time SQL/script on EC2.

## UI Surface

No required UI change. Optional microcopy in `/settings/notifications` for `daily_meeting_summary` description already says “בסוף היום” — keep.

If delivery status is ever shown later, out of scope here.

## Implementation notes (for Dev)

| Area | Files (expected) |
|---|---|
| Evening override | `apps/web/src/lib/notification-event-runner.ts` and/or `gemini-agent-engine.ts` — when `typeId === 'daily_meeting_summary'`, append hard Hebrew/English instruction block |
| Default Hugo trigger | Prefer not relying on `DEFAULT_TRIGGER_MESSAGES['01_Hugo_orchestrator']` alone; event-specific message wins |
| WhatsApp target order | `apps/web/src/lib/whatsapp-bot.ts` — `getSelfChatTarget()`; mirror intent in bridge `getSelfChatTarget()` in `apps/whatsapp-bridge/src/config.ts` (prefer `selfJid` over `selfLid`) |
| Cron observability | `morning-briefing/route.ts`, `daily-meeting-summary/route.ts`, `notification-event-runner.ts` — plumb `pushAssistantMessage` return value |
| Prod trigger text | Update DB `daily_meeting_summary.trigger_message` to something like: `זה סיכום סוף יום (ערב). סכם מה קרה היום בכל הערוצים. אל תכתוב "עדכון בוקר" / תדריך בוקר. אל תריץ morning briefing או יועץ יומן.` |

## Out of Scope

- Changing 07:00 / 20:00 schedule times or timezone logic (already correct: `TIMEZONE=Asia/Jerusalem`).
- Disabling `pre_meeting_briefing` or FOMO.
- Redesigning Calendar Optimizer brief content (Notion-parity already shipped).
- Making WhatsApp self-chat produce OS notifications (known limitation; push remains the OS path).
- Re-enabling GitHub Actions cron.

## Open Questions

1. After the `[RESHEND morning yoez]` / probe messages — did they appear in WhatsApp Message Yourself? (Confirms delivery path vs. “I never open that chat in the morning.”)
2. Prefer keeping Hugo on `daily_meeting_summary`, or switch agent to template-only / `03` with evening instructions? **Default: keep Hugo + hard override.**
