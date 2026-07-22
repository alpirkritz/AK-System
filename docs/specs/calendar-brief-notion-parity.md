# Calendar Optimizer — Notion-parity brief (WhatsApp-safe)

> **Slug:** `calendar-brief-notion-parity`
> **Status:** Approved
> **Last Updated:** 2026-07-22
> **Stack:** `next-trpc-monorepo`
> **Supersedes (presentation only):** `docs/specs/calendar-optimizer-whatsapp-brief.md` (keep no-tables + no-meta rules; expand structure and depth)

## Goal

Restore Calendar Optimizer (`06_calendar_optimizer`) reply quality to match Notion Calendar Optimizer output: rich daily analysis with quick summary, schedule, conflicts, load, focus windows, and reminders — while remaining readable on WhatsApp/Telegram (no Markdown tables) and on ARO chat.

**Data dependency (hard):** The brief is produced from **ARO-connected calendars** (Google / Apple / Outlook as wired today via `calendar.events` + `getAgentCalendarContext`). Notion is **not required**. If Notion is disconnected or fails, the agent still delivers the full calendar brief from calendar data; Notion may only add optional Reminder enrichment when available.

## User stories

- As the owner, I want a Notion-quality morning calendar brief on WhatsApp so I can plan the day without opening Notion.
- As the owner, I want the same depth in ARO chat so the app does not feel like a stripped-down channel.
- As the owner, I want meetings listed with short context (who / why / organizer) so bullets are useful, not just titles.
- As the owner, I want focus-time windows and soft reminders (OOO yesterday, nomination windows, WFH colleagues) when the agent has that context.
- As the owner, I do not want Markdown tables or agent self-talk ("I understood…", memory acknowledgements).

## Acceptance criteria

- Given a weekday with timed meetings, when `06_calendar_optimizer` runs (cron `morning_briefing`, WhatsApp, Telegram, or ARO), then the reply includes these sections in order (Hebrew or English matching the user/trigger language):
  1. Title line — e.g. `Daily Calendar Summary — Wednesday, July 22, 2026` (or Hebrew equivalent)
  2. **Quick Summary** — 3–5 bullets: conflicts yes/no, back-to-back flags, load (hours + light/manageable/heavy), optional day context (e.g. post-OOO)
  3. **Today's Meetings** — one bullet per timed event: `HH:MM–HH:MM — Title` + duration + short context (≤20 words: attendees / team / organizer / calendar label). Do not omit timed events except all-day / ≥8h
  4. **Conflicts & Overlaps** — explicit "None" when clean; otherwise list real conflicts and non-actionable awareness overlaps (including zero-buffer back-to-back)
  5. **Load Analysis** — total meeting hours vs 4h threshold; name the main free windows
  6. **Focus Time Opportunities** — 1–3 concrete windows with start–end and one-line suggestion
  7. **Reminders** (optional) — only when grounded in calendar/tasks/Notion/memory context (e.g. nomination window, colleague WFH, active check-in period). Skip the section if nothing to say
  8. **Recommendations** (optional) — ≤3 bullets only for real conflict/overload actions, with 2–3 alt slots per suggested move
- Given any channel (`whatsapp`, `telegram`, `web`), when the agent replies, then the reply never contains Markdown table syntax (`| ... |` or `|---|`).
- Given standing instructions or memory updates, when composing the user-facing reply, then the agent does not narrate them (no "מעתה אתעלם", "הוראה זו נוספה", "I understood…").
- Given Hugo folds `run_abc_agent` calendar output, when synthesizing the reply, then it passes the brief through almost verbatim — no second preamble, no re-analysis, no wrapping in tables.
- Given analysis rules, when detecting conflicts/load, then existing rules stay: exclude all-day / ≥8h; flag >4h load; recommendations-only; personal busy blocks included in load/conflict awareness per agent card.
- Given Notion is unavailable or returns errors, when `06_calendar_optimizer` runs with healthy calendar connections, then the reply still includes Quick Summary, Today's Meetings, Conflicts, Load, and Focus from calendar events — it does **not** refuse or say it depends on Notion.
- Given Reminders, when a fact appears only in Notion and Notion is down, then omit that Reminder bullet rather than inventing it; when the same fact is on the calendar (all-day / timed event), include it from calendar.
- Given prompt-contract tests, when `getCalendarOptimizerBriefOverride` / `buildAgentSystemInstruction('06_calendar_optimizer')` run, then they assert: no-tables, required section names (Quick Summary / Today's Meetings / Conflicts / Load / Focus — EN and/or HE aliases), no-meta narration ban, and calendar-primary / Notion-optional wording.

## Data model

No schema changes. No migrations.

## tRPC API

No procedure changes. Delivery still via existing `pushAssistantMessage` / agent chat paths and `morning_briefing` cron → `runEventAgentIfRouted`.

## UI surface

No new routes or components. Message body shape changes only; existing chat/WhatsApp/Telegram renderers show headings + bullets as plain text/markdown lists.

## Implementation plan

### 1. `A_Agents/06_calendar_optimizer.md`

Replace the short "secretary brief" presentation section with the Notion-parity section list above. Keep: no tables, no meta narration, analysis rules, approval-gated actions, Notion Inbox notify.

### 2. `S_Skills/wf_calendar_optimizer.md`

Update Stage 4.1 to the same structure (Quick Summary → Meetings → Conflicts → Load → Focus → Reminders → Recommendations).

### 3. `apps/web/src/lib/gemini-agent-engine.ts`

Rewrite `getCalendarOptimizerBriefOverride()` to mandate the rich section structure and forbid tables/meta. State explicitly: **primary source = connected calendars**; Notion is optional enrichment for Reminders only — never block or degrade the core brief if Notion is missing. Keep Hugo pass-through wording aligned ("Notion-parity brief" / pass through almost verbatim).

Optional follow-up (same PR if cheap): stop treating Notion context failure as material for `06` (already non-fatal today); ensure override + agent card say calendar tools / prefetched calendar context are sufficient for the full brief.

Example WhatsApp-safe shape (illustrative, not hardcoded output):

```
# Daily Calendar Summary — Wednesday, July 22, 2026

## Quick Summary
- No conflicts
- Back-to-back: A → B (zero buffer)
- Load: ~2h — light day

## Today's Meetings
- 14:00–14:30 — ROUTE Dev Sync (30m) — Dragontail (Yael, Elad, …)
- 17:30–18:00 — Daz Weekly (30m) — you organize

## Conflicts & Overlaps
- None (note zero-buffer A→B)

## Load Analysis
- ~2h meetings — below 4h threshold
- Free: morning–14:00; 14:30–17:30

## Focus Time Opportunities
- Morning 07:00–14:00 — deep work / catch-up
- Afternoon 14:30–17:30 — async / email

## Reminders
- (only if grounded)
```

### 4. Tests

Update `apps/web/src/lib/gemini-agent-engine.calendar-brief.test.ts`:
- Assert override contains no-tables + section keywords (Quick Summary / Today's Meetings / Conflicts / Load / Focus, and Hebrew aliases if present in override)
- Assert injection for `06` on whatsapp/telegram/web
- Assert Hugo pass-through still present
- Remove assertions that lock the old ultra-short "שורה תחתונה ≤4" as the only structure (replace with new contract)

### 5. Docs / supersession note

At top of `docs/specs/calendar-optimizer-whatsapp-brief.md`, add one-line status: superseded for structure by `calendar-brief-notion-parity`; no-tables + no-meta still in force.

## Out of scope

- Changing conflict/load detection algorithms or ≥8h exclusion
- Building Markdown→WhatsApp table converters
- Channel-specific dual formats (rich vs short) — one format everywhere
- Redesigning Notion Inbox UI chrome
- Morning Briefing agent `03` rewrite (cron may still route to `06`; leave `03` alone unless it shares the same override)
- New dependencies

## Open questions

None — format choice confirmed: Notion-parity depth on all channels, WhatsApp-safe (bullets/headings, no tables). Data source confirmed: ARO calendars primary; Notion optional only.
