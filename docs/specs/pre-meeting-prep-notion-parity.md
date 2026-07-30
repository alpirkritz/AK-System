# Pre-meeting — Meeting Prep quality on WhatsApp (Notion parity)

> **Slug:** `pre-meeting-prep-notion-parity`
> **Status:** Approved
> **Detected stack:** `next-trpc-monorepo`
> **Last Updated:** 2026-07-23
> **Related:** `enrich-pre-meeting-template.md` (template fallback), `meeting-prep-related-tasks-only.md`, `fix-meeting-prep-grounding.md`

## Goal

Close the gap the owner just demonstrated: automatic WhatsApp “הכנה לפגישה” currently dumps calendar invite fluff, while Notion Inbox (Meeting Prep Herald) delivers a real prep brief (topics to push, ownership questions, recommended stance, related actions). Make the **15‑minute pre-meeting WhatsApp/ARO message** match that quality for substantive meetings — without returning to birthday/workout LLM spam.

## Diagnosis

| Channel | Path today | Quality |
|---------|------------|---------|
| WhatsApp auto (~15 min before) | `pre_meeting_briefing` template (`agent_id` null) | Title/time/location + invite description paste |
| Notion Inbox / on-demand chat | `04_meeting_prep_herald` (tools + grounding) | Structured prep with decisions & related tasks |

Production `notification_preferences.pre_meeting_briefing.agent_id` is currently **null** (Option A from `morning-calendar-advisor-no-prep-spam`).

## User Stories

- As the owner, I want WhatsApp pre-meeting prep to feel like the Notion Meeting Prep page for the same meeting.
- As the owner, I do not want invite marketing / Teams “Need help?” / Outlook headers in the brief.
- As the owner, I do not want a full LLM run for trivial calendar noise (all-day, free/busy, solo personal blocks).
- As the owner, I want to turn agent routing on/off from Settings → התראות.

## Acceptance Criteria

- [ ] Given a timed work meeting in the 14–16 min window with real attendees (or Dragontail `משתתפים:`), when `pre_meeting_briefing` is routed to `04_meeting_prep_herald`, then WhatsApp receives an agent brief (not the template paste).
- [ ] Given that agent brief, when rendered, then it includes (when grounded): meeting header, **What you should talk about** (numbered), optional **Your recommended stance**, optional **Also relevant** related open actions — and **never** pastes raw calendar description / Teams help / Outlook From-To-When.
- [ ] Given no grounded agenda/tasks/notes, when the agent runs, then it omits empty sections (no “לא נמצא…” spam walls) and stays short.
- [ ] Given free/busy placeholders, all-day / ≥8h events, or meetings with no non-bot attendees and no useful description participants, when cron runs, then **skip send** (or optional one-line title+time only — default: skip) — no LLM.
- [ ] Given Settings UI, when owner clears agent on `pre_meeting_briefing`, then template fallback remains (with existing invite-fluff filters).
- [ ] Prompt-contract test: Meeting Prep WhatsApp/cron override asserts Notion-parity section intent + no-description-paste ban.
- [ ] Manual smoke: Unleash-style meeting produces insight brief on WhatsApp; a workout/all-day does not.

## Data Model

No schema changes. Ops/UI: set `notification_preferences.pre_meeting_briefing.agent_id = '04_meeting_prep_herald'` (UI-reversible). Optional `trigger_message` for focused single-meeting prep.

## tRPC API

No new procedures. Uses existing `getNotificationRouting` + `runEventAgentIfRouted('pre_meeting_briefing', { context })`.

## Implementation

1. **Production / UI:** Route `pre_meeting_briefing` → `04_meeting_prep_herald` with trigger message like:  
   `הכן אותי לפגישה הבאה בלבד (הקשר למטה). פלט קצר בסגנון Notion: What to talk about / Recommended stance / Related actions. אל תעתיק את תיאור האירוע מהיומן.`
2. **`pre-meeting-briefing/route.ts`:**  
   - Build enriched context (title, time, location, attendees, cleaned description only if `isUsefulAgenda`) for the agent.  
   - Add `shouldRunPreMeetingAgent(event)` gate (skip free/busy, all-day, ≥8h, no real attendees).  
   - If routed + gate pass → agent; if routed + gate fail → skip; if not routed → template (existing).
3. **`gemini-agent-engine.ts`:** Hard override for `04` on channels `whatsapp` | `cron` | `telegram` — Notion-parity single-meeting format; ban pasting calendar description; omit empty sections; keep related-tasks-only + grounding rules.
4. **Template fallback:** Tighten `isUsefulAgenda` to reject mission-statement / “Need help? | System reference” fluff so template never shows what Unleash showed today.
5. Tests: gate helper + prompt override strings + agenda fluff rejection.

## UI Surface

Settings → התראות → הכנה לפגישה → סוכן מטפל = Meeting Prep Herald (document in report). No new page.

## Out of Scope

- Changing Notion Inbox writer
- Daily morning dump of all meetings via Meeting Prep (morning stays יועץ יומן)
- Full redesign of `A_Agents/04` workflow stages (override + trigger message first)

## Open Questions

None — approved: skip silently for gated-out events; re-enable agent routing on production.
