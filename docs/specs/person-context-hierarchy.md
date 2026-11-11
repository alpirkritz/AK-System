# Person Context Hierarchy and Circle Rosters

**Stack:** `next-trpc-monorepo`  
**Slug:** `person-context-hierarchy`  
**Status:** Draft  
**Created:** 2026-09-24

---

## Goal

Unite Notion meetings and WhatsApp messages into one context card per person, with a recommendation that reconciles both sources, and extend the same pattern to recurring meeting series as "circles" with standing rosters inherited from calendar attendees, so you stop re-entering twenty names three times a week.

## User Stories

- As the owner, I want one card per person that shows their Notion meetings and our WhatsApp chats in context, so I see what was formally decided and what happened since in one place.
- As the owner, I want a Hebrew recommendation line that tells me what to open with — whether the chat moved past the last meeting note or the note is still current — so I do not guess which source is newer.
- As the owner, I want WhatsApp group senders matched to people I already follow, so a message from someone in a work group updates their person card rather than staying unlinked.
- As the owner, I want a recurring meeting like Algo 4.0 to save its participant list once from the calendar, so later instances inherit that roster and I do not attach people manually each time.
- As the owner, I want a circle card (series) that shows the standing roster, the series Notion notes, and a recommendation for that room, so twenty people is a count not twenty CRM profiles.
- As the owner, I want meeting prep for a circle to inject the circle recommendation instead of twenty bios, so the brief stays proportional to the meeting.
- As the owner, I want a followed person who sits in a circle to show that circle as one line on their card, not as three weekly instances, so their relationship does not fill with recurring clutter.

## Acceptance Criteria

### Person card (existing followed people)

- Given a person linked to Notion meetings and present in watched WhatsApp groups, when I open their drawer or mobile person screen, then I see a card in this order: recommendation (one Hebrew line), open loops from meeting analyses assigned to them, WhatsApp since their last Notion meeting, past Notion meetings/notes, older WhatsApp collapsed, plus one line per circle they belong to.
- Given the person has both a recent Notion meeting and WhatsApp messages since that meeting, when the card loads, then the recommendation states which source is current and what changed (e.g., "הוואטסאפ העביר את התאריך · הפגישה עדיין לא עודכנה").
- Given the person has only Notion meetings and no WhatsApp, when the card loads, then the recommendation reflects the Notion note only and WhatsApp sections are absent.
- Given the person has only WhatsApp and no recent Notion meetings, when the card loads, then the recommendation reflects the chat summary only.

### WhatsApp sender matching

- Given a watched WhatsApp group has messages with sender JIDs, when calendar sync or a manual match runs, then sender JIDs are matched to `people.phone` or to `person_external_ids` rows with provider `whatsapp`, and that match is stored.
- Given a matched sender, when new messages arrive from that sender, then those messages appear on the matched person's card under "WhatsApp since last meeting" or "older WhatsApp".
- Given an unmatched sender in a group, when messages arrive, then those messages stay on the group view but do not appear on any person card.
- Given a person's WhatsApp messages occurred within 3 days of a Notion meeting they attended, when the card loads, then those messages are tagged with `meeting_id` so the meeting page can also show "chat around this meeting".

### Circle card (recurring series)

- Given a recurring meeting series with no saved roster, when I open the series or an instance, then I see the primary button "שמור חוג מהיומן" and the recommendation area is empty until I save.
- Given I tap "שמור חוג מהיומן" on a series, when the action completes, then `series_roster` rows are created from the latest instance's calendar `attendees` or from the `משתתפים` / `Participants` description block, with display name, email if present, source (`attendees` or `description`), and `personId` null.
- Given a series has a saved roster, when I open a later instance, then the participant list is inherited from the series roster, not re-read from `meeting_people`, and the primary button is gone.
- Given a series has a saved roster and a new calendar sync runs, when attendees or the description changed, then I see a ghost button "עדכן מהיומן" with a diff badge (e.g., "2 חדשים · 1 לא הגיע").
- Given I tap the diff button and confirm, when the update completes, then new names are added to the roster and removed names are marked inactive (not deleted).
- Given a circle card, when it loads, then I see: recommendation (one Hebrew line from the series Notion notes), open loops from the latest series analysis, past Notion meetings of the series, and a roster count "N בחוג".
- Given I expand the roster count, when the list appears, then I see all names in a read-only list, with a source badge (`attendees` or `description`) and an "עקוב" button on each row.
- Given I tap "עקוב" on a roster row, when the action completes, then a new `people` row is created (status `confirmed`), and that roster row is linked via `personId`.

### Meeting prep integration

- Given meeting prep runs for a circle meeting (series with a saved roster), when the brief is built, then the agent context includes the circle recommendation and open loops for the series, not individual bios for each roster member.
- Given meeting prep runs for a 1:1 or small meeting with a followed person, when the brief is built, then the agent context includes that person's card (recommendation, open loops, recent interactions), including the one-line summary of any circle they belong to.
- Given meeting prep context, when it is injected, then raw WhatsApp chat text is never included; only the recommendation and structured loops.

### Mobile parity

- Given a person card or circle card, when viewed on the mobile app (ARO), then the same order and sections appear: recommendation, loops, interactions, roster count.
- Given the roster diff button appears on web, when viewed on mobile, then the same diff and confirm flow is available.

### Duplicate detection and merging

- Given the system has multiple people with similar names or matching emails, when I navigate to `/people/duplicates`, then I see a list of suspected duplicate pairs ranked by confidence (email match > name similarity > phone similarity).
- Given a suspected duplicate pair, when I click to review, then I see a side-by-side comparison showing: name, email, phone, company, role, all meetings, all tasks, all Notion links, all WhatsApp links, and external IDs.
- Given I review a pair and decide they are the same person, when I click "מזג" (merge), then I select which person is the primary (keeps the ID), and all relationships from the secondary person (meetings, tasks, notes, WhatsApp links, external IDs, series roster entries) are re-pointed to the primary, and the secondary person is deleted.
- Given I review a pair and decide they are not duplicates, when I click "לא כפילות" (not duplicates), then that pair is marked as reviewed and excluded from future duplicate suggestions.
- Given a person has multiple external IDs from the same provider (e.g., two Notion page IDs), when merge happens, then all external IDs from the secondary are transferred to the primary, so the unified person has connections to all source systems.
- Given duplicate detection runs automatically (nightly cron or after calendar sync), when new suspected duplicates are found, then a notification badge appears on the People page: "N כפילויות חשודות".

### Relationship warmth tracking

- Given a person has multiple interactions over time (meetings, WhatsApp, email), when sentiment is analyzed for each interaction, then each interaction gets a sentiment score: positive (1.0), neutral (0.0), or negative (-1.0), with granularity in between.
- Given sentiment scores exist for a person's recent interactions (last 90 days) and older interactions (91-180 days ago), when the warmth trend is calculated, then it compares the average recent sentiment to the average older sentiment and returns: `warming` (recent > older by ≥0.2), `cooling` (recent < older by ≥0.2), or `stable`.
- Given a person card loads and the trend is `cooling`, when the recommendation is shown, then a yellow warning badge "מתקרר" (cooling) appears next to the recommendation, and the recommendation text mentions the sentiment shift (e.g., "השיחות האחרונות פחות חמות · כדאי לברר").
- Given a person card loads and the trend is `warming`, when the recommendation is shown, then a green badge "מתחמם" (warming) appears, and the recommendation reflects the positive trend (e.g., "הקשר משתפר · המשך כך").
- Given a person card loads and the trend is `stable` or data is insufficient (< 4 interactions in the window), when the recommendation is shown, then no warmth badge appears.
- Given meeting prep runs for a person with a `cooling` trend, when the brief is built, then the prep includes a note: "שים לב: הקשר נראה מתקרר לפי השיחות האחרונות".
- Given the morning brief lists today's meetings, when a meeting includes someone with a `cooling` trend, then that person's name is flagged in the brief.
- Given I click on a warmth badge, when the detail modal opens, then I see a timeline of sentiment scores per interaction (meeting/WhatsApp/email) with dates, so I can see exactly where the shift happened.

### Circle (series) warmth tracking

- Given a recurring meeting series (circle) has multiple instances with meeting analyses over time, when sentiment is calculated per instance (from `mood`, `subtext`, and `score` fields in `meeting_analyses`), then the series gets a warmth trend comparing recent instances (last 8) to older instances (9-16).
- Given a circle card loads and the series trend is `cooling`, when the recommendation is shown, then a yellow badge "הפגישה מתקררת" (meeting is cooling) appears, and the recommendation reflects it (e.g., "האווירה נעשית פחות פרודוקטיבית · כדאי לבדוק מה קורה").
- Given a circle card loads and the series trend is `warming`, when the recommendation is shown, then a green badge "הפגישה מתחממת" (meeting is warming) appears (e.g., "הפגישה משתפרת · הצוות יותר מעורב").
- Given a circle card loads and the trend is `stable` or data is insufficient (< 6 analyzed instances in the window), when the recommendation is shown, then no warmth badge appears.
- Given meeting prep runs for a circle with a `cooling` trend, when the brief is built, then the prep includes: "שים לב: אווירת הפגישה מתדרדרת לפי הסיכומים האחרונים".
- Given I click on a circle warmth badge, when the detail modal opens, then I see a timeline of sentiment per instance with dates, scores, and links to the analyses, so I can see which meetings shifted and why.

## Data Model

Changes in **both** `packages/database/src/schema.ts` (SQLite) and `packages/database/src/schema.pg.ts` (Postgres). Export new types from the SQLite schema index. Add SQLite bootstrap `CREATE TABLE IF NOT EXISTS` blocks in `packages/database/src/index.ts`.

**Production target: EC2.** The EC2 container runs on SQLite (`DATABASE_PATH=/data/ak_system.sqlite` on the `web-data` Docker volume, no `DATABASE_URL`), so the bootstrap block in `getDb()` is what migrates production on the first request after `pnpm deploy:ec2`. Every change is additive (new tables, nullable columns) so existing EC2 data is untouched. Back up the volume's SQLite file before deploying. The Postgres mirror is kept only per repo convention and is not used by EC2.

### New table: `series_roster`

Columns:
- `id` (text, pk)
- `seriesId` (text, FK → `meeting_series.id`, `onDelete: cascade`, indexed)
- `displayName` (text, notNull)
- `email` (text, nullable)
- `source` (text, notNull) — `attendees` | `description`
- `personId` (text, nullable, FK → `people.id`, `onDelete: set null`)
- `inactive` (boolean/integer, notNull, default false)
- `createdAt` (text, notNull)
- `updatedAt` (text, notNull)

Index on `seriesId`. Export `SERIES_ROSTER_SOURCES` const.

### New table: `whatsapp_person_links`

Columns:
- `id` (text, pk)
- `personId` (text, FK → `people.id`, `onDelete: cascade`, indexed)
- `whatsappJid` (text, notNull, unique) — the sender JID
- `matchedBy` (text, notNull) — `phone` | `manual`
- `createdAt` (text, notNull)

Unique index on `whatsappJid`.

### Changes to `meeting_series`

Add:
- `rosterSavedAt` (text, nullable) — when "שמור חוג" was first run
- `rosterSyncedAt` (text, nullable) — last calendar read for diff
- `warmthTrend` (text, nullable) — `warming` | `cooling` | `stable` | null (calculated from meeting analyses of instances)
- `warmthUpdatedAt` (text, nullable) — when trend was last calculated

### Changes to `whatsapp_messages`

Add:
- `meetingId` (text, nullable, FK → `meetings.id`, `onDelete: set null`, indexed) — messages within 3 days of a meeting that person attended

### New table: `duplicate_reviews`

Tracks which pairs have been reviewed as not-duplicates to avoid re-suggesting them.

Columns:
- `id` (text, pk)
- `personIdA` (text, FK → `people.id`, `onDelete: cascade`)
- `personIdB` (text, FK → `people.id`, `onDelete: cascade`)
- `reviewedBy` (text, notNull) — always 'user' for now
- `createdAt` (text, notNull)

Unique index on `(personIdA, personIdB)` where `personIdA < personIdB` (canonical ordering to avoid duplicates).

### New table: `interaction_sentiments`

Tracks sentiment per interaction for warmth trend analysis.

Columns:
- `id` (text, pk)
- `personId` (text, FK → `people.id`, `onDelete: cascade`, indexed)
- `interactionType` (text, notNull) — `meeting_analysis` | `whatsapp_message` | `whatsapp_summary` | `email_thread` | `voice_recording`
- `interactionId` (text, notNull) — ID of the source (meeting analysis ID, message ID, thread ID, recording ID)
- `sentiment` (real/float, notNull) — -1.0 (very negative) to 1.0 (very positive), 0.0 neutral
- `interactionDate` (text, notNull) — ISO date for windowing
- `createdAt` (text, notNull)

Indexes: on `personId`, on `(personId, interactionDate)`.

### Changes to `people`

Add:
- `warmthTrend` (text, nullable) — `warming` | `cooling` | `stable` | null (calculated nightly)
- `warmthUpdatedAt` (text, nullable) — when trend was last calculated

Migration: all additive. No breaking changes. Run `pnpm db:push` after schema edits.

## tRPC API

### New router: `circles` (`packages/api/src/routers/circles.ts`)

All procedures `protectedProcedure`.

- **`getSeriesCard`** (query)
  - Input: `{ seriesId: z.string().min(1) }`
  - Returns: `{ series, roster: SeriesRosterRow[], notionNotes: MeetingNote[], analyses: MeetingAnalysis[], recommendation: string | null, warmthTrend: 'warming' | 'cooling' | 'stable' | null, sentimentTimeline: SeriesSentimentPoint[] }`
  - Recommendation built from latest note + open loops, Hebrew
  - `SeriesSentimentPoint`: `{ date, sentiment, meetingId, analysisId }`

- **`saveRosterFromCalendar`** (mutation)
  - Input: `{ seriesId: z.string().min(1), instanceId: z.string().min(1) }`
  - Reads the instance's calendar event (via `calendarEventId`), parses attendees + description `משתתפים`, dedupes, writes `series_roster` rows
  - Returns: `{ rosterCount: number }`

- **`getRosterDiff`** (query)
  - Input: `{ seriesId: z.string().min(1), latestInstanceId: z.string().min(1) }`
  - Compares saved roster to latest calendar read
  - Returns: `{ added: RosterDiffRow[], removed: RosterDiffRow[], hasChanges: boolean }`

- **`applyRosterDiff`** (mutation)
  - Input: `{ seriesId: z.string().min(1), added: z.array(z.object({ displayName, email?, source })), removedIds: z.array(z.string()) }`
  - Adds new rows, marks removed as `inactive: true`
  - Returns: `{ applied: number }`

- **`followRosterMember`** (mutation)
  - Input: `{ rosterId: z.string().min(1) }`
  - Creates a `people` row (status `confirmed`, source `manual`), links via `personId`
  - Returns: `{ personId: string }`

### Extend router: `insights` (`packages/api/src/routers/insights.ts`)

- **`personContext`** (query) — extend existing procedure
  - Add to return shape: `recommendation: string | null`, `openLoopsForPerson: ActionLoop[]`, `whatsappSinceMeeting: WhatsAppSnippet[]`, `olderWhatsapp: WhatsAppSnippet[]`, `circles: CircleSummary[]`, `warmthTrend: 'warming' | 'cooling' | 'stable' | null`, `sentimentTimeline: SentimentPoint[]`
  - `ActionLoop`: `{ text, owner, source: 'meeting_analysis', analysisId, meetingId }`
  - `WhatsAppSnippet`: `{ groupJid, groupName, text, ts, senderName }`
  - `CircleSummary`: `{ seriesId, seriesTitle, cadence, lastRecommendation }`
  - `SentimentPoint`: `{ date, sentiment, interactionType, interactionId }` (last 20 for timeline)

- **`calculateWarmth`** (mutation) — new procedure
  - Input: `{ personId: z.string().min(1) }`
  - Calculates warmth trend: reads `interaction_sentiments` for last 180 days, compares recent 90 days to older 90 days, updates `people.warmthTrend`
  - Returns: `{ trend: 'warming' | 'cooling' | 'stable' | null, recentAvg: number, olderAvg: number }`

- **`calculateSeriesWarmth`** (mutation) — new procedure
  - Input: `{ seriesId: z.string().min(1) }`
  - Calculates series warmth trend: reads `meeting_analyses` for instances of this series, compares recent 8 instances to older 8 (9-16), derives sentiment from `mood`, `subtext`, `score`, updates `meeting_series.warmthTrend`
  - Returns: `{ trend: 'warming' | 'cooling' | 'stable' | null, recentAvg: number, olderAvg: number, instanceCount: number }`

### Extend router: `whatsapp` (`packages/api/src/routers/whatsapp.ts`)

- **`matchSenderToPerson`** (mutation)
  - Input: `{ whatsappJid: z.string().min(1), personId: z.string().min(1) }`
  - Writes `whatsapp_person_links` row
  - Returns: `{ linked: boolean }`

- **`messages.listByGroup`** (query) — extend
  - When a sender is linked via `whatsapp_person_links`, include `linkedPersonId` in the returned row

### Extend router: `meetings` (`packages/api/src/routers/meetings.ts`)

- **`getSeries`** (query) — extend existing
  - Add `roster: SeriesRosterRow[]` to return shape when `rosterSavedAt` is not null
  - Add `rosterDiff` when a diff is available

### Extend router: `people` (`packages/api/src/routers/people.ts`)

- **`findDuplicates`** (query)
  - Input: `{ minConfidence?: z.number() }` (default 0.7, range 0-1)
  - Returns: `{ pairs: DuplicatePair[] }` where each pair has `{ personA, personB, confidence, reasons: string[] }`
  - Reasons: `email_match`, `name_similarity_high`, `phone_match`, `same_company_similar_name`
  - Excludes pairs already in `duplicate_reviews`

- **`compareDuplicates`** (query)
  - Input: `{ personIdA: z.string().min(1), personIdB: z.string().min(1) }`
  - Returns: detailed comparison object with all fields side-by-side: `{ personA: DetailedPerson, personB: DetailedPerson, sharedMeetings: Meeting[], sharedProjects: Project[] }`

- **`merge`** (mutation)
  - Input: `{ primaryId: z.string().min(1), secondaryId: z.string().min(1) }`
  - Re-points all `meeting_people`, `task_people`, `meeting_note_people`, `project_people`, `whatsapp_person_links`, `person_external_ids`, `series_roster` from secondary → primary
  - Deletes secondary person
  - Returns: `{ mergedInto: string (primaryId) }`

- **`markNotDuplicate`** (mutation)
  - Input: `{ personIdA: z.string().min(1), personIdB: z.string().min(1) }`
  - Writes `duplicate_reviews` row with canonical ordering
  - Returns: `{ marked: boolean }`

## UI Surface

### Person drawer: `apps/web/src/components/people/PersonDetailDrawer.tsx`

Replace the existing "הקשר" section with a new `<PersonContextCard>` component.

### Person card: `apps/web/src/components/people/PersonContextCard.tsx`

Sections:
- Recommendation (gold bar, Hebrew, 1-2 lines) — **with warmth badge if `cooling` or `warming`**
- Open loops (expandable list, each with "צור משימה" inline action)
- WhatsApp since last meeting (collapsed by default if >5 messages, group name + timestamp)
- Notion meetings (existing list, kept as-is)
- Older WhatsApp (collapsed, expand shows all)
- Circles (one line each: series title · cadence · last recommendation)

Props: `{ personId }`

**Warmth badge behavior:**
- `cooling`: yellow "מתקרר" badge with ↓ icon, clickable to open sentiment timeline
- `warming`: green "מתחמם" badge with ↑ icon, clickable to open sentiment timeline
- `stable` or null: no badge

### New page: `apps/web/src/app/meetings/series/[id]/page.tsx`

Displays the circle card. Layout:
- Hero: series title, cadence, roster count — **with warmth badge if `cooling` or `warming`**
- Primary button: "שמור חוג מהיומן" (when `rosterSavedAt` is null)
- Ghost button: "עדכן מהיומן" with diff badge (when diff exists)
- Card body: recommendation (with warmth-aware phrasing if trend exists), open loops, Notion meetings list, roster expandable section

**Circle warmth badge:**
- `cooling`: yellow "הפגישה מתקררת" badge with ↓ icon, clickable to open series sentiment timeline
- `warming`: green "הפגישה מתחממת" badge with ↑ icon, clickable to open series sentiment timeline
- `stable` or null: no badge

### New component: `apps/web/src/components/people/SentimentTimeline.tsx`

Modal or drawer showing sentiment trend over time (used for both people and circles):

**For people:**
- Line chart with date (X) vs. sentiment (Y, -1 to 1)
- Points colored by interaction type: meeting (gold), WhatsApp (green), email (blue), voice (purple)
- Shaded background: recent 90 days (light) vs. older 90 days (darker) to show comparison windows
- Hover tooltip: interaction type, date, sentiment score, link to source
- Footer summary: "ממוצע אחרון: {recentAvg} · ממוצע קודם: {olderAvg} · מגמה: {trend}"

**For circles (series):**
- Line chart with meeting instance date (X) vs. sentiment (Y, -1 to 1)
- Points colored by sentiment (red = negative, yellow = neutral, green = positive)
- Shaded background: recent 8 instances vs. older 8 instances
- Hover tooltip: meeting date, title, sentiment score, analysis score, link to meeting and analysis
- Footer summary: "ממוצע אחרון: {recentAvg} · ממוצע קודם: {olderAvg} · מגמה: {trend} · מבוסס על {instanceCount} פגישות"

### Cron: warmth calculation

- New cron route: `apps/web/src/app/api/cron/warmth-trends/route.ts`
- Runs nightly (or weekly)
- Calls `insights.calculateWarmth` for all confirmed people with ≥4 interactions in the last 180 days
- Calls `insights.calculateSeriesWarmth` for all series with ≥6 analyzed instances
- Service file: `packages/api/src/services/warmth-calculation.ts` — reads `interaction_sentiments` for people, reads `meeting_analyses` for series, computes averages, updates `people.warmthTrend` and `meeting_series.warmthTrend`

### Roster section component: `apps/web/src/components/meetings/SeriesRoster.tsx`

- Collapsed: "N בחוג" with expand icon
- Expanded: read-only table, columns: name, email (if present), source badge, "עקוב" button
- "מי עלה בסיכום" — highlights names mentioned in the latest analysis

### Mobile

- `apps/mobile/app/people/[id].tsx` — replace relationship section with `PersonContextCard` equivalent (use same tRPC query)
- New screen: `apps/mobile/app/meetings/series/[id].tsx` — circle card (same layout as web, mobile styling)

### New page: `apps/web/src/app/people/duplicates/page.tsx`

Duplicate review interface:

**List view:**
- Header: "כפילויות חשודות" with count badge
- Filter: confidence threshold slider (high/medium/all)
- Each row: two avatars side-by-side, names, confidence badge (email match = green, name similarity = yellow), "סקור" button

**Review modal/page:**
- Split view: person A on left, person B on right
- Comparison sections: basic info (name, email, phone, company, role), meetings (count + preview), tasks (count), Notion links (page IDs), WhatsApp (linked JIDs), external IDs (all providers)
- Highlight differences in gold, matches in muted green
- Actions at bottom: "מזג ← שמאל" (merge, keep left), "מזג → ימין" (merge, keep right), "לא כפילות" (not duplicates, dismiss)
- Confirmation step before merge: "מיזוג ימחק לצמיתות את {secondary name}. להמשיך?"

**After merge:**
- Toast: "אנשי קשר מוזגו · {primary name} שמר על כל הקישורים"
- Redirect to the primary person's page
- The secondary ID returns 404 if accessed

## Out of Scope

- 1:1 WhatsApp capture (step 2)
- Email archive or voice recording (step 3)
- Auto-creating tasks from open loops without user confirm
- Binding a WhatsApp group to a series to show chat on the circle card (the circle card reads only Notion notes and the roster)
- Copying the full roster onto every instance's `meeting_people` (instances inherit the series roster)
- Creating a CRM person for every calendar attendee automatically (roster rows are not people until you tap "עקוב")
- Auto-merging duplicates without user review (all merges require explicit confirmation)
- Undoing a merge (once merged, the secondary person is deleted; this is a destructive action)
- Sentiment analysis of every individual WhatsApp message (summaries get sentiment, not individual lines)
- Showing person warmth trend on circle cards (circle cards show series warmth, not individual relationship warmth; person warmth is on person cards)
- Manual sentiment override (sentiment is calculated from interaction content, not user-editable)

## Open Questions

None blocking. Default behavior:
- Recommendation phrasing is deterministic logic (newer source wins), then a model phrases it in Hebrew.
- Roster diff is an explicit user action ("עדכן מהיומן"), not automatic on every sync.
- "עקוב" creates a `confirmed` person immediately; no intermediate review queue for roster members.
- Duplicate detection algorithm: email exact match (confidence 1.0), phone exact match (confidence 0.95), name Levenshtein distance < 3 + same company (confidence 0.8), name similarity > 85% (confidence 0.7).
- Duplicate detection runs nightly via cron `/api/cron/people-duplicates` or can be triggered manually from the UI.
- **Sentiment calculation:** meeting analyses already have `mood` and `subtext` fields that map to sentiment. WhatsApp summaries and email threads are analyzed with a lightweight LLM call (Gemini Flash) that returns a sentiment score (-1 to 1). Voice recordings reuse their `mood` field from the analysis. Sentiment is calculated when the interaction is created or analyzed, not retroactively on old data.
- **Warmth trend calculation (people):** runs nightly for people with ≥4 interactions in the last 180 days. Trend is `cooling` if recent avg < older avg by ≥0.2, `warming` if recent avg > older avg by ≥0.2, else `stable`. People with <4 interactions get `null` (insufficient data).
- **Warmth trend calculation (series):** runs nightly for series with ≥6 analyzed instances. Compares recent 8 instances to older 8 instances (9-16). Sentiment derived from `meeting_analyses` fields: `mood` (positive/neutral/negative maps to 1/0/-1), `score` (1-10 normalized to -1 to 1), and `subtext` (parsed for negative/positive indicators). Same threshold: ≥0.2 difference = warming/cooling.
- **Prep integration:** meeting prep for a `cooling` person adds one line: "שים לב: הקשר עם {name} נראה מתקרר." Meeting prep for a `cooling` circle adds: "שים לב: אווירת הפגישה מתדרדרת לפי הסיכומים האחרונים." Morning brief flags cooling people with ↓ icon, cooling circles with a meeting-specific ↓ icon.

## Implementation Notes (2026-09-24)

Shipped with these deviations; see `reports/person-context-hierarchy.md` for the full table.

- Participants are stored per occurrence in `meetings.calendar_participants` (JSON) and the roster is derived from the latest synced occurrence. Series without a Google recurring id are grouped by `meeting_series.title_key` (`calendarId|normalized title`, ≥2 occurrences with participants).
- Roster rows can also be `source = 'manual'` ("הוסף לחוג"). A dismissed calendar diff is remembered in `meeting_series.roster_dismissed_sig` until the calendar changes again.
- Warmth is computed on read from `meeting_analyses`; `interaction_sentiments`, the `warmthTrend` columns and the warmth cron are deferred until WhatsApp/email sentiment exists.
- Duplicate detection runs on request (no cron). Exact same name (or swapped order) scores 0.85, or 0.9 with the same company, in addition to the listed rules.
- Recommendations are deterministic Hebrew templates, not model-phrased.
- The circle card lives on each occurrence's meeting page rather than a separate series page. The sentiment timeline expands inline.
