# On-demand day controls

## Goal

Four small changes that make the daily workflow faster:
(1) edit or confirm task status directly from a person's detail view on web and mobile;
(2) a one-tap WhatsApp summary button on the home screen;
(3) a per-time-slot "today / tomorrow" toggle for the קיירוס calendar-optimizer agent, so an 20:00 run can analyse tomorrow's calendar;
(4) a one-tap "what should I focus on now?" shortcut that opens the Hugo chat with the question pre-filled.

## User stories

- As Alpir, I want to change a task's status from a person's detail view, so that when I review someone's tasks I can mark them done or in-progress without navigating away.
- As Alpir, I want a WhatsApp summary button on the home screen, so I don't have to go into Settings every time I want a digest.
- As Alpir, I want to configure the קיירוס agent to run at 20:00 and analyse tomorrow's calendar, so I have time to adjust the plan before the day starts.
- As Alpir, I want a one-tap "what should I focus on now?" button on the home screen that opens Hugo and sends the question immediately.
- As Alpir, I want the WhatsApp summary to tell me if it failed and why, in plain Hebrew, so I know whether to check the bridge settings.
- As Alpir, I want the "tomorrow" toggle to be per time-slot, so I can keep a 07:00 slot for today's overview and add a 20:00 slot for tomorrow's plan.

## Acceptance criteria

### Feature 1 — Task status from person view (web)

- Given I open a person's drawer on `/people` or `/relationships`, when the task list renders, then each task row shows the current status as a coloured button label drawn from `STATUS_LABELS` / `STATUS_COLORS` in `@ak-system/types` — including "לא התחיל".
- Given I click a status button, when the popover opens, then it lists all six statuses in `TASK_STATUS_ORDER` with the current one marked, navigable by arrow keys, closable with Escape.
- Given I pick a status, when the save succeeds, then the row updates immediately via `tasks.update({ id, status })` and no modal opens.
- Given the save fails, when the mutation rejects, then the row reverts to the previous status and shows "לא הצלחנו לעדכן את הסטטוס. נסה שוב." inline.
- The existing done checkbox (`tasks.toggleDone`) stays unchanged next to the status button.
- The task title link still opens `TaskModal` for full editing.
- The status button has `aria-label="סטטוס: {label}. שנה סטטוס"`. While saving, it is disabled.

### Feature 1 — Task status from person view (mobile)

- Given I open a person's detail screen, when the screen loads, then a "משימות" section lists up to 10 open tasks from `people.getRelated`, grouped and sorted the same way as the web drawer. A "הצג הכל ({n})" link follows if there are more.
- Given there are no open tasks, when the section renders, then it shows "אין משימות פתוחות עם {name}".
- Each task row has: a done checkbox (44 pt+), a status chip (44 pt+) that opens an Action Sheet with the six statuses, and a tap target on the title/row that navigates to `task/[id]`.
- Selecting a status in the Action Sheet calls `updateTask({ id, status })` and updates the row.

### Feature 2 — WhatsApp summary shortcut

- Given I am on the home screen (web or mobile), when the page loads, then a row of two ghost buttons appears below the greeting: "מה חשוב עכשיו?" and "סכם וואטסאפ".
- The row appears after the greeting and before the "קשר שזז" attention card, so the KPI strip is not pushed off-screen on phones.
- Given I tap "סכם וואטסאפ", when the mutation is pending, then the button shows a spinner and the text "מסכם…" and is disabled. A second tap while pending is a no-op.
- Given the mutation succeeds, when the response arrives, then an `aria-live="polite"` region announces "הסיכום נשלח אליך בוואטסאפ" and clears after 4 seconds.
- Given no groups are followed, when the mutation returns `actionCount === 0`, then the region shows "עדיין אין קבוצות במעקב." with a "בחר קבוצות →" link to `/settings/whatsapp`.
- Given the bridge is disconnected or any other error, when the mutation rejects, then the region shows "הסיכום לא נשלח. בדוק שוואטסאפ מחובר בהגדרות ונסה שוב." and stays until dismissed. No raw error code is shown.
- The existing "סכם עכשיו את כל הקבוצות במעקב" button on `/settings/whatsapp` is not removed.

### Feature 3 — קיירוס "today / tomorrow" per time slot

- Given I open the schedule section for the `06_calendar_optimizer` agent in `/agents/manage`, when I add a time, then a segmented control "על: היום | מחר" is shown next to the time input. Default is "היום".
- Given I add "20:00" with "מחר" selected, when the time chip appears, then it reads "20:00 · מחר" and has `aria-label="20:00 מנתח את היומן של מחר. החלף להיום"`.
- Given I click "מחר" / "היום" on an existing chip, when saved, then the offset for that slot changes. Clicking the × removes the time slot.
- Given I save from `AgentConfigPanel`, when the mutation runs, then `agents.setSchedule` receives a `scheduleDayOffsets` map (`{ "20:00": 1 }`). Keys not in the current `scheduleTimes` are rejected.
- Given the cron fires at 20:00 for `06_calendar_optimizer`, when the slot offset is `1`, then `getAgentCalendarContext` fetches tomorrow's calendar (in `Asia/Jerusalem`) instead of today's. Other agents and "הרץ עכשיו" always use today.
- In `AgentTriggersPanel` (free-text comma-separated times in the chat sidebar), times with an offset display as "20:00 (מחר)". The panel shows: "לבחירת יום לכל שעה — ניהול סוכנים →". Saving from this panel preserves the existing offset map.
- This toggle is only shown when the agent is `06_calendar_optimizer`. All other agents are unaffected.

### Feature 4 — Hugo "what should I focus on now"

- Given I tap "מה חשוב עכשיו?" on the home screen, when the navigation runs, then the chat screen opens with agent set to Hugo and the message "סכם מה חשוב עכשיו, למה, ומה הצעד הבא" submitted exactly once.
- After submission the URL parameter is cleared (`router.replace`) so a reload or back-navigation does not re-send the message.
- On web, the `?prompt=focus` parameter is added to the `/chat` route; the chat page reads it on mount, sends the canned message, then removes the param.
- On mobile, a new `prompt=focus` parameter (distinct from the existing `message` scroll param) is added to the chat tab. The same one-shot guard (`deepLinkHandled` ref pattern) prevents double-send.
- No new prompt text is introduced in code; the Hugo default trigger message already stored in `agents-meta.ts` (`'סכם מה חשוב עכשיו, למה, ומה הצעד הבא'`) is reused.

## Data model

### `agent_schedules` — new column `schedule_day_offsets`

**`packages/database/src/schema.pg.ts`** — add to `agentSchedules` table:

```
scheduleDayOffsets: text('schedule_day_offsets').notNull().default('{}')
```

Type at runtime: `Record<string, 0 | 1>`. Key = `HH:MM` slot, value = `0` (today) or `1` (tomorrow). A slot absent from the map defaults to `0`. No migration required — the column has a default.

**`packages/database/src/schema.ts`** — mirror the same column in the SQLite Drizzle schema.

**`packages/database/src/index.ts`** — add to the SQLite bootstrap block for `agent_schedules`:

```sql
ALTER TABLE agent_schedules ADD COLUMN schedule_day_offsets TEXT NOT NULL DEFAULT '{}';
```

Wrap in a `try/catch` so it is idempotent (existing rows are unaffected; column will be `'{}'` by default).

No other schema changes. No new tables.

## tRPC API

### `agents.setSchedule` — extend input (existing procedure in `packages/api/src/routers/agents.ts`)

Add optional field:

```ts
scheduleDayOffsets: z.record(timeSchema, z.union([z.literal(0), z.literal(1)])).optional()
```

Validation: every key must be present in the merged `scheduleTimes` list; stale keys (for removed times) are silently dropped.

Service layer (`packages/api/src/services/agent-schedules.ts`):
- `setAgentSchedule` reads and writes `scheduleDayOffsets` alongside `scheduleTimes`.
- `AgentScheduleConfig` interface gains `scheduleDayOffsets: Record<string, 0 | 1>`.
- `listAgentConfigs` reads and parses the column (`JSON.parse`, default `{}`).

### `agents.list` — no change to signature

`AgentScheduleConfig` returned from `agents.list` will include `scheduleDayOffsets` once the service layer is updated.

### `whatsapp.digest.run` — no change

Already exists in `packages/api/src/routers/whatsapp.ts`. Returns `{ ok, text, actionCount, sectionCount, quietCount, error? }`. The UI reads `actionCount` to detect the "no followed groups" state.

### `tasks.update` — no change

Already accepts `status: statusEnum.optional()`. The new status popover calls this procedure directly.

### `people.getRelated` — no change

Already returns the full task array including `status`. The mobile screen needs to render it; no server change required.

## UI surface

### `apps/web/src/app/page.tsx` (dashboard home)

- Add a `<QuickActions />` client component (or inline) rendered after `<AttentionBanner />` and before the KPI strip.
- Contains two `.btn-ghost` buttons: "מה חשוב עכשיו?" and "סכם וואטסאפ".
- "סכם וואטסאפ" invokes `trpc.whatsapp.digest.run.useMutation()`. State machine: idle → loading ("מסכם…" + spinner) → success / error / no-groups. `aria-live="polite"` region below the row carries the feedback text.
- "מה חשוב עכשיו?" navigates to `/chat?prompt=focus`.

### `apps/web/src/app/chat/page.tsx` (or the ChatPanel component it contains)

- On mount, read `searchParams.get('prompt')`.
- If value is `'focus'`, call `router.replace('/chat')` immediately (so param is gone), then submit the Hugo trigger message once (guard with a `useRef` to avoid Strict Mode double-fire).

### `apps/web/src/components/people/PersonDetailDrawer.tsx`

- Add a `<StatusButton>` component (new file `apps/web/src/components/StatusButton.tsx`) that shows the current status label in its colour and opens a small popover with `TASK_STATUS_ORDER` options.
- Replace the current done-checkbox-only row layout with: `[checkbox] [title button] [StatusButton]` (right-aligned).
- On status select: call `trpc.tasks.update.useMutation()` with `{ id, status }`. Optimistic update + rollback on error.

### `apps/web/src/components/StatusButton.tsx` (new)

Reusable component:

```ts
interface StatusButtonProps {
  taskId: string
  status: string | null
  onUpdated?: (newStatus: string) => void
}
```

Uses `STATUS_LABELS`, `STATUS_COLORS`, `TASK_STATUS_ORDER` from `@ak-system/types`. Keyboard: Enter/Space opens popover, arrow keys navigate options, Enter selects, Escape closes. Focus returns to trigger on close.

### `apps/web/src/components/AgentConfigPanel.tsx`

- Show the "על: היום | מחר" segmented control only when `agentId === '06_calendar_optimizer'`.
- State: `newTimeOffset: 0 | 1`, default `0`. When "הוסף שעה" fires, store `{ time, offset }`.
- Chip renders as `"20:00 · מחר"` (or no suffix for `0`). Clicking the day label inside the chip toggles between 0 and 1 inline.
- Help text under the section header: `'בחר "מחר" כדי לקבל בערב את התוכנית ליום שאחרי ולהספיק לשנות.'`
- Save flow: serialize `scheduleDayOffsets` from chip state and include in `agents.setSchedule` call.

### `apps/web/src/components/AgentTriggersPanel.tsx`

- When `agentId === '06_calendar_optimizer'`: display times as `"20:00 (מחר)"` where offset is `1`. Below the field, add a small note: `'לבחירת יום לכל שעה — '` + a link `'ניהול סוכנים →'` pointing to `/agents/manage`.
- Do not write the `scheduleDayOffsets` map from this panel (read-only for offsets); saving times from here must preserve the existing offset map for unchanged slots.

### `apps/web/src/lib/scheduled-agents-runner.ts` and `packages/api/src/services/agent-calendar-context.ts`

- `runScheduledAgents` (or `runAgentTrigger`) reads `scheduleDayOffsets` for the fired slot when the agent is `06_calendar_optimizer`.
- Passes `planDateIso` (tomorrow's date in `Asia/Jerusalem` when offset is `1`, today otherwise) to `getAgentCalendarContext`.
- `getAgentCalendarContext` gains an optional `planDate?: string` (ISO date). When provided, uses it instead of `localTodayIso()`.

### `apps/mobile/app/(tabs)/index.tsx` (ARO home)

- Add a quick-actions row after the greeting, before the attention card: two buttons "מה חשוב עכשיו?" and "סכם וואטסאפ". Same feedback states as web.
- If both buttons don't fit on 360 pt wide, stack them vertically.
- "סכם וואטסאפ" calls the whatsapp digest REST route (same tRPC-over-fetch pattern used elsewhere in the mobile app).
- "מה חשוב עכשיו?" navigates to `/(tabs)/chat?prompt=focus&agent=<HUGO_AGENT_ID>`.

### `apps/mobile/app/person/[id].tsx`

- Add a "משימות" section that fetches `people.getRelated` (already called; use the task array).
- Render up to 10 open tasks. Each row: done checkbox + status chip + title (44 pt hit areas). "הצג הכל ({n})" navigates to the tasks tab filtered by person.
- Status chip opens an `ActionSheet` with the six statuses. Selection calls `updateTask`.
- Empty state: "אין משימות פתוחות עם {name}".

### `apps/mobile/app/(tabs)/chat.tsx`

- Read `prompt` from `useLocalSearchParams`. If value is `'focus'` and `deepLinkHandled.current !== 'focus'`, set agent to Hugo, submit the canned message, then mark `deepLinkHandled.current = 'focus'` and call `router.replace('/(tabs)/chat')` to clear the param.

## Out of scope

- Per-group "summarise now to WhatsApp" button (only the full digest).
- Changing the WhatsApp digest prompt or format.
- "Tomorrow" mode for any agent other than `06_calendar_optimizer`.
- Arbitrary date selection for קיירוס.
- "הרץ עכשיו" for קיירוס running on tomorrow's calendar.
- Changes to the main `/tasks` page.
- New status values beyond the existing six.
- Push notifications triggered from the home-screen Hugo button.

## Open questions

- None.

---

## UI/UX Review (pre-implementation)

**Verdict:** APPROVED WITH NITS  
**Detected stack:** `next-trpc-monorepo`

### Design System Checklist
- [x] Matches project tokens/classes — teal `#2dd4bf`, dark theme, `.btn-ghost`, `.card`, `STATUS_COLORS` from `@ak-system/types`
- [x] RTL layout preserved
- [x] Mobile layout — fallback to vertical stack on 360 pt screens
- [x] No unapproved UI frameworks introduced
- [x] Reuses existing components (`TaskModal`, `StatusPill` pattern, `updateTask`, `people.getRelated`)

### UX Quality Checklist
- [x] One primary action per view — ghost buttons keep home screen hierarchy intact
- [x] Cognitive load minimized — status selection is a focused popover, not a full modal
- [x] All feedback states handled — loading (spinner + "מסכם…"), success (auto-dismiss), no-groups (link to settings), bridge error (persist + human message)
- [x] Destructive actions — status change is reversible; no confirmation needed
- [x] Microcopy — verb-first buttons in Hebrew, human error messages, no raw codes
- [x] Touch targets ≥ 44 pt, keyboard navigation specified for status popover, `aria-label` on status button

### Findings
- **Nit (mobile):** Two buttons in a row on 360 pt may be tight if Hebrew labels are long. Spec includes the vertical-stack fallback.
- **Nit (web chat):** Strict Mode double-fire guard for the `prompt=focus` param is required — documented in the chat UI surface section.
- **Nit (AgentTriggersPanel):** The free-text comma-separated input cannot represent per-slot offsets, so it is read-only for offsets. Documented and linkback to `/agents/manage` specified.
