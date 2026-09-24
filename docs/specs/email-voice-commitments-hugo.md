# Email Archive, Voice Capture, and Hugo Commitment Integration

**Stack:** `next-trpc-monorepo`  
**Slug:** `email-voice-commitments-hugo`  
**Status:** Implemented (see Implementation Decisions; native mobile recorder pending)  
**Created:** 2026-09-24  
**Depends on:** `person-context-hierarchy`, `whatsapp-dm-capture` (person card and commitments table must exist first)

---

## Goal

Add email threads and voice recordings as further layers under the same person context card, and wire the shared commitments table into Hugo's morning brief and meeting prep so open loops from all sources (Notion analyses, WhatsApp, email, voice) appear in one place with one confirm flow.

## User Stories

- As the owner, I want email threads with known people archived and searchable, so I can reopen a conversation without depending on live Gmail search.
- As the owner, I want to record spontaneous conversations from my phone and have them transcribed and analyzed the same way as Notion meeting transcripts, so hallway talks and calls get the same treatment.
- As the owner, I want voice recordings attached to the person I name and optionally to a meeting that just ended, so context stays with the relationship.
- As the owner, I want Hugo's morning brief to show open commitments for people I am meeting today (from all sources), so I do not forget what I promised or what they owe me.
- As the owner, I want meeting prep for a specific person to include their open commitments, so the brief is complete.
- As the owner, I want one review queue for all proposed commitments regardless of source, so I do not check five places.

## Acceptance Criteria

### Email archive

- Given a cron runs (same cadence as Notion sync, e.g., `/api/cron/email-sync`), when it executes, then it pulls recent threads (last 30 days) from all connected Google accounts (`gmail.readonly` scope) where From or To matches a `people.email` or a `person_external_ids` row with provider `email`.
- Given an email thread matches a known person, when the sync completes, then a `person_email_threads` row is created with: Gmail thread ID, subject, from, to, date, snippet (first 200 chars of body), account email, person ID.
- Given a thread already exists, when sync runs, then the row is updated if the thread has new messages (by comparing Gmail thread history).
- Given a person card loads, when email threads exist for that person, then a new section "אימיילים" appears under WhatsApp, showing threads newest first, each with a Gmail link icon to open in Gmail.
- Given I click a Gmail link, when it opens, then it goes to `https://mail.google.com/mail/u/{account}/#all/{threadId}` (or the correct account-specific URL).

### Voice capture (mobile)

- Given I am on the mobile meetings screen or a person screen, when I tap a "הקלט שיחה" FAB, then a consent screen appears with checkbox "כל המשתתפים הסכימו להקלטה" and legal disclaimer.
- Given I confirm consent and start recording, when the recording is active, then the app displays: elapsed time, waveform visualization, pause/resume button, and stop button.
- Given I stop a recording longer than 10 seconds, when upload completes, then the audio is sent to the server via multipart HTTP (not tRPC base64).
- Given the server receives the audio, when transcription starts, then it uses Gemini audio API (same as the existing `voice-capture-deep-analysis` draft spec).
- Given transcription completes, when analysis runs, then the same deep analysis pipeline from `meeting-transcript-deep-analysis` is used: mood, subtext, key insight, kaizen, action items with owners.
- Given the analysis completes, when I view the result, then I can attach the recording to: (a) an existing meeting that just ended (if one exists within 15 min), (b) specific people I name, or (c) standalone (no meeting).
- Given a recording is attached to a person, when their card loads, then a "הקלטות קוליות" section appears under email, showing the recording date, duration, and a play button or link to the transcript.
- Given the analysis extracted action items, when it finishes, then proposed `commitments` rows are created with source `voice`, same as WhatsApp and meeting analyses.

### Hugo commitment integration

- Given the morning brief runs (`/api/cron/morning-briefing`), when it gathers today's meetings, then for each meeting with known people, it queries `commitments` where `status = 'proposed'` and `personId` matches an attendee.
- Given open commitments exist for people I am meeting today, when the brief is built, then they are injected after the calendar section, grouped by person: "התחייבויות פתוחות: · X (ל-Y): …".
- Given I have commitments assigned to me (`owner = 'me'`), when the brief is built, then those are shown in a separate nagging block: "זכור לטפל: · אמרת ל-X ש…".
- Given meeting prep runs (`/api/cron/pre-meeting-briefing`) for a specific meeting, when prep is built, then the agent context includes open commitments for each attendee (from all sources: Notion analysis, WhatsApp, email, voice).
- Given the context includes commitments, when the brief is phrased, then each commitment shows its source: "מהאנליזה" (meeting analysis), "מהוואטסאפ" (WhatsApp), "מאימייל" (email), "מהקלטה" (voice).

### Unified commitment queue

- Given the commitments page (`/commitments`) loads, when it queries, then it shows proposed commitments from all sources merged: meeting analyses, WhatsApp DM, WhatsApp group, email, voice.
- Given a commitment row displays, when the source is shown, then it is badged: "Notion", "WhatsApp", "Email", "הקלטה".
- Given I accept a commitment from any source, when the task is created, then the task `notes` field includes a link to the source (Notion page, WhatsApp message snippet, Gmail thread link, or voice recording).

## Data Model

Changes in **both** `packages/database/src/schema.ts` (SQLite) and `packages/database/src/schema.pg.ts` (Postgres). Export new types. Add SQLite bootstrap in `packages/database/src/index.ts`.

### New table: `person_email_threads`

Columns:
- `id` (text, pk)
- `personId` (text, FK → `people.id`, `onDelete: cascade`, indexed)
- `gmailThreadId` (text, notNull, unique)
- `accountEmail` (text, notNull) — which Google account
- `subject` (text, notNull)
- `from` (text, notNull)
- `to` (text, notNull)
- `date` (text, notNull) — ISO date
- `snippet` (text, nullable) — first 200 chars
- `lastSyncedAt` (text, notNull)
- `createdAt` (text, notNull)

Indexes: on `personId`, on `date` desc, unique on `gmailThreadId`.

### New table: `voice_recordings`

Columns:
- `id` (text, pk)
- `audioPath` (text, notNull) — S3 or local path
- `transcriptText` (text, nullable)
- `analysisId` (text, nullable, FK → `meeting_analyses.id`, `onDelete: set null`) — reuses the existing analysis table
- `meetingId` (text, nullable, FK → `meetings.id`, `onDelete: set null`)
- `duration` (integer, notNull) — seconds
- `consentConfirmedAt` (text, notNull)
- `createdAt` (text, notNull)
- `updatedAt` (text, notNull)

Indexes: on `meetingId`, on `analysisId`, on `createdAt` desc.

### New table: `voice_recording_people`

M2M join:
- `recordingId` (text, FK → `voice_recordings.id`, `onDelete: cascade`)
- `personId` (text, FK → `people.id`, `onDelete: cascade`)

Indexes on both FKs.

### Changes to `commitments`

Extend `source` enum to include `email` and `voice`:
- `source` — `whatsapp_dm` | `whatsapp_group` | `meeting_analysis` | `email` | `voice`

Migration: all additive.

## tRPC API

### New router: `email` (`packages/api/src/routers/email.ts`)

All procedures `protectedProcedure`.

- **`threadsForPerson`** (query)
  - Input: `{ personId: z.string().min(1), limit?: z.number() }` (default 20)
  - Returns: `{ threads: EmailThread[], hasMore: boolean }`

- **`syncNow`** (mutation)
  - Input: `{ personIds?: z.array(z.string()) }` (optional, defaults to all confirmed people with emails)
  - Triggers on-demand email sync for specified people
  - Returns: `{ syncedCount: number }`

### New router: `voice` (`packages/api/src/routers/voice.ts`)

All procedures `protectedProcedure`.

- **`upload`** (mutation)
  - Input: multipart upload endpoint at `POST /api/voice/upload` (not tRPC, since audio is binary)
  - Body: `{ audio: File, consentConfirmed: boolean }`
  - Returns: `{ recordingId: string }`

- **`attachToPeople`** (mutation)
  - Input: `{ recordingId: z.string().min(1), personIds: z.array(z.string().min(1)), meetingId?: z.string() }`
  - Links recording to people (and optionally a meeting)
  - Returns: `{ attached: boolean }`

- **`listForPerson`** (query)
  - Input: `{ personId: z.string().min(1), limit?: z.number() }` (default 10)
  - Returns: `{ recordings: VoiceRecording[], hasMore: boolean }`

- **`getAnalysis`** (query)
  - Input: `{ recordingId: z.string().min(1) }`
  - Returns: `MeetingAnalysis` (reuses existing type)

### Extend router: `insights` (`packages/api/src/routers/insights.ts`)

- **`personContext`** (query) — extend return to include:
  - `emailThreads: EmailThread[]` (last 5)
  - `voiceRecordings: VoiceRecordingSummary[]` (last 3)

### Extend router: `commitments` (already created in `whatsapp-dm-capture`)

No changes needed; `source` enum already extensible.

## UI Surface

### Person card: `apps/web/src/components/people/PersonContextCard.tsx`

Add two new sections after WhatsApp:

- **"אימיילים"** — collapsible, shows last 5 threads, each with: subject, date, snippet, Gmail link icon
- **"הקלטות קוליות"** — collapsible, shows last 3 recordings, each with: date, duration, play icon (opens transcript modal or audio player)

### Commitments page: `apps/web/src/app/commitments/page.tsx`

(Already created in `whatsapp-dm-capture`.)

- Extend to show source badges: "Notion", "WhatsApp", "Email", "הקלטה"
- When source is email, show Gmail thread link in the snippet
- When source is voice, show "מהקלטה ב-{date}" with a link to the recording

### Mobile: voice recording

- New screen: `apps/mobile/app/record.tsx` or a modal from the meetings/people screen
- Consent checkbox, record button, waveform visualization (use `expo-av` for recording)
- After stop: "לאיזה אנשים לקשר?" multi-select, optional meeting picker if one just ended
- Upload via `POST /api/voice/upload` with progress indicator

### Mobile: person card

- `apps/mobile/app/people/[id].tsx` — extend to show email threads and voice recordings sections (same tRPC query)

### Cron: email sync

- New cron route: `apps/web/src/app/api/cron/email-sync/route.ts`
- Runs every 1 hour (or same cadence as Notion sync)
- Calls `packages/api/src/services/email-sync.ts` (new service file)
- Service uses existing `searchGmailMessages` from `packages/api/src/services/gmail.ts`, filters by known people emails, writes `person_email_threads`

### Agent context injection

- Extend `apps/web/src/lib/agent-memory.ts` → `getMemoryPromptBlock()` or create `getCommitmentsForMeeting(meetingId)` helper
- Called from:
  - `apps/web/src/app/api/cron/morning-briefing/route.ts` — inject open commitments for today's attendees
  - `apps/web/src/app/api/cron/pre-meeting-briefing/route.ts` — inject commitments for this meeting's attendees

## Out of Scope

- Slack, Teams, or Telegram history (not in this pass)
- Capturing every email thread (only known people with confirmed emails)
- Auto-creating tasks from commitments without user review
- Sentiment analysis or conversation scoring beyond commitment detection
- A full email client UI (only show threads with Gmail links to open in Gmail)
- Always-on voice recording or room recording without explicit user start

## Open Questions

None blocking. Default behavior:
- Email sync runs every 1 hour, pulls threads from last 30 days.
- Voice transcription uses Gemini audio API (same as meeting transcripts).
- Commitment detection from email uses the same heuristic as WhatsApp (action verbs + LLM for ambiguous cases).
- Audio files are stored locally on the server (`apps/web/data/voice/`) or in S3 if configured; the spec does not mandate a specific storage backend.

## Implementation Decisions

Recorded before implementation (2026-09-24). Where these differ from the sections above, these win.

### Email

- **Who is matched.** `people.email` plus `person_external_ids` rows with provider `email`, for people with `status = 'confirmed'`. The owner's own contact row is skipped.
- **Query.** The Gmail search `newer_than:30d (from:a OR to:a OR cc:a …)` runs in batches of 15 addresses per connected account, via `messages.list` + `messages.get?format=metadata` (From, To, Cc, Subject, Date + Gmail `snippet`). `searchGmailMessages` fetches full bodies and has no `To` header, so the sync gets its own metadata fetcher in `services/email-sync.ts`. It is injectable, so tests never hit Gmail.
- **One row per (thread, person).** `gmailThreadId` stores `accountEmail::threadId`. The unique index is `(gmail_thread_id, person_id)`, because one thread with two known people belongs on both cards. The row keeps the latest message's subject, from, to, date and snippet. "New messages" means the latest message date moved forward.
- **Gmail link.** `https://mail.google.com/mail/u/?authuser={accountEmail}#all/{threadId}` opens the right account without knowing its index.
- **Commitments from email.** The Hebrew verb heuristic from WhatsApp runs on the snippet of each new or updated message, plus a few English patterns ("I'll send", "can you send"). `fromMe` is true when From is the account itself. The source is `email` and `sourceId` is the thread key. No LLM call per email.
- **Scope.** `gmail.readonly` is already in the Google OAuth scopes. An account without it is skipped and reported in the cron result, not failed.
- **Cron.** `/api/cron/email-sync` runs hourly (`crontab.example` + `local-cron.mjs`).

### Voice

- **Every recording gets a meeting row.** `meeting_analyses.meeting_id` is NOT NULL, and warmth, open loops and the person card all read analyses through meetings. So:
  - A recording uploaded with a `meetingId` analyzes into that meeting.
  - Otherwise a meeting is created with `source = 'voice'` and title `שיחה מוקלטת`, dated at the recording's start, and the recording's people become its `meeting_people`.
  - Attaching later to an existing meeting moves the analysis and people there and deletes the placeholder meeting, but only if it is a `source='voice'` meeting created for this recording.
- **Analysis.** `meeting_analyses` rows get `source = 'voice'`, `audioPath`, and `consentConfirmedAt`.
- **Transcription.** Gemini (`gemini-2.5-flash`) with inline audio, which caps uploads at 19 MB (about 40 minutes of mono AAC). Larger files are rejected with a clear message. Then `analyzeTranscript` runs; it needs ≥100 characters.
- **Storage.** `VOICE_STORAGE_DIR`, defaulting to `dirname(DATABASE_PATH)/voice`. On EC2 that is `/data/voice` on the `web-data` volume, so recordings survive redeploys. Audio is served back only through the authenticated `GET /api/voice/{id}/audio`.
- **Processing.**
  - The upload returns as soon as the file is saved; processing runs in the background on the long-running Node server.
  - `status` is `uploaded` | `processing` | `completed` | `failed`, plus an `error` column.
  - `voice.retry` re-runs a failed recording.
- **Consent.** Required on every upload. The server rejects uploads without `consentConfirmed=true` and stores `consentConfirmedAt`.
- **Recorders.**
  - Web: a browser recorder (MediaRecorder) at `/voice`, with the same consent, timer, pause and stop.
  - Mobile: the person screen shows recordings (read-only) in this pass. A native recorder needs `expo-audio`, which is not installed, and `apps/mobile/package.json` plus the lockfile carry an unrelated in-progress Expo upgrade. Adding it waits for the owner's go-ahead and a new APK build.
- **Voice table columns added to the spec.** `status`, `error`, `mimeType`, `sizeBytes`, and `createdMeeting` (the placeholder meeting id, when one was created).

### Commitments

- **Source enum.** `voice` joins `COMMITMENT_SOURCES`.
- **From analyses.** Analyses (Notion transcripts and voice) propose commitments from their action items when they complete. This covers the cron, `meetings.analyzeTranscript` and voice.
  - An item whose owner matches a confirmed attendee becomes `owner = 'them'` on that person.
  - An item owned by me (the owner name, or no owner) becomes `owner = 'me'`, attached to the only other confirmed attendee. With several attendees, owner-less items stay on the meeting's analysis and are not guessed onto a person.
  - `sourceId` is the meeting id, and dedupe works per person by content, as before.
- **No `tasks.notes` column.** The link lives on the commitment instead: `commitments.listProposed` and `listForPerson` return a computed `sourceUrl`, which is the meeting page for analysis or voice, and Gmail for email. Accepting an analysis or voice commitment sets `tasks.meetingId` on the new task, so the task links back to the conversation.
- **Badges on /commitments.** Notion (meeting_analysis), WhatsApp (dm/group), Email, הקלטה (voice).

### Hugo

- **Morning brief.** `insights.commitmentsForDate({date})` returns:
  - the proposed commitments of confirmed attendees of that day's meetings, grouped by person;
  - my other proposed commitments (`owner = 'me'`, up to 5, newest first, excluding those already listed).
  - The formatter adds the sections "התחייבויות פתוחות:" and "זכור לטפל:" after the events.
- **Meeting prep.** `meetingPrepRelationship` adds up to 3 proposed commitments per attendee (circle or people) with the source label: מהאנליזה / מהוואטסאפ / מאימייל / מהקלטה. It uses the commitment text only, never the raw snippet.
