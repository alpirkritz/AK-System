# Enrich pre-meeting template (no LLM spam)

> **Slug:** `enrich-pre-meeting-template`
> **Status:** Approved
> **Detected stack:** `next-trpc-monorepo`
> **Last Updated:** 2026-07-20

## Goal

Make the automatic “הכנה לפגישה” WhatsApp/system message **useful and short** — topic, time, location, a few real participants, real agenda/notes only when they exist, related tasks only when they exist. Never dump Outlook/Teams invite metadata or empty filler lines.

## User Stories

- As the owner, I want a short ping before a meeting with signal, not a copy-paste of the calendar invite.
- As the owner, if there is no real agenda or related tasks, I want those sections **omitted** — not “לא נמצא…”.
- As the owner, for large distribution-list meetings, I do not want 30 emails listed.

## Acceptance Criteria

- Given a Dragontail description with `משתתפים: Name <email>, …`, when building the brief, then names are parsed even if Google `attendees[]` is empty.
- Given an Outlook-recurring invite body (`From:`, `Sent:`, `To:`, `Cc:`, `Subject:`, `When:`, Teams join/dial-in), when cleaning agenda, then that content is **discarded** as non-agenda.
- Given no useful agenda after cleaning (and no meeting notes / prior notes), when formatting, then **omit** the `על מה הולכים לדבר` block entirely.
- Given zero related tasks, when formatting, then **omit** the tasks block entirely (no empty-state line).
- Given more than 8 participants, when formatting, then show at most 8 names (prefer display name, no email) + `ועוד N`; filter meeting bots (`*meetingbot*`, `teams@teams.`).
- Given ≤8 participants, when formatting, then list names (email optional only if name missing).
- Given agent routing on `pre_meeting_briefing`, when cron runs, then agent path still wins.
- Message ≤ ~1200 chars preferred; hard cap 2000.

## Data Model

No schema changes.

## tRPC API

No new procedures.

## UI Surface

No UI change.

## Implementation

`apps/web/src/lib/pre-meeting-brief.ts`:

1. Expand invite/boilerplate filters (line + whole-text heuristics for Outlook headers).
2. `isUsefulAgenda(text)` — false if empty or only invite metadata / join links / phone pins.
3. `formatParticipantsForBrief(labels)` — bot filter, cap 8, `ועוד N`.
4. `formatPreMeetingBrief` — omit empty agenda / empty tasks / empty participants sections (no filler).
5. Keep Dragontail `משתתפים:` extraction; strip that block from agenda body.

## Out of Scope

- Re-enabling Meeting Prep Herald by default
- LLM summarization of invite bodies
- Notion live fetch in cron

## Open Questions

None — user feedback on US:CONNECT dump approved the “omit if not useful” rule.
