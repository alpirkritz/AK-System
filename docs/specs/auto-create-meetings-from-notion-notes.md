# Auto-create Meeting Records from Standalone Notion AI Notes

**Slug:** `auto-create-meetings-from-notion-notes`  
**Stack:** `next-trpc-monorepo`

## Goal

Automatically create meeting records for Notion AI meeting notes that aren't linked to calendar events, enabling conversation analysis and full meeting features for corridor discussions and unscheduled conversations.

## User stories

- As a user, I want my corridor discussions recorded in Notion to appear in `/meetings`, so I can see all my conversations in one place.
- As a user, I want to analyze standalone Notion meeting notes with the same deep analysis, so unscheduled discussions get the same insights as calendar meetings.
- As a user, I want to link tasks and people to corridor discussions, so I can track follow-ups even for spontaneous conversations.
- As a user, I want to distinguish calendar-synced meetings from corridor discussions, so I know which came from my calendar vs manual Notion notes.
- As a user, I want existing orphaned notes to be retroactively linked, so historical discussions become accessible.

## Acceptance criteria

**Given** a Notion AI meeting note exists with no `meeting_id`  
**When** the Notion sync runs  
**Then** a meeting record is created with title, date, and category from the note, and the note is linked to it

**Given** an orphaned note was created before this feature  
**When** the Notion sync runs  
**Then** a meeting record is created retroactively and the note's `meeting_id` is populated

**Given** a meeting was auto-created from a note  
**When** I view `/meetings`  
**Then** I see it in the list with a visual indicator (e.g., icon or badge) that it's note-sourced

**Given** a meeting was auto-created from a note  
**When** I view `/meetings/[id]`  
**Then** I can trigger conversation analysis, link tasks/people, add manual notes, just like calendar meetings

**Given** a note-sourced meeting exists  
**When** a calendar event is later created with the same title and date  
**Then** the system does NOT create a duplicate; it links the calendar event to the existing meeting

**Given** multiple notes share the same title and date  
**When** sync runs  
**Then** only ONE meeting is created, and all notes link to it

## Data model

### `packages/database/src/schema.pg.ts` and `schema.ts`

**No new tables.** Extend `meetings`:

```typescript
export const meetings = pgTable('meetings', {
  // ... existing fields ...
  
  /** Source of this meeting: 'calendar' | 'notion_note' | 'manual' */
  source: text('source').notNull().default('calendar'),
  
  /** When source='notion_note', this is the first note that created the meeting */
  sourceNoteId: text('source_note_id').references(() => meetingNotes.id, { onDelete: 'set null' }),
})
```

**Migration strategy** (additive):
- Add `source` column with default `'calendar'` (all existing meetings are calendar-sourced)
- Add `sourceNoteId` nullable column
- Bootstrap SQL in `packages/database/src/index.ts`:
  ```sql
  ALTER TABLE meetings ADD COLUMN source TEXT NOT NULL DEFAULT 'calendar'
  ALTER TABLE meetings ADD COLUMN source_note_id TEXT REFERENCES meeting_notes(id) ON DELETE SET NULL
  CREATE INDEX IF NOT EXISTS idx_meetings_source ON meetings(source)
  CREATE INDEX IF NOT EXISTS idx_meetings_source_note_id ON meetings(source_note_id)
  ```

**No changes** to `meeting_notes` schema.

## tRPC API

### Router: `packages/api/src/routers/meetings.ts`

**No new procedures.** The existing `list` query already returns all meetings; UI will filter/badge by `source` field.

### Service: `packages/api/src/services/notion-meeting-note-body.ts` or new `notion-meeting-sync.ts`

**New exported function:**

```typescript
export async function ensureMeetingForNote(
  noteId: string,
  noteTitle: string,
  noteDate: string | null,
): Promise<string> {
  // Returns meeting ID (existing or newly created)
  // 1. Check if note already has meetingId
  // 2. If not, search for existing meeting with same title + date
  // 3. If none, create meeting with source='notion_note', sourceNoteId=noteId
  // 4. Update note.meetingId
  // 5. Return meetingId
}
```

**Integration point:** Call this function in the Notion sync logic (likely in `packages/api/src/services/notion-graph-sync.ts` or wherever meeting notes are synced) for every note that comes back without a `meetingId`.

## UI surface

### `apps/web/src/app/meetings/page.tsx`

**Change:** Add visual indicator for note-sourced meetings.

- Calendar-sourced: existing calendar icon (🗓️ or similar)
- Note-sourced: new icon, e.g., 📝 or a badge "Notion"
- Manual: if user creates from UI, different badge

**Filtering (optional):** Add filter toggle "Show all / Calendar only / Notes only"

### `apps/web/src/app/meetings/[id]/page.tsx`

**No changes.** All existing features work: conversation analysis, tasks, people, manual notes, series.

**Conditional display:** If `meeting.source === 'notion_note'`, hide calendar-specific fields (time, endTime, location, calendarSource).

### `apps/web/src/components/Modals/MeetingModal.tsx` (if user creates meetings manually)

**Change:** Add hidden `source` field defaulting to `'manual'` when user creates a meeting from UI (not from calendar or Notion).

## Out of scope

- Merging meetings after the fact (if a calendar event and note overlap, they stay separate unless matched at sync time)
- Backfilling `source` field for existing meetings (defaults handle this; all pre-existing meetings default to `'calendar'`)
- UI for manually converting a note-sourced meeting to calendar-synced
- Deleting the auto-created meeting if the Notion note is deleted (handled by foreign key `ON DELETE SET NULL`)

## Open questions

- **Category assignment:** Should note-sourced meetings default to a specific category (e.g., `'general'`) or derive from note metadata?
  - **Recommendation:** Default to `'general'`, user can edit.
  
- **Time field:** Note-sourced meetings have date but no time. Should we populate `time` with `'00:00'` or leave null?
  - **Recommendation:** Leave null, UI conditionally hides time fields.

- **Retroactive linking:** Should we run a one-time migration to link all existing orphaned notes?
  - **Recommendation:** Yes, as a `mutation` procedure `meetings.linkOrphanedNotes` that QA can manually trigger post-deploy.

## Testing notes

**Vitest (`packages/api/src/services/notion-meeting-sync.test.ts`):**
- `ensureMeetingForNote` creates meeting when none exists
- `ensureMeetingForNote` reuses existing meeting with same title+date
- `ensureMeetingForNote` updates note's `meetingId`

**Playwright (`apps/web/e2e/notion-note-meetings.spec.ts`):**
- Seed orphaned note, trigger sync, verify meeting appears in `/meetings`
- Verify note-sourced meeting shows badge/icon
- Verify conversation analysis works on note-sourced meeting
- Verify task creation from note-sourced meeting

## Implementation order

1. **Database:** Add `source` and `sourceNoteId` columns to `meetings` (schema + bootstrap SQL)
2. **Service:** Implement `ensureMeetingForNote` function
3. **Sync integration:** Call `ensureMeetingForNote` in Notion sync for orphaned notes
4. **UI badge:** Add visual indicator in `/meetings` list
5. **UI conditional:** Hide calendar fields in `/meetings/[id]` when `source !== 'calendar'`
6. **Tests:** Vitest + Playwright coverage
7. **Retroactive link:** Add `meetings.linkOrphanedNotes` mutation for one-time cleanup
