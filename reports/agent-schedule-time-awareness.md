# Review — agent-schedule-time-awareness

**Verdict: APPROVED**

Spec: `docs/specs/agent-schedule-time-awareness.md`

## Scope reviewed

| File | Change |
|---|---|
| `packages/api/src/lib/event-time-status.ts` | New shared helper: `eventTimeStatus`, `groupEventsByTime`, `nowClockBlock` |
| `packages/api/src/index.ts` | Exports the helper |
| `packages/api/src/services/agent-calendar-context.ts` | Prompt block split into clock sections; all-day items moved to one inline background line; instruction rewritten |
| `apps/web/src/lib/conversation-engine.ts` | Day/week tool payloads return `now` + buckets; `get_upcoming_events` carries `timeStatus`; local duplicate helper removed in favour of the shared one |
| `apps/web/src/lib/gemini-agent-engine.ts` | Agent system instruction describes the buckets |
| `packages/api/src/lib/event-time-status.test.ts` | +12 cases |
| `packages/api/src/services/agent-calendar-context.test.ts` | +6 cases |
| `apps/web/src/lib/calendar-optimizer-tasks.test.ts` | Updated to the bucketed payload; now uses the real helper rather than a stub |

## Acceptance criteria

All met. Three points worth recording:

**The reported cause was not the one first diagnosed.** The clock was already in the system
instruction from `agent-clock-and-harness-surfacing`. The actual source of Hugo's answer was
the prefetched calendar prompt block, which rendered one flat list where an all-day event read
only `- כל היום <title>`. Fixing only the tool payload would have changed nothing — confirmed
by deploying that change alone and getting a byte-identical reply from production.

**A single source of truth now backs both surfaces.** `event-time-status.ts` is the only place
that decides what "past" means, so the prompt block and the tool payloads cannot drift. This
closes the open question left by the previous spec.

**Prompt instructions alone did not hold.** Three successive tightenings of the wording still
left Hugo re-filing birthdays under a self-invented "מה כבר עבר" heading. What worked was
removing all-day events from the event list entirely and emitting a single inline
`רקע ליום` line — with no list to re-file, the mistake became unavailable.

One robustness fix came out of an existing test fixture rather than the spec: an event with no
parseable end was classified `current` forever, so a 09:00 standup would read as "happening
now" all afternoon. The helper now presumes an hour when the end is unreadable.

## Checks

| Check | Result |
|---|---|
| `pnpm --filter @ak-system/api exec vitest run` | 1204 passed (106 files) |
| `pnpm --filter @ak-system/web exec vitest run` | 274 passed (36 files) |
| `pnpm -r run lint` | pass (pre-existing warnings only) |
| `pnpm --filter @ak-system/web build` | pass |

## Production verification (EC2)

Deployed, then asked the live Hugo "מה נשאר לי היום ביומן?" at 16:23 Israel time. Before the
change he opened with a list of nine birthdays and a finished 11:30 sync under
**מה כבר עבר**, with the in-progress block buried last. After:

```
היי, יום שלישי, 6 באוקטובר 2026, 16:23 (עכשיו)
...
מתרחש כרגע:            15:30–21:00 Kids
עוד לפניך היום:        אין עוד אירועים עם שעה להיום
כבר הסתיים היום:       11:30–12:00 Algo 4.0 - Sync meeting updates
רקע ליום (לא לוח זמנים, לא אירועים שעברו):
                       Tal WFH · ימי הולדת: Helit Kahana, Barry Garfinkel, ...
```

He also volunteered "הפגישות שהסתיימו כבר אינן רלוונטיות ל'מה שנשאר'" — the distinction is
now something he reasons with, not just echoes.

## Note for future work

The agent's answer is correct but long: it still enumerates every Notion task due today and
overdue under the schedule. That predates this change and was left alone, but it is the next
thing to trim if the user finds the reply heavy.
