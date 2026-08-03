## Detected stack: next-trpc-monorepo

## Goal

Fix two usability gaps in the mobile task-creation form (no real date picker, keyboard covers fields), add a personal reading-list (bookmarks) feature to mobile and web, and add a chat tool that routes a user's spoken/typed correction about an automated flow to the right specialist agent by logging it for human review — without ever auto-editing an agent's own definition file.

## User stories

- As the user, I want to pick the task due date from a real calendar picker on mobile instead of typing `YYYY-MM-DD`, so that I don't create malformed dates.
- As the user, I want the on-screen keyboard to never cover the due-date field or the save button when adding a task on mobile, so that I can complete the form without dismissing the keyboard first.
- As the user, I want to save an interesting link with a title to a personal reading list from either app, so that I don't lose it.
- As the user, I want to mark a reading-list item as read or delete it, so that the list stays relevant.
- As the user, I want to tell the chat "this was wrong, fix it for next time" about a specific automated flow (morning brief, calendar, email, etc.), so that the correction reaches the right agent's backlog without me manually finding the right file.
- As the user, I want confirmation that my correction was logged and is pending review, not that it silently changed agent behavior.

## Acceptance criteria

1. Given the mobile "add task" sheet is open, when I tap the due-date field, then a native date picker opens (not a text keyboard) and the chosen date is saved in the existing `YYYY-MM-DD` string format.
2. Given the mobile "add task" sheet is open and the keyboard is showing, when I focus any field, then that field and the save button remain visible above the keyboard.
3. Given I open the reading list (mobile or web) with zero items, when the screen loads, then I see an empty-state message and a way to add the first item — not a blank screen.
4. Given I submit a URL that doesn't start with `http://`/`https://`, when I tap save, then I see an inline Hebrew validation error and the item is not saved.
5. Given I add a valid URL + title, when I save, then the item appears at the top of the list as unread.
6. Given an item is unread, when I toggle "mark as read", then its status flips and persists after a reload.
7. Given I tap delete, when I confirm the destructive-action prompt, then the item is removed; if I cancel, nothing changes.
8. Given I tell the chat about a problem with a specific automated flow, when the model identifies the matching agent, then a new entry is appended to `M_Memory/agents_daily_sync.md` (existing template, append-only) with `Status: Blocked` and the raw feedback under "Blockers / Escalations", and the assistant's reply tells me it's queued for manual review.
9. Given the model cannot confidently match a specific agent, when it logs the feedback, then it falls back to `01_Hugo_orchestrator` / general and still confirms back to the user.
10. Given the feedback tool runs, then no file under `A_Agents/` is modified.

## Data model

New table, single-tenant (no `userId` anywhere in the schema today — confirmed absent from both `packages/database/src/schema.pg.ts` and `packages/database/src/schema.ts`; `tasks.workspaceId` is an org tag, not a user tenant, and is not reused here since bookmarks aren't org-scoped).

Add to **both** `schema.pg.ts` and `schema.ts` (SQLite), same shape as `feedItems`:

```ts
export const readingListItems = pgTable('reading_list_items', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  note: text('note'),
  status: text('status').notNull().default('unread'), // 'unread' | 'read'
  createdAt: text('created_at').notNull(),
  readAt: text('read_at'),
})
```

Migration: additive only (new table, no changes to existing tables). Generate via the existing drizzle-kit flow used for prior migrations in `packages/database`.

No changes to `tasks` table — the date picker only changes the mobile client's input widget; the `dueDate` string format persisted via `tasks.create`/`tasks.update` (`packages/api/src/routers/tasks.ts`) is unchanged.

## tRPC API

New router `packages/api/src/routers/readingList.ts`, mounted as `readingList: readingListRouter` in `packages/api/src/index.ts` (next to `feed: feedRouter`). One new top-level area is justified because bookmarks are a distinct resource not fitting `tasks`, `feed` (RSS-sourced, not user-saved), or any existing router.

All procedures `protectedProcedure` (matches `feedRouter` convention):

- `list` — query. Input: `{ status: z.enum(['unread','read','all']).default('all') }`. Returns: `readingListItems[]` ordered by `createdAt desc`.
- `create` — mutation. Input: `{ url: z.string().url(), title: z.string().min(1), note: z.string().optional() }`. Returns: created row.
- `markRead` — mutation. Input: `{ id: z.string(), read: z.boolean() }`. Returns: updated row.
- `delete` — mutation. Input: `{ id: z.string() }`. Returns: `{ success: true }`.

## Chat tool (conversation-engine)

New Gemini function-calling tool in `apps/web/src/lib/conversation-engine.ts`, declared alongside `remember`/`update_instruction` (~line 150-184) and dispatched in the `executeTool` switch (~line 489+). Shared by mobile and web chat since both call the same backend (`apps/web/src/app/api/chat/route.ts` → `resolveIntent`).

- Tool name: `log_agent_feedback`.
- Input: `{ agentId: enum(['01_Hugo_orchestrator','02_agent_trainer','03_morning_briefing','04_meeting_prep_herald','05_ibkr_daily_import','06_calendar_optimizer','07_email_assistant','08_startup_coo']), feedback: string }`. Reuses the same 8 agent ids already listed for `run_abc_agent` (~line 1002-1018) so classification stays consistent.
- System prompt instructs: when the user describes a correction/complaint about a specific automated flow's behavior, call this tool with the best-guess `agentId` (default `01_Hugo_orchestrator` if ambiguous) and the verbatim feedback text.
- Handler: appends one new entry to `M_Memory/agents_daily_sync.md` using the file's existing template (lines 15-48) — `Status: Blocked`, feedback text under **Blockers / Escalations**, a note that it is user-submitted and awaiting manual review. Append-only; never edits `A_Agents/*.md`.
- Returns `{ loggedTo: agentId, pendingReview: true }` so the model can phrase a confirmation, e.g. "נרשם לטיפול ב-06_calendar_optimizer — ייבדק ידנית ולא יופעל אוטומטית."

## UI surface

### Mobile — task form (`apps/mobile/app/task/[id].tsx`)

- Replace the free-text `dueDate` `TextInput` (~line 254-264) with a pressable field opening `@react-native-community/datetimepicker` (new dependency — requires inclusion in the next EAS build). Selected `Date` formats to the existing `YYYY-MM-DD` string. Add a small "נקה תאריך" (clear date) text action, shown only when a date is set.
- Wrap the existing `ScrollView` form in `KeyboardAvoidingView` (`behavior="padding"`), same pattern as `apps/mobile/app/(tabs)/chat.tsx` (~line 142-146); adjust `keyboardVerticalOffset` for the `formSheet` presentation context.

### Mobile — reading list (new)

- New screen `apps/mobile/app/reading-list.tsx`, registered as a stack screen in `apps/mobile/app/_layout.tsx` (same pattern as `notifications`/`settings`).
- Entry point: new header icon in `apps/mobile/app/(tabs)/_layout.tsx` (same pattern as the existing `⚙️`/`🔔` icons, ~line 9-19 / 39-47) — no new tab, keeps the 5-tab bar intact.
- Empty state: "אין עדיין פריטים ברשימת הקריאה. הדבק קישור ותן לו כותרת כדי להתחיל." + primary button "הוסף קישור".
- Add form: fields "קישור" (placeholder `https://...`), "כותרת", optional "הערה"; button "שמור לרשימה" (disabled while saving).
- Validation error (inline, red text): "כתובת לא תקינה — ודא שהיא מתחילה ב-http:// או https://".
- Save failure: "שמירה נכשלה — נסה שוב".
- Each row: title + domain, a "סמן כנקרא" / "סמן כלא נקרא" toggle, and a delete action gated by a confirmation prompt: "למחוק את הפריט הזה? לא ניתן לשחזר." with "מחק" (destructive) / "ביטול".
- Loading: spinner while `readingList.list` is in flight.

### Web — reading list (new)

- New page `apps/web/src/app/reading-list/page.tsx`, following the structure of `apps/web/src/app/updates/page.tsx` and using `.card`/`.input`/`.btn`/`.btn-primary`/`.btn-danger` design-system classes from `apps/web/src/app/globals.css`.
- Nav link added to `apps/web/src/components/DashboardLayout.tsx` alongside existing nav items.
- Same copy, empty/error/confirm states as mobile (single source of truth for microcopy — see above).

### Web — task modals (no change)

`apps/web/src/components/QuickAddTaskModal.tsx` and `apps/web/src/components/Modals/TaskModal.tsx` already use native `<input type="date">`, which is a real date picker. No functional change; verified during UI review below.

## Out of scope

- Auto-fetching link metadata (title/image/favicon) for reading-list items — user types the title manually.
- A new bottom tab for the reading list — uses a header-icon entry point instead.
- Any change to `apps/web`'s keyboard/scroll handling — no reported bug, browsers already scroll focused inputs into view.
- Directly editing any file under `A_Agents/` from the chat tool — corrections are logged to `M_Memory/` only, for human review.
- Per-user tenancy / multi-user auth — system remains single-tenant.
- Changing the `tasks` table schema or the `tasks.create`/`update` API shape.

## Open questions

(none)
