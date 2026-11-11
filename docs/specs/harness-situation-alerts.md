# Harness Situation Alerts

## Goal

Extend the Harness cross-domain reasoner with eight situational detectors that fire on system-level conditions (overloaded day, stalled project, unpaid invoice, filing deadline) rather than on a specific person. Add an email "reply-need" gate so that FYI threads are never counted as unanswered, both in the existing `unanswered_thread` detector and in the new `reply_backlog` detector.

## User stories

- As a user, I want an alert when I held meetings in the last few days but wrote no notes and opened no tasks, so that I notice follow-through gaps before they disappear.
- As a user, I want to know when tomorrow's calendar is overloaded or has conflicting meetings, so that I can reschedule in advance.
- As a user, I want to see my own commitments that have a due date but no linked task, so that I do not forget things I promised.
- As a user, I want a single card when several commitments are sitting in `proposed` state for days without a decision, so that I clear my queue.
- As a user, I want an alert when an issued invoice has not been paid past its due date, so that I follow up on outstanding receivables.
- As a user, I want to know when a project that was recently active has gone quiet, so that I can check in.
- As a user, I want a single summary card when several emails and WhatsApp conversations are waiting for a reply, so that I am not overwhelmed by individual reminders.
- As a user, I want a reminder when the bimonthly VAT filing window is open, so that I do not miss the deadline.
- As a user, I want the Harness not to flag FYI emails as unanswered, so that email noise does not create false urgency.

## Acceptance criteria

### Eight new detectors

- **Given** one or more meetings from the past 3 days have at least one attendee in `meeting_people`, AND those meetings have no `meetings.notes`, no linked `meeting_notes` row, and no `tasks.meeting_id` row, **when** the Harness cron runs, **then** a single `meeting_no_followthrough` insight card appears on the dashboard.

- **Given** the `meetings` table contains meetings today or tomorrow that overlap (same `time`/`end_time` range), OR a day has 6 or more meetings, OR a day's total meeting duration is 5 hours or more, **when** the Harness cron runs, **then** a single `calendar_overload` card is emitted for the earliest such day. Severity is `urgent` if there is a true time conflict, `attention` otherwise. Meetings without `end_time` are skipped.

- **Given** one or more rows in `commitments` have `owner = 'me'`, empty `task_id`, status `proposed` or `accepted`, and `due_inferred` within 7 days in the past or 7 days in the future, **when** the Harness cron runs, **then** a single `commitment_due_no_task` card is emitted. Severity is `urgent` if any row is already past due, `attention` otherwise. These rows are excluded from the existing `stale_commitment` count to avoid double-counting.

- **Given** 3 or more rows in `commitments` have `status = 'proposed'` and were created 3 or more days ago, and are not already covered by `commitment_due_no_task`, **when** the Harness cron runs, **then** a single `proposed_commitment_pile` card is emitted with severity `attention`.

- **Given** one or more rows in `sales_documents` have `status = 'issued'`, `doc_type != 'credit_invoice'`, and the sum of `sales_document_payments.amount` for that document is less than `total`, AND either `due_date` has passed or (`due_date` is null AND `issue_date` is older than 30 days), **when** the Harness cron runs, **then** a single `unpaid_invoice` card is emitted. Severity is `urgent` if any document is more than 14 days past due, `attention` otherwise.

- **Given** one or more rows in `projects` had at least one meeting or task update between 21 and 90 days ago, AND have had no meeting or task update in the past 21 days, **when** the Harness cron runs, **then** a single `project_gone_quiet` card is emitted listing up to 3 project names. Severity `attention`.

- **Given** the sum of (email threads that pass the reply-need gate and are 5 or more days old) plus (WhatsApp DM conversations where the last `whatsapp_dm_messages` row has `from_me = false` and is 2 or more days old) is 3 or more, **when** the Harness cron runs, **then** a single `reply_backlog` card is emitted. Severity `attention`.

- **Given** the current date is in the first 19 calendar days of a month that opens a new bimonthly VAT period (January, March, May, July, September, November), **when** the Harness cron runs, **then** a single `vat_filing_window` card is emitted for the period that just closed. The body includes the count of `vat_entries` rows for that period. Severity is `urgent` in the last 3 days before day 19, `attention` otherwise. The `dedupeKey` is `vat_filing_window:<year>:<period>` so a dismissed card does not reappear in the same filing window.

### Reply-need gate for `unanswered_thread`

- **Given** a `person_email_threads` row has `from` matching the noreply/bot pattern from `packages/api/src/lib/calendar-participants.ts`, **when** the Harness evaluates it, **then** the thread is excluded from `unanswered_thread` regardless of `message_count`.
- **Given** a thread's `subject` or `snippet` contains any of: `FYI`, `לידיעה`, `לעיונך`, `לעיון`, `newsletter`, `unsubscribe`, **when** evaluated, **then** the thread is excluded.
- **Given** a thread has a linked `commitments` row with `source = 'email'` pointing to that thread, **when** evaluated, **then** the thread is included without calling Gemini.
- **Given** a thread's `subject` or `snippet` contains a question mark, `תוכל`, `אפשר`, `אשמח`, or `please` (case-insensitive), **when** evaluated, **then** the thread is included without calling Gemini.
- **Given** a thread passes none of the above rules, **when** `GEMINI_API_KEY` is set, **then** a single Gemini call classifies the thread as `needs_reply`, `fyi`, or `chatter`. Only `needs_reply` is included. If the call fails or the key is absent, the thread is excluded (no alert is better than a false alarm).
- **Given** a thread is classified, **when** the classification is written to `reply_need` on `person_email_threads`, **then** a subsequent Harness run does not call Gemini again unless the thread's `date` has changed since `reply_need_at`.
- **Given** the gate returns `needs_reply` for a thread, **when** that thread's person also has an upcoming meeting, **then** the thread is still eligible for `unanswered_thread`; the gate result does not change the existing person-meeting correlation logic.

### Push notification changes

- **Given** the Harness cron runs and finds new `urgent` insights, **when** pushing, **then** it behaves as today: up to 5 urgent cards.
- **Given** no new `urgent` insights exist but new `attention` insights from the 8 new situation kinds exist with `notified_at` null, **when** pushing, **then** up to 3 of them are pushed (in addition to the current single-attention fallback which is removed). Person-scoped detectors are not pushed unless they reach `urgent`.
- **Given** a card is pushed, **when** `notified_at` is stamped, **then** it is not pushed again on the next run.

### Widget source labels

- **Given** an insight's `kind` is one of the 8 new kinds, **when** displayed in `HarnessWidget`, **then** the source chip label reads the appropriate Hebrew string: `meeting_no_followthrough` → "פגישה ללא המשך", `calendar_overload` → "יום ביומן", `commitment_due_no_task` → "התחייבות ללא משימה", `proposed_commitment_pile` → "תור להחלטה", `unpaid_invoice` → "חשבונית פתוחה", `project_gone_quiet` → "פרויקט שקט", `reply_backlog` → "תור תשובות", `vat_filing_window` → "מע\"מ".

### No regression on existing detectors

- **Given** the five existing detectors (`silent_before_meeting`, `cooling_with_open_loop`, `stale_commitment`, `spend_spike_vs_meetings`, `unanswered_thread`) exist, **when** the new code is deployed, **then** all five continue to fire under their current conditions with the sole change that `unanswered_thread` now passes threads through the reply-need gate before including them.

## Data model

### `person_email_threads` — two new columns

Add to both `packages/database/src/schema.pg.ts` and `packages/database/src/schema.ts`. Additive only; no backfill required (existing rows start with `null` and are classified on the next cron run).

| column | type | notes |
|---|---|---|
| `reply_need` | `text` nullable | `needs_reply` \| `fyi` \| `chatter` \| null |
| `reply_need_at` | `text` nullable | ISO timestamp of last classification |

Add the SQLite bootstrap `ALTER TABLE IF NOT EXISTS` statements to `packages/database/src/index.ts` following the existing pattern for nullable columns.

No changes to any other table. All new insight kinds write into the existing `harness_insights` table.

### Constant in reasoner

Add `VAT_FILING_DAY = 19` as a named constant at the top of `packages/api/src/services/harness-reasoner.ts`, next to the existing threshold constants.

## tRPC API

No new procedures. All new detectors write to `harness_insights` through the existing `reasonAndPersist` flow in `packages/api/src/services/harness-reasoner.ts`. The `harness.insights` query, `harness.worldState`, and `harness.dismissInsight` procedures in `packages/api/src/routers/harness.ts` require no changes.

The email sync service `packages/api/src/services/email-sync.ts` gains one helper, `classifyReplyNeed(subject, snippet, commitmentLinked)`, that encapsulates the gate logic. The function is called from `syncEmailThreads` only for rows where `reply_need` is null or `date` has changed since `reply_need_at`.

The Harness cron `apps/web/src/app/api/cron/harness-insights/route.ts` changes the push selection: push up to 5 urgent + up to 3 unpushed attention from the 8 situation kinds (kind in the new set), ordered by `score desc`.

## UI surface

### `apps/web/src/components/HarnessWidget.tsx`

Extend `SOURCE_KIND_LABEL` (line 40) with entries for the 8 new `kind` values. The rest of the widget — card rendering, dismiss button, severity colours — is unchanged.

### No new routes or pages

The dashboard already mounts `HarnessWidget`. No new `app/<area>` routes are needed.

## Out of scope

- "System blind" alerts (stale bank sync, calendar sync lag, WhatsApp bridge disconnected).
- Duplicating the finance insights engine, task reminder cron, or morning briefing.
- A new mobile screen. Push notifications already reach the mobile app.
- Reply-need classification for WhatsApp DMs. The `from_me = false` heuristic is sufficient there.
- Per-sender learned preferences (that is the email-assistant agent's concern, not the Harness).
- Any change to `harness_nodes` or `harness_edges` tables.

## Open questions

- `meeting_no_followthrough`: should solo meetings (no attendees in `meeting_people`) be excluded, or included? Current spec includes them if they have no notes or tasks.
- `calendar_overload`: should all-day events be excluded from the duration calculation? Current spec: yes, skip events without `end_time`.
- `vat_filing_window`: the 19th-of-month deadline is standard for bi-monthly reporters. If the user switches to monthly reporting in the future, this constant should become a user setting.
