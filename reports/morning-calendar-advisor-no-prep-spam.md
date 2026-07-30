# Review — morning-calendar-advisor-no-prep-spam

> **Spec:** `docs/specs/morning-calendar-advisor-no-prep-spam.md`
> **Date:** 2026-07-20
> **Verdict:** APPROVED

## Summary

Option A: clear Meeting Prep Herald routing from `pre_meeting_briefing` (UI-reversible), keep short templates, fix morning `trigger_message`, pass today’s schedule as context to יועץ יומן at 07:00.

## Changes

| Area | Change |
|------|--------|
| Production DB | `pre_meeting_briefing.agent_id` → NULL; `morning_briefing.trigger_message` → NULL |
| `morning-briefing/route.ts` | Build schedule text first; pass as `context` to `runEventAgentIfRouted` |
| `morning-briefing-context.ts` | Shared formatter + Vitest |
| `agents-meta.ts` | Default schedule hint for `06_calendar_optimizer` → `07:00` |

## Verification

- Production prefs after update: morning → `06` @ 07:00 all channels; pre-meeting → template (no agent).
- Vitest `morning-briefing-context.test.ts`: 2 passed.
- UI: Settings → התראות → “סוכן מטפל” can re-attach Meeting Prep anytime; on-demand agent runs unchanged.

## Notes

- Code path for morning context requires deploy to EC2 to take effect at next 07:00.
- Prefs fix is live immediately (stops Meeting Prep LLM spam).
