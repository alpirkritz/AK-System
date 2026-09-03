# Deep Analysis of Meeting Transcripts from Notion

**Stack:** `next-trpc-monorepo`  
**Slug:** `meeting-transcript-deep-analysis`  
**Status:** Draft  
**Created:** 2026-09-03

---

## Goal

Enable deep qualitative analysis of meeting conversations — mood, subtext, strategic insights, and kaizen feedback — by extracting and analyzing the raw transcript blocks from Notion AI Meeting Notes that are currently fetched but discarded.

---

## User Stories

1. **As a user**, I want to see a rich analysis of my recorded meetings (mood, subtext, key insight, kaizen) so that I can reflect on conversation dynamics beyond just the action items.

2. **As a user**, I want the system to automatically identify action items with owners from the conversation so that I can quickly convert them to tasks without manual re-typing.

3. **As a user**, I want this analysis delivered to my WhatsApp/Telegram in the same format as my other briefings so that I get a consistent notification experience.

4. **As a user**, I want to review action items before they become tasks so that I maintain control over what enters my task list.

5. **As a user**, I want this to work retroactively on all my past recorded meetings in Notion so that I can analyze historical conversations without re-recording.

---

## Acceptance Criteria

### Transcript Extraction
- **Given** a meeting with a Notion AI Meeting Notes page containing both structured summary and raw transcript blocks
- **When** the system syncs meeting notes
- **Then** both the structured summary (existing behavior) and the raw transcript (new) are extracted and stored separately

### Analysis Execution
- **Given** a meeting with a raw transcript
- **When** I click "Analyze Conversation" on the meeting detail page or the cron runs for recently-ended meetings
- **Then** the system sends the transcript to Gemini with a JSON schema prompt and stores the structured analysis

### Analysis Content
- **Given** a completed analysis
- **Then** it includes: selected "hat" (analytical lens), topic, mood, subtext, key insight, score (1-10), score rationale, kaizen keep/improve, open question, participants with confirmation status, and action items with identified owners

### Action Item Review
- **Given** an analysis with action items
- **When** I view the meeting detail page
- **Then** each action item shows with a "Create Task" button, and there's a "Create All Tasks" button at the top

### Action Item Task Creation
- **Given** I click "Create Task" on an action item
- **When** the task is created
- **Then** it is linked to the meeting, assigned to the identified person (if found in contacts), and the analysis record is updated with the task ID

### Auto-Creation (Optional)
- **Given** I enable `autoCreateActionItemTasks` in settings
- **When** an analysis completes
- **Then** all action items with identified owners are automatically converted to tasks without manual review

### Message Distribution
- **Given** an analysis completes via cron
- **When** the formatted message is ready
- **Then** it is sent via `pushAssistantMessage` to WhatsApp/Telegram/push (per user's `meeting_analysis` notification preferences), matching the format from the example

### Retroactive Analysis
- **Given** historical meetings with Notion transcripts
- **When** I open a meeting detail page without an analysis
- **Then** I see an "Analyze Conversation" button that triggers on-demand analysis

---

## Data Model Changes

### New Table: `meeting_analyses`

**Location:** `packages/database/src/schema.pg.ts` (canonical) + mirror in `schema.ts`

**Columns:**

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | text | NOT NULL | PK | `'ma_' + Date.now()` |
| `meetingId` | text | NOT NULL | — | FK → `meetings.id` ON DELETE CASCADE |
| `meetingNoteId` | text | NULL | — | FK → `meeting_notes.id` ON DELETE SET NULL (source note) |
| `source` | text | NOT NULL | — | `'notion_transcript'` \| `'recording'` (future) |
| `transcriptText` | text | NULL | — | Raw conversation text (cap at 50k chars) |
| `hatName` | text | NULL | — | Selected analytical lens (e.g., "McKinsey + Tech Innovation") |
| `topic` | text | NULL | — | Conversation topic/focus |
| `mood` | text | NULL | — | Conversation mood/atmosphere |
| `subtext` | text | NULL | — | Hidden dynamics/unspoken themes |
| `keyInsight` | text | NULL | — | Main takeaway |
| `score` | integer | NULL | — | 1-10 rating |
| `scoreRationale` | text | NULL | — | Reasoning for the score |
| `kaizenKeep` | text | NULL | — | What to continue doing |
| `kaizenImprove` | text | NULL | — | What to improve |
| `openQuestion` | text | NULL | — | Thought-provoking question for reflection |
| `participantsJson` | text | NULL | — | JSON array: `[{name, confirmed: bool}]` |
| `actionItemsJson` | text | NULL | — | JSON array: `[{content, owner?, taskId?}]` |
| `model` | text | NULL | — | Gemini model ID used |
| `status` | text | NOT NULL | `'pending'` | `'pending'` \| `'completed'` \| `'failed'` |
| `error` | text | NULL | — | Error message if failed |
| `createdAt` | text | NOT NULL | — | ISO-8601 string |
| `updatedAt` | text | NOT NULL | — | ISO-8601 string |

**Indexes:**
- `idx_meeting_analyses_meeting_id` on `meetingId`
- `idx_meeting_analyses_status` on `status`

**Bootstrap SQL** (in `packages/database/src/index.ts`):
Add to a new `MEETING_ANALYSES_TABLES` array, executed in `getDb()` SQLite bootstrap loop.

---

## Transcript Extraction Changes

### File: `packages/api/src/services/notion-meeting-note-body.ts`

#### New Export: `extractRawTranscript`

```typescript
export function extractRawTranscript(
  blocks: Array<Record<string, unknown>>,
  cap = 50000,
): string
```

**Logic:** Mirror of `extractAiMeetingSummary`, but **keeps** blocks passing `isTranscriptishBlock` instead of skipping them. Flattens to plain text, respects cap.

#### Modified: `fetchMeetingNoteBody` Return Type

Add field:
```typescript
{
  bodyText: string          // existing structured summary
  transcriptText: string    // NEW: raw transcript
  sourceBlockId: string | null
  topLevelTypes: string
  blockCount: number
}
```

**Implementation note:** Since `MEETING_NOTE_MAX_BLOCKS = 200` and `MEETING_NOTE_BODY_CAP = 8000` are too small for hour-long conversations, the extraction should:
1. Locate the transcript block ID via `findAiNotesWidget` → children
2. If a transcript-ish child is found, fetch its full content directly via `fetchBlockChildrenWithFallback` with higher caps
3. Use `MEETING_TRANSCRIPT_CAP = 50000` chars

#### Modified: `upsertInPageMeetingNote`

Add `transcriptText` and `transcriptSyncedAt` to the upsert in `meeting_notes` schema (new columns).

---

## Analysis Service

### New File: `packages/api/src/services/meeting-analysis.ts`

Pattern: modeled after `invoice-ocr.ts` (Gemini with JSON schema).

#### Export: `analyzeTranscript`

```typescript
export async function analyzeTranscript(options: {
  transcriptText: string
  meetingTitle: string
  meetingDate: string
  participantNames?: string[]
}): Promise<AnalysisResult>

interface AnalysisResult {
  hatName: string
  topic: string
  mood: string
  subtext: string
  keyInsight: string
  score: number
  scoreRationale: string
  kaizenKeep: string
  kaizenImprove: string
  openQuestion: string
  participants: Array<{ name: string; confirmed: boolean }>
  actionItems: Array<{ content: string; owner?: string }>
}
```

**Gemini call:**
- Model: `getGeminiModelId()` from `gemini-config.ts`
- `responseMimeType: 'application/json'`
- `responseSchema`: Gemini JSON schema matching `AnalysisResult`
- Prompt references the "hats catalog" from `A_Agents/09_conversation_analyst.md` (see Agent Card section below)

**Error handling:** Throw descriptive errors; caller stores in `meeting_analyses.error`.

---

## Agent Card & Skill (Business Logic)

Per `.cursorrules` code-agnostic rule, the "hats" catalog and analysis criteria go into markdown files, not code.

### New File: `A_Agents/09_conversation_analyst.md`

```markdown
# Conversation Analyst

**ID:** `09_conversation_analyst`  
**Role:** Deep qualitative analysis of meeting transcripts

## Responsibilities
- Select the appropriate analytical "hat" based on conversation context
- Extract mood, subtext, and strategic insights
- Identify actionable next steps with owners
- Provide kaizen feedback (keep/improve)

## Analytical Hats Catalog
1. **McKinsey + Tech Innovation** — strategy, digital transformation, organizational change
2. **Clinical Psychology** — interpersonal dynamics, conflict resolution, emotional intelligence
3. **Product Management** — user needs, prioritization, trade-offs, roadmap decisions
4. **Sales & Negotiation** — persuasion tactics, objection handling, deal structure
5. **Executive Coaching** — leadership presence, decision quality, stakeholder management
6. **Engineering Deep Dive** — technical accuracy, design patterns, architectural trade-offs
7. **Default (General Business)** — when no specialized lens applies

## Output Format
See `S_Skills/wf_conversation_analysis.md` for step-by-step workflow.
```

### New File: `S_Skills/wf_conversation_analysis.md`

```markdown
# Workflow: Conversation Analysis

**Agent:** `09_conversation_analyst`

## Input
- Raw meeting transcript (plain text dialogue)
- Meeting metadata (title, date, known participants)

## Steps

### 1. Hat Selection
- Read the first 500 words of the transcript
- Identify the primary subject domain
- Select the most appropriate analytical hat from the catalog
- Default to "General Business" if uncertain

### 2. Core Analysis
Extract and document:
- **Topic:** One sentence describing the conversation focus
- **Mood:** Professional descriptor (e.g., "focused and collaborative", "tense with urgency")
- **Subtext:** Hidden dynamics not explicitly stated (power dynamics, unspoken concerns, implicit assumptions)
- **Key Insight:** The most important takeaway or realization from the conversation

### 3. Scoring
- Assign a 1-10 score evaluating conversation quality/productivity
- Provide rationale citing specific patterns (e.g., "8/10: clear decisions made, but implementation details deferred")

### 4. Kaizen Feedback
- **Keep:** What worked well in this conversation that should be preserved
- **Improve:** What could be enhanced next time (communication style, agenda structure, follow-through)

### 5. Participants
- List all speakers identified in the transcript
- Mark each as `confirmed: true` if clearly named, `confirmed: false` if inferred

### 6. Action Items
- Extract explicit commitments and next steps
- For each item, identify the owner if mentioned ("Alice will...", "I'll follow up...")
- Format as `{ content, owner? }`

### 7. Open Question
- Formulate one thought-provoking question for the user to reflect on

## Output
Structured JSON matching `AnalysisResult` schema (see `meeting-analysis.ts`).
```

---

## tRPC API Surface

### Router: `packages/api/src/routers/meetings.ts` (extend existing)

#### New Procedures

**1. `analyzeTranscript` (mutation)**

```typescript
Input: z.object({
  meetingId: z.string().min(1),
  force: z.boolean().optional()
})

Returns: { analysisId: string }
```

**Logic:**
1. Fetch meeting + linked `meeting_notes` with `transcriptText`
2. If no transcript, return error `"No transcript available"`
3. If analysis exists and `force !== true`, return existing `analysisId`
4. Create `meeting_analyses` row with `status='pending'`
5. Fetch meeting participants via `meeting_people` join
6. Call `analyzeTranscript` service
7. Update row with results, set `status='completed'` or `'failed'`

**2. `getAnalysis` (query)**

```typescript
Input: z.object({
  meetingId: z.string().min(1)
})

Returns: {
  id: string
  hatName: string
  topic: string
  mood: string
  subtext: string
  keyInsight: string
  score: number
  scoreRationale: string
  kaizenKeep: string
  kaizenImprove: string
  openQuestion: string
  participants: Array<{ name: string; confirmed: boolean }>
  actionItems: Array<{ content: string; owner?: string; taskId?: string }>
  status: string
  error?: string
  createdAt: string
} | null
```

**Logic:** Select from `meeting_analyses` where `meetingId` matches, order by `createdAt DESC`, return first or null.

**3. `createTasksFromAnalysis` (mutation)**

```typescript
Input: z.object({
  analysisId: z.string().min(1),
  indices: z.array(z.number()).optional()
})

Returns: { createdTaskIds: string[] }
```

**Logic:**
1. Fetch analysis row
2. Parse `actionItemsJson`
3. For each item (or only specified `indices`):
   - Create task via `tasks` insert: `{ title: item.content, meetingId, assigneeId: matchPerson(item.owner), source: 'meeting_analysis' }`
   - Write `taskId` back to `actionItemsJson[i].taskId`
4. Update analysis row with modified JSON
5. Return created task IDs

**Helper:** `matchPerson(ownerName?: string): string | null` — fuzzy match against `people` table by name.

---

## Cron Distribution

### New File: `apps/web/src/app/api/cron/transcript-analysis/route.ts`

**Schedule:** Every 15 minutes (add to existing cron setup, likely OS cron or similar)

**Logic:**
1. Query meetings where:
   - `endTime` (or inferred end = `time` + 1 hour) is within the last 30 minutes
   - Linked `meeting_notes.transcriptText IS NOT NULL`
   - No corresponding `meeting_analyses` row (or existing row has `status='failed'` and `createdAt` > 1 hour ago for retry)
2. For each eligible meeting:
   - Call `meetings.analyzeTranscript({ meetingId, force: false })`
   - On success, fetch the analysis
   - Format message via `formatAnalysisMessage` (new helper)
   - Call `pushAssistantMessage(message, 'cron', { typeId: 'meeting_analysis' })`

### New Helper: `formatAnalysisMessage`

**File:** `apps/web/src/lib/analysis-message-formatter.ts` (or add to existing helpers)

**Signature:**
```typescript
export function formatAnalysisMessage(analysis: AnalysisResult, meetingTitle: string): string
```

**Output format** (Hebrew, matching the example):
```
✅ *ההקלטה נותחה!*

👥 *משתתפים:* [names, with (unconfirmed) suffix if not confirmed]

🧠 הכובע שנבחר: [hatName]

📌 נושא השיחה: [topic]

🎭 אווירה: [mood]

🕵️ הסאב-טקסט: [subtext]

💡 תובנה מרכזית: [keyInsight]

⚖️ מדד: [score]/10. [scoreRationale]

✅ אקשן אייטמס:
• [item 1]
• [item 2]
...

📈 קאיזן:
✓ לשימור: [kaizenKeep]
→ לשיפור: [kaizenImprove]

❓ שאלה למחשבה: [openQuestion]
```

### Notification Preferences Extension

**File:** `packages/api/src/services/notification-preferences.ts`

Add `'meeting_analysis'` to the `SCHEDULABLE_TYPES` or event-type registry so it can be:
- Routed to an agent (e.g., a specialized analyst agent)
- Disabled per-channel (WhatsApp/Telegram/push)

---

## UI Surface

### File: `apps/web/src/app/meetings/[id]/page.tsx` (extend existing)

#### New Section: Conversation Analysis

**Location:** Insert after "AI Summary (Notion)" section, before "Notes"

**Component:** `<ConversationAnalysis meetingId={id} />`

### New Component: `apps/web/src/app/meetings/components/ConversationAnalysis.tsx`

**Props:** `{ meetingId: string }`

**tRPC calls:**
- `meetings.getAnalysis` (query)
- `meetings.analyzeTranscript` (mutation)
- `meetings.createTasksFromAnalysis` (mutation)

**UI Structure:**

1. **Header row:**
   - "ניתוח שיחה" heading
   - "נתח שיחה" button (primary, triggers `analyzeTranscript`) — only shown if no analysis or status='failed'
   - Loading spinner if `status='pending'`

2. **Content (if analysis exists and status='completed'):**
   - Hat badge: `hatName` in colored pill
   - Grid layout (2 columns on desktop):
     - **Left column:**
       - Topic (bold)
       - Mood (with emoji prefix, e.g., 🎭)
       - Subtext (italic, with 🕵️ prefix)
       - Key Insight (highlighted card)
       - Score badge (`score/10`) + rationale
     - **Right column:**
       - Participants list (with ✓/? icon for confirmed/unconfirmed)
       - Kaizen section (✓ Keep / → Improve)
       - Open Question (? icon, distinct styling)
   - **Action Items section:**
     - "אקשן אייטמס" subheading
     - "Create All Tasks" button (secondary, disabled if all have `taskId`)
     - Each item as a card:
       - Item content
       - Owner name (if present) with person avatar/pill
       - "Create Task" button (hidden if `taskId` present; shows "View Task" link if present)

3. **Collapsible Raw Transcript:**
   - Accordion below the analysis: "תמלול מלא" (collapsed by default)
   - Shows `transcriptText` in monospace/readable font

**Error state:** If `status='failed'`, show error message and "Retry" button.

---

## Auto-Creation Setting

### Table: `user_settings` (extend existing, or new column if doesn't exist)

**New column:** `autoCreateActionItemTasks` (boolean, default `false`)

### Settings UI

**File:** `apps/web/src/app/settings/page.tsx` (or new tab if settings is tabbed)

Add toggle: "Automatically create tasks from meeting action items" with help text: "When enabled, action items identified in conversation analysis will be automatically converted to tasks linked to the meeting. You can still review them before marking done."

### Integration

In `apps/web/src/app/api/cron/transcript-analysis/route.ts`, after analysis completes:
```typescript
const userSettings = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
if (userSettings[0]?.autoCreateActionItemTasks) {
  await trpc.meetings.createTasksFromAnalysis({ analysisId: analysis.id })
}
```

---

## Out of Scope

1. **Real-time streaming analysis** — analysis runs in one shot, not incrementally
2. **Multi-language transcript detection** — assumes Hebrew or English; no automatic language switching
3. **Speaker diarization** — relies on Notion's transcript formatting; doesn't re-identify speakers
4. **Editing the raw transcript** — transcript is read-only; edit the source Notion page
5. **Custom hat creation by users** — hats catalog is fixed in `A_Agents/09_conversation_analyst.md`; editable by devs only
6. **Video/audio playback in UI** — analysis is text-only; original recording stays in Notion
7. **Sentiment trend over time** — no historical comparison or mood tracking across meetings (future enhancement)

---

## Open Questions

1. **Transcript length limits:** Should we truncate at 50k chars or fail gracefully and prompt for shorter meeting? (Recommendation: truncate with warning logged)
2. **Gemini Flash vs. Pro:** Is Flash sufficient for nuanced subtext analysis, or should we upgrade to Pro for this use case? (Recommendation: start with Flash, provide override env var)
3. **Action item deduplication:** If Notion summary already lists tasks and the analysis extracts overlapping ones, how do we handle? (Recommendation: analysis is independent; user reviews both)
4. **Unconfirmed participants matching:** Should we prompt to create new contacts for unrecognized names, or leave unassigned? (Recommendation: leave unassigned with `owner` string; user can manually assign)
5. **Privacy concern for third-party attendees:** Should we add a consent checkbox in UI before analyzing meetings with external participants? (Recommendation: yes, check if any participants are not in `people` with `status='external'`, show warning)

---

## Privacy & Compliance Notes

Per `C_Core/brand_dna_and_compliance.md`:

- **PII Handling:** Meeting transcripts contain conversations with other people. Analysis happens on user's own data already stored in their Notion; no external sharing. Processed analysis stored in local database with same access controls as meetings.
  
- **Consent:** This feature analyzes recordings the user already made in Notion with participants' presumed awareness. However, UI should note: "Only analyze meetings where all participants consented to recording."

- **Data Retention:** Analysis is retained as long as the meeting record exists. Deleting a meeting cascades to delete its analysis (`ON DELETE CASCADE`).

- **Disclaimer:** Analysis output is AI-generated and may misinterpret tone or context. Users should not rely on it for legal, HR, or other consequential decisions without human review.

- **Access Control:** Analysis follows meeting access control — if a user can view the meeting, they can view its analysis.

---

## Testing Notes

### Unit Tests (Vitest)

**File:** `packages/api/src/services/meeting-analysis.test.ts`

- Test `analyzeTranscript` with sample transcript fixture
- Verify JSON schema conformance
- Test error handling (empty transcript, malformed response)

**File:** `packages/api/src/services/notion-meeting-note-body.test.ts` (extend existing)

- Test `extractRawTranscript` preserves transcript blocks
- Test `isTranscriptishBlock` detection
- Test cap enforcement

### Integration Tests (Playwright)

**File:** `apps/web/e2e/meeting-analysis.spec.ts`

1. Seed a meeting with mock Notion transcript in `meeting_notes`
2. Navigate to `/meetings/[id]`
3. Click "Analyze Conversation"
4. Wait for analysis to complete
5. Verify analysis section displays all fields
6. Click "Create Task" on an action item
7. Verify task appears in meeting's task list
8. Test collapsible transcript toggle

---

## Implementation Order (Recommendation)

1. **Schema + bootstrap** — `meeting_analyses` table, SQLite migration
2. **Transcript extraction** — `extractRawTranscript`, modify `fetchMeetingNoteBody` + sync
3. **Analysis service** — `meeting-analysis.ts` + Gemini integration, agent card + skill markdown
4. **tRPC procedures** — `analyzeTranscript`, `getAnalysis`, `createTasksFromAnalysis`
5. **UI component** — `ConversationAnalysis.tsx`, integrate into meeting detail page
6. **Cron + distribution** — `transcript-analysis` route, message formatter, notification type
7. **Settings** — auto-creation toggle
8. **Tests** — Vitest service tests, Playwright e2e

Run manual QA on 2-3 real meetings from Notion before enabling cron.
