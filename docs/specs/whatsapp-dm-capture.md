# WhatsApp 1:1 Direct Message Capture

**Stack:** `next-trpc-monorepo`  
**Slug:** `whatsapp-dm-capture`  
**Status:** Draft  
**Created:** 2026-09-24  
**Depends on:** `person-context-hierarchy` (person card must exist first)

---

## Goal

Capture allowlisted WhatsApp 1:1 chats and fold them into the same person context card established in `person-context-hierarchy`, so direct conversations with tracked people appear alongside Notion meetings and group chat in one place.

## User Stories

- As the owner, I want to opt in specific people for WhatsApp 1:1 capture, so only chats I mark are saved, not every contact.
- As the owner, I want 1:1 WhatsApp messages to appear in the same "since last meeting" and "older WhatsApp" sections as group messages, so I have one conversation view per person regardless of channel.
- As the owner, I want a nightly or on-demand summary of active 1:1 chats proposing commitments I made or was given, so nothing disappears into chat history.
- As the owner, I want to confirm proposed commitments before they become tasks, so I control what enters my task list.
- As the owner, I want 1:1 messages to respect the same retention as group messages (raw expires after 90 days unless pinned, summaries stay), so privacy defaults are consistent.

## Acceptance Criteria

### Allowlist and capture

- Given a person with `captureWhatsapp: true` or a `person_external_ids` row with provider `whatsapp`, when a 1:1 message arrives from that JID at the bridge, then the bridge persists it to the database (same table or similar structure as group messages).
- Given a person without capture enabled, when a 1:1 message arrives from their JID, then the bridge ignores it (existing behavior).
- Given I enable capture on a person, when the next message arrives, then capture starts from that message forward (no retroactive backfill).

### Person card integration

- Given a person with captured 1:1 messages, when I open their person card, then 1:1 messages appear in "WhatsApp since last meeting" alongside any group messages where they were matched as a sender.
- Given multiple WhatsApp sources (1:1 + groups) for the same person, when the card loads, then messages are merged chronologically and the source (DM vs. group name) is shown on each snippet.
- Given older 1:1 messages beyond the "since last meeting" window, when the card loads, then those appear in the "older WhatsApp" collapsed section.

### Summary and proposed commitments

- Given one or more people with active 1:1 chats (messages in the last 7 days), when the nightly digest cron runs (`/api/cron/whatsapp-dm-summary` or extend existing digest), then a Hebrew summary is generated per active chat.
- Given the summary detects commitments (e.g., "אני אשלח לך", "תבדוק", "אני אטפל"), when the summary completes, then proposed `commitments` rows are created with status `proposed`, linked to the person and the source message.
- Given proposed commitments exist for me, when I open the commitments review queue (new page or modal), then I see each proposed commitment with context (who, what, when inferred if stated, source snippet) and actions: "קבל" (accept → create task), "דחה" (dismiss).
- Given I accept a commitment, when the action completes, then a normal task is created (with Notion write-back if the person/project is Notion-linked), and the commitment status becomes `accepted`.
- Given I dismiss a commitment, when the action completes, then the commitment status becomes `dismissed` and it stays on the person's timeline as a quote but not a task.

### Privacy and retention

- Given a 1:1 message older than 90 days and not pinned, when the retention cron runs (`/api/cron/whatsapp-message-retention` extended), then the raw `text` is cleared and replaced with `[expired]`.
- Given a message is pinned (via a future pin action or linked to a task/meeting), when retention runs, then that message's text is preserved.
- Given a summary was generated from expired messages, when the card loads, then the summary remains visible but the raw messages show `[expired]`.

## Data Model

Changes in **both** `packages/database/src/schema.ts` (SQLite) and `packages/database/src/schema.pg.ts` (Postgres). Export new types. Add SQLite bootstrap in `packages/database/src/index.ts`.

### Changes to `people`

Add:
- `captureWhatsapp` (boolean/integer, notNull, default false) — opt-in flag for 1:1 capture

### New table: `whatsapp_dm_messages`

(Or extend `whatsapp_messages` with a `channel` column: `group` | `dm`. Decision: new table for clean separation, since `groupJid` semantics differ.)

Columns:
- `id` (text, pk)
- `personId` (text, FK → `people.id`, `onDelete: cascade`, indexed)
- `whatsappJid` (text, notNull) — the other party's JID
- `waMessageId` (text, notNull)
- `fromMe` (boolean/integer, notNull) — true if I sent it, false if received
- `text` (text, notNull)
- `ts` (integer, notNull) — Unix timestamp ms
- `meetingId` (text, nullable, FK → `meetings.id`, `onDelete: set null`) — linked when within 3 days of a meeting with that person
- `pinned` (boolean/integer, notNull, default false)
- `createdAt` (text, notNull)

Indexes: on `personId`, on `ts`, unique on `(waMessageId, whatsappJid)`.

### New table: `commitments`

Columns:
- `id` (text, pk)
- `personId` (text, FK → `people.id`, `onDelete: cascade`, indexed)
- `owner` (text, notNull) — `me` | `them`
- `content` (text, notNull)
- `dueInferred` (text, nullable) — ISO date if mentioned ("מחר", "ביום ד")
- `source` (text, notNull) — `whatsapp_dm` | `whatsapp_group` | `meeting_analysis` | `email`
- `sourceId` (text, nullable) — message or analysis ID
- `status` (text, notNull, default `proposed`) — `proposed` | `accepted` | `dismissed`
- `taskId` (text, nullable, FK → `tasks.id`, `onDelete: set null`) — created task if accepted
- `createdAt` (text, notNull)
- `updatedAt` (text, notNull)

Indexes: on `personId`, on `status`, on `taskId`. Export `COMMITMENT_STATUSES`, `COMMITMENT_SOURCES`, `COMMITMENT_OWNERS`.

### Changes to `whatsapp_messages`

Add:
- `pinned` (boolean/integer, notNull, default false)

Migration: all additive. No data loss.

## tRPC API

### Extend router: `people` (`packages/api/src/routers/people.ts`)

- **`update`** (mutation) — add `captureWhatsapp?: boolean` to input Zod schema

### New router: `commitments` (`packages/api/src/routers/commitments.ts`)

All procedures `protectedProcedure`.

- **`listProposed`** (query)
  - Input: `{ owner?: 'me' | 'them' | 'all' }` (default `all`)
  - Returns: `Commitment[]` with status `proposed`, ordered by `createdAt` desc

- **`accept`** (mutation)
  - Input: `{ commitmentId: z.string().min(1), taskTitle?: z.string(), taskDueDate?: z.string(), taskProjectId?: z.string() }`
  - Creates a `tasks` row (with optional overrides from input), Notion write-back if applicable, updates commitment status to `accepted`, links `taskId`
  - Returns: `{ taskId: string }`

- **`dismiss`** (mutation)
  - Input: `{ commitmentId: z.string().min(1) }`
  - Updates commitment status to `dismissed`
  - Returns: `{ dismissed: boolean }`

- **`listForPerson`** (query)
  - Input: `{ personId: z.string().min(1), status?: 'proposed' | 'accepted' | 'dismissed' }` (default all)
  - Returns: `Commitment[]` for that person

### Extend router: `whatsapp` (`packages/api/src/routers/whatsapp.ts`)

- **`dm.list`** (query)
  - Input: `{ personId: z.string().min(1), sinceMeetingDate?: z.string(), limit?: z.number() }` (default 50)
  - Returns: `{ messages: WhatsAppDmMessage[], hasMore: boolean }`

- **`dm.pin`** (mutation)
  - Input: `{ messageId: z.string().min(1) }`
  - Sets `pinned: true` on `whatsapp_dm_messages` or `whatsapp_messages`
  - Returns: `{ pinned: boolean }`

### Extend router: `insights` (`packages/api/src/routers/insights.ts`)

- **`personContext`** (query) — extend return to merge DM messages into `whatsappSinceMeeting` and `olderWhatsapp` arrays alongside group snippets

## UI Surface

### Person management: `apps/web/src/app/people/page.tsx` and detail drawer

- Add a toggle in the person form or drawer settings: "תיעוד וואטסאפ 1:1" (default off)
- When toggled on, save `captureWhatsapp: true`

### Person card: `apps/web/src/components/people/PersonContextCard.tsx`

(Already created in `person-context-hierarchy`.)

- Extend to merge 1:1 messages into the WhatsApp sections
- Show source badge on each snippet: "DM" or group name
- **Warmth badge:** when `warmthTrend` is `cooling` or `warming`, show a badge next to the recommendation:
  - `cooling`: yellow badge "מתקרר" with a trend-down icon
  - `warming`: green badge "מתחמם" with a trend-up icon
- **Warmth detail modal:** clicking the badge opens a timeline chart showing sentiment per interaction over the last 180 days, with tooltips showing the interaction type and date

### Sentiment timeline component: `apps/web/src/components/people/SentimentTimeline.tsx` (new)

- Line chart (or bar chart) with X-axis = date, Y-axis = sentiment (-1 to 1)
- Interaction types shown with different colors: meeting (gold), WhatsApp (green), email (blue)
- Hovering a point shows: date, interaction type, sentiment score, link to the source (meeting page, WhatsApp snippet, email thread)
- Horizontal line at 0.0 (neutral baseline)
- Shaded region for recent 90 days vs. older 90 days to visualize the comparison window

### New page: `apps/web/src/app/commitments/page.tsx`

List view of proposed commitments. Filters: "שלי" (owner `me`), "שלהם" (owner `them`), "הכול".

Each row:
- Person name + avatar
- Commitment text
- Source snippet (first 80 chars of the message or analysis)
- Inferred due date if present
- Actions: "קבל" (opens task quick-create modal with pre-fill), "דחה"

Empty state: "אין התחייבויות ממתינות"

### Task quick-create modal: `apps/web/src/components/tasks/TaskQuickCreateModal.tsx` (new or extend existing)

Pre-filled with:
- `title` = commitment content
- `assigneeId` = me if owner `me`, the person if owner `them`
- `dueDate` = inferred or today
- `projectId` = person's primary project if one exists

User can edit before confirming.

### Mobile

- `apps/mobile/app/people/[id].tsx` — person form gains the capture toggle
- `apps/mobile/app/commitments.tsx` — new tab or screen, same list as web
- Person context card already merges 1:1 messages (same tRPC query)

## Out of Scope

- Retroactive backfill of past 1:1 messages (capture starts from enable forward)
- Auto-accepting commitments without user review
- Capturing every 1:1 chat by default (must be opt-in per person)
- Email commitments or voice commitments (step 3)
- A separate WhatsApp inbox UI (all chats appear on the person card)
- Sentiment analysis or conversation scoring beyond commitment detection

## Open Questions

None blocking. Default behavior:
- Commitment detection uses a simple heuristic (Hebrew action verbs: "אשלח", "תבדוק", "אטפל") plus an LLM call for ambiguous cases, similar to meeting analysis action item extraction.
- Summaries run nightly via the existing `/api/cron/whatsapp-group-summary` extended or a new `/api/cron/whatsapp-dm-summary`.
- Retention window is 90 days (matches existing group message retention).
