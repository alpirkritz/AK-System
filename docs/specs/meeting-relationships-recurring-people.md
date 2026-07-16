# Meeting Relationships, Recurring Series, Types & People Review

Detected stack: `next-trpc-monorepo`

## Goal

Group recurring/weekly meetings into a shared series, add a user-managed meeting type
(1:1, strategy, operations, ...), give each person a relationship view with cadence and all
their associated tasks, and replace silent creation of unknown calendar attendees with a
review/confirm queue.

## User stories

- As the owner, I want weekly meetings to be grouped into one series so I see history and
  keep shared notes across instances instead of a flat list of duplicates.
- As the owner, I want to tag each meeting with a type I define (1:1, strategy, operations),
  so I can filter and understand the purpose of a meeting at a glance.
- As the owner, I want a 1:1 to simply be `type = 1:1` with one participant, without a
  special field.
- As the owner, I want unknown attendees from calendar invites to land in a review queue so
  my CRM is not polluted with half-identified stubs.
- As the owner, I want to confirm, merge, or ignore each unknown attendee, so I control who
  becomes a real contact.
- As the owner, when I open a person, I want to see all tasks associated with them (assignee
  or linked) plus their meeting cadence, so I have one place for that relationship.
- As the owner, I want Apple/Exchange attendees handled the same way as Google, so coverage
  is consistent.

## Acceptance criteria

- Given a Google recurring event with a `recurringEventId`, when calendar sync runs, then all
  its instances share one `meeting_series` row (`seriesId` set on each instance).
- Given a manual meeting with `recurring = weekly`, when it is created or updated, then it is
  attached to a `meeting_series` (created if none matches its title + recurrenceDay).
- Given the meetings list, when I open a series, then I see the shared people, rolling series
  notes, and the ordered instances (past and upcoming).
- Given I edit series notes, when I save, then the notes persist on the series and are shown
  for every instance.
- Given meeting types exist, when I open the meeting form, then I can pick a type; and I can
  add/rename/recolor/delete types under settings.
- Given a type is deleted, when the delete completes, then meetings previously using it have
  `typeId` set to null (not deleted).
- Given calendar sync encounters an attendee email not matching a `confirmed` person, when it
  runs, then a `people` row is created/kept with `status = unconfirmed` and `source =
  calendar`, and it does not appear in the default CRM list.
- Given the review queue, when I confirm a person, then `status = confirmed` and they appear
  in the CRM list.
- Given the review queue, when I merge person A into person B, then A's `meeting_people` and
  task links move to B and A is deleted.
- Given the review queue, when I ignore a person, then `status = ignored` and they are
  excluded from the CRM list, agent context, and future review prompts.
- Given a person, when I open their drawer, then I see all their tasks (assignee + linked),
  their meetings, and a cadence label (e.g. "weekly, 8 of last 8 weeks") when detectable.
- Given calendar sync with Apple attendees present, when it runs, then Apple attendees are
  matched/queued the same as Google (when attendee data is available).

## Data model

Additive changes in BOTH `packages/database/src/schema.ts` (SQLite) and
`packages/database/src/schema.pg.ts` (Postgres). Also export new types from the SQLite schema
bottom section (mirrors existing `Person`/`Meeting` exports).

- New `meeting_series`:
  - `id` (text, pk), `title` (text, notNull), `cadence` (text, e.g. `weekly`), `recurrenceDay`
    (text, nullable), `rollingNotes` (text, nullable), `googleRecurringEventId` (text,
    nullable, indexed), `createdAt`/`updatedAt` (text, notNull).
- New `meeting_types` (mirrors `projects` shape):
  - `id` (text, pk), `name` (text, notNull), `color` (text, default `#8b5cf6`),
    `createdAt`/`updatedAt` (text, notNull).
- `meetings` — add:
  - `seriesId` (text, FK `meeting_series.id`, `onDelete: set null`, indexed).
  - `typeId` (text, FK `meeting_types.id`, `onDelete: set null`, indexed).
- `people` — add:
  - `status` (text, notNull, default `confirmed`) — one of `confirmed|unconfirmed|ignored`.
  - `source` (text, notNull, default `manual`) — one of `manual|calendar|notion`.

Migration notes: additive only. Defaults make existing rows `confirmed`/`manual`, so current
behavior of the CRM list is preserved. Run `pnpm db:push` (SQLite) after schema edits.
Add a `PEOPLE_STATUSES` const to the schema for reuse (like `MEETING_CATEGORIES`).

## tRPC API

Add one new router `meetingTypes` (justified: independent CRUD entity like `projects`) and
extend `meetings` + `people`. Register `meetingTypes` in `packages/api/src/index.ts`.

New router `packages/api/src/routers/meeting-types.ts` — `meetingTypes`:
- `list` (query): no input -> array of types ordered by name. Auth: protected.
- `create` (mutation): input `{ name: string; color?: string }` -> created row. Auth: protected.
- `update` (mutation): input `{ id: string; name: string; color?: string }` -> row. Auth: protected.
- `delete` (mutation): input `{ id: string }` -> `{ ok: true }`; first sets `meetings.typeId`
  null where it referenced this type. Auth: protected.

Extend `packages/api/src/routers/meetings.ts`:
- `create`/`update` inputs gain `typeId: z.string().nullable().optional()`; persisted on the row.
- `listSeries` (query): no input -> series with their instance ids, shared people ids, and
  next/last instance dates.
- `getSeries` (query): input `{ id: string }` -> series row + ordered instances + union of
  people ids across instances.
- `updateSeriesNotes` (mutation): input `{ id: string; rollingNotes: string }` -> updated row.
- `syncFromCalendar`: group Google events by `recurringEventId` into `meeting_series` and set
  `seriesId`; attach manual `recurring` meetings to a series; extend attendee handling to
  Apple events; create/keep unmatched attendees as `status = unconfirmed`, `source =
  calendar` (never silently `confirmed`); match existing people case-insensitively by email.

Extend `packages/api/src/routers/people.ts`:
- `list`/`listPaginated`: default to `status = confirmed` unless an explicit
  `includeStatuses` input is passed (so review queue can request `unconfirmed`).
- `reviewQueue` (query): no input -> `unconfirmed` people with their attendee email,
  occurrence count (meetings linked), and a suggested existing match by email/name.
- `confirm` (mutation): input `{ id: string }` -> sets `status = confirmed`.
- `ignore` (mutation): input `{ id: string }` -> sets `status = ignored`.
- `merge` (mutation): input `{ fromId: string; toId: string }` -> repoints `meeting_people`
  and `task_people` and `tasks.assigneeId` from `fromId` to `toId` (dedupe links), deletes
  `fromId`. Auth: protected.
- `getRelated`: extend result with a `cadence` field per detectable series and keep returning
  all tasks (assignee + linked) — this powers the person view's associated tasks list.

## UI surface

Routes/components under `apps/web/src/`:

- `app/meetings/page.tsx` — add a type filter chip row (from `meetingTypes.list`) alongside
  the existing recurring filter; group series-linked meetings under a collapsible series
  header (title, cadence pill, shared avatars). Add a type badge to `renderMeetingCard`.
- `components/Modals/MeetingModal.tsx` — add a Type `select` (options from `meetingTypes.list`,
  plus "ללא סוג"); include `typeId` in create/update payloads.
- `app/meetings/[id]/page.tsx` — show a type badge and, when part of a series, a "סדרה" card
  linking sibling instances and showing/editing `rollingNotes` via `updateSeriesNotes`.
- `components/people/PersonDetailDrawer.tsx` — show the cadence label in the meetings section
  and render the full associated-tasks list (assignee + linked) rather than a capped preview.
- `app/people/page.tsx` + `components/people/usePeopleState.ts` — add a "לאישור" (review)
  tab/filter that lists `people.reviewQueue`; each row has confirm / merge / ignore actions,
  with a person picker (reuse `people.search`) for merge.
- `app/settings/page.tsx` — add a "סוגי פגישות" `Section` to manage meeting types
  (list + add + rename + recolor + delete), matching the existing `Section`/`Row` pattern.

## Out of scope

- Transcription/recordings ingestion and embeddings/RAG (deferred per the strategic review at
  `docs/notion-vs-ak-system-review.md`).
- No calendar write-back to Google/Apple.
- No change to the existing `category` field (`work|family|general`) semantics.
- No dedicated 1:1 "primary person" field — a 1:1 is `type = 1:1` with one participant.
- No auto-enrichment of unknown attendees from Notion in this iteration.

## Open questions

- None.
