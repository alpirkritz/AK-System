# voice-two-column-layout

## Goal

The recording screen currently replaces the old recorder with a meeting list, and hides the
original controls behind a "הקלטה חופשית · בלי פגישה" toggle. The user wants both visible at
once: the original recorder on the right (RTL start side), today's meetings on the left.

## User stories

1. As Alpir, I open `/voice` and immediately see both the familiar recorder and today's meetings,
   without expanding anything.
2. As Alpir, I tap a meeting on the left and recording starts with that meeting's context.
3. As Alpir, I fill in people/project on the right and press "התחל הקלטה" for a free recording.
4. On a phone the two columns stack, recorder first.

## Acceptance criteria

- Idle state renders two columns on `md` and up: recorder at inline-start (right in RTL),
  meetings at inline-end (left in RTL). Single column below `md`, recorder first.
- The `voice-free-toggle` button and the `freeOpen` state are removed. The recorder controls
  (`voice-free-section`) are always rendered in the idle state.
- The consent checkbox stays full-width above both columns and still gates both the meeting rows
  and the "התחל הקלטה" button.
- `?meeting=<id>` still renders the single preset-meeting block in the meetings column.
- Active-recording, upload and result states are unchanged and stay single column.
- Page max width grows from `max-w-2xl` to `max-w-4xl` so two columns have room.

## Data model changes

None.

## tRPC API

None. `voice.meetingChoices` and `voice.meetingContext` are unchanged.

## UI surface

`apps/web/src/app/voice/page.tsx`, idle branch only:

```
consent (full width)
grid gap-5 md:grid-cols-2
  ├─ column 1 (right in RTL): "הקלטה חופשית" heading + people, project, input device,
  │   tab capture, Zoom/Meet guide, "התחל הקלטה"
  └─ column 2 (left in RTL): "פגישות להיום" heading + meeting rows / preset meeting
```

Separator: `md:border-e md:border-[#223052] md:pe-5` on column 1.

### Microcopy

| Element | Text |
|---|---|
| Column 1 heading | `הקלטה חופשית` |
| Column 1 hint | `בלי פגישה מהיומן — בחר משתתפים ופרויקט ידנית.` |
| Column 2 heading | `פגישות להיום` (unchanged) |

Everything else keeps its current wording.

## Mobile app

`apps/mobile/app/(tabs)/record.tsx` stays as it is — a phone has no room for two columns, and the
existing stacked cards already show the meeting list above the free-recording section. The only
change is dropping the `freeOpen` collapse so the free-recording card is always visible, matching
web behaviour.

## Out of scope

- Any change to how a recording is uploaded, matched or summarized.
- Re-ordering or restyling the meeting rows themselves.

## Testing notes

- Playwright `apps/web/e2e/email-voice-commitments.spec.ts`: the consent test must no longer click
  `voice-free-toggle` before reaching `voice-start`; both are visible from the start.
- The "records one straight from the list" test is unaffected.
