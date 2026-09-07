# Meetings Page UX Redesign

**Detected stack:** `next-trpc-monorepo`

## Goal

Redesign the meetings page to solve cognitive overload from 192+ flat-listed meetings by introducing temporal grouping, smart filtering, progressive disclosure, and visual hierarchy that prioritizes today's meetings while keeping advanced options accessible but hidden by default.

## User Stories

1. As a user, I want to see today's meetings at the top with prominent styling, so I know what's immediately relevant without scanning a long list.
2. As a user, I want meetings grouped by temporal buckets (today/tomorrow/this week/later), so I can mentally prepare and focus on what matters now.
3. As a user, I want less visual noise on each meeting card, so I can scan the list quickly without cognitive overload.
4. As a user, I want recurring meeting instances collapsed by default, so they don't clutter my timeline view with 50 identical "Daily Standup" entries.
5. As a user, I want quick one-click filters for "today" and "this week", so I can instantly focus on my immediate schedule.
6. As a user, I want to search meetings by title, participant, or project, so I can quickly find a specific meeting.
7. As a user, I want advanced filters (by person, status, project) hidden by default, so I'm not overwhelmed but can access them when needed.
8. As a user, I want clear visual distinction between urgent and future meetings, so I can prioritize my attention appropriately.
9. As a user, I want to manage recurring series separately in a dedicated view, so I can edit/pause series without seeing all individual instances.

## Acceptance Criteria

**Temporal Grouping:**

- GIVEN I open the meetings page with meetings spanning multiple weeks
- WHEN the page loads
- THEN I see collapsible sections: "היום", "מחר", "השבוע", "שבוע הבא", "מאוחר יותר"
- AND "היום" section is always expanded
- AND sections with 0 meetings are hidden
- AND sections with >5 meetings are collapsed by default (except "היום")

**Visual Hierarchy:**

- GIVEN a meeting is scheduled for today
- WHEN I view it in the "היום" section
- THEN it has a 3px accent border on the right (RTL), larger font, and subtle accent background gradient
- AND the time is displayed prominently

- GIVEN a meeting is 2 weeks away
- WHEN I view it in "מאוחר יותר"
- THEN it shows only title + date in a compact card
- AND full details appear on hover

**Quick Filters:**

- GIVEN I'm viewing the meetings page
- WHEN I click the "היום" quick filter button
- THEN only today's meetings are shown
- AND the button shows a count badge: "היום (3)"
- AND other temporal sections are hidden

- GIVEN I click "השבוע" filter
- WHEN the filter is applied
- THEN only meetings within 7 days are shown

- GIVEN I toggle "עם משימות" filter
- WHEN active
- THEN only meetings with linked tasks are shown

**Search:**

- GIVEN I type "Daz" in the search box
- WHEN I finish typing
- THEN I see only meetings with "Daz" in: title, participant name, or project name
- AND the search is instant (client-side filter, no API call)
- AND empty state shows: "לא נמצאו פגישות התואמות לחיפוש"

**Progressive Disclosure (Advanced Filters):**

- GIVEN I open the meetings page
- WHEN I first arrive
- THEN the advanced filters panel is hidden
- AND I see only a "פילטרים מתקדמים ▾" button

- GIVEN I click "פילטרים מתקדמים"
- WHEN the panel opens
- THEN I see dropdowns for: משתתפים (multi-select), סטטוס (single), פרויקט (single)
- AND each dropdown shows all available options

- GIVEN I select 2 people and 1 project in advanced filters
- WHEN I click "החל"
- THEN only meetings matching ALL selected criteria are shown
- AND the panel remains open with active selections visible
- AND a clear indicator shows filters are active

- GIVEN I have active advanced filters
- WHEN I click "אפס"
- THEN all advanced filters clear
- AND all meetings return to view

**Recurring Series Management:**

- GIVEN a recurring meeting series with 20 instances
- WHEN viewing the timeline
- THEN I see only the next instance with a "↻" badge
- AND clicking "↻" expands all upcoming instances inline

- GIVEN I navigate to the "סדרות" tab
- WHEN the tab loads
- THEN I see a list of all recurring series
- AND each series card shows: title, cadence (daily/weekly/etc), next date, participant avatars
- AND I can edit/pause/skip next instance for each series

**Information Density:**

- GIVEN a meeting card in "מאוחר יותר" section
- WHEN viewing the collapsed card
- THEN I see: title, date, max 2 participant avatars
- AND badges (project, tasks, source) are hidden
- AND hover reveals full card with all details

**Performance:**

- GIVEN 192 upcoming meetings
- WHEN the page loads
- THEN initial render shows ≤30 meetings (today + tomorrow + current week expanded)
- AND "מאוחר יותר" section is collapsed and loads on expand

## Data Model

No schema changes required. All features use existing tables:

- `meetings`: existing columns (`id`, `title`, `date`, `meetingSeriesId`, `projectId`, etc.)
- `meetingSeries`: existing for recurring meetings
- `meetingPeople`: existing for participant links
- `tasks`: existing for task links

## tRPC API

**Router:** `packages/api/src/routers/meetings.ts` (existing)

### New Procedure: `listGrouped`

- **Kind:** `query`
- **Input:**
  ```typescript
  z.object({
    groupBy: z.enum(['temporal', 'project', 'series']).default('temporal'),
    includeRecurringInstances: z.boolean().default(false),
  })
  ```
- **Return shape:**
  ```typescript
  {
    today: Meeting[],
    tomorrow: Meeting[],
    thisWeek: Meeting[],
    nextWeek: Meeting[],
    later: Meeting[]
  }
  ```
- **Auth:** `protectedProcedure`
- **Notes:** Filters meetings into temporal buckets based on `date` field. When `includeRecurringInstances` is false, groups recurring series and returns only next instance per series with `_seriesInstanceCount` added to meeting object.

### Modified Procedure: `list`

- **Kind:** `query`
- **Input (add):**
  ```typescript
  z.object({
    timeRange: z.enum(['today', 'tomorrow', 'week', 'all']).optional(),
    withTasks: z.boolean().optional(),
    projectId: z.string().optional(),
    personId: z.string().optional(),
    status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
  }).optional()
  ```
- **Return shape:** Existing `Meeting[]` with linked people, tasks, projects
- **Auth:** `protectedProcedure`
- **Notes:** Add WHERE clauses for new optional filters. `timeRange` filters by date ranges, `withTasks` joins on tasks table, `personId` joins on meetingPeople.

## UI Surface

**Primary file:** `apps/web/src/app/meetings/page.tsx` (major refactor)

### New Components to Create

1. **`apps/web/src/app/meetings/components/SearchInput.tsx`**
   - Controlled text input with search icon
   - Props: `value`, `onChange`, `placeholder`
   - Matches existing `.input` design system class

2. **`apps/web/src/app/meetings/components/QuickFilterButton.tsx`**
   - Button with optional count badge
   - Props: `active: boolean`, `count?: number`, `children`, `onClick`
   - Active state: accent border + accent text color
   - Badge positioned top-right with count

3. **`apps/web/src/app/meetings/components/AdvancedFiltersPanel.tsx`**
   - Collapsible panel with 3 dropdowns + 2 buttons
   - Props: `selectedPeople: string[]`, `selectedStatus?: string`, `selectedProject?: string`, `allPeople: Person[]`, `allProjects: Project[]`, `onApply`, `onClear`
   - Uses existing `.card` background
   - Dropdowns use browser native `<select>` (multi-select for people uses multiple attribute)

4. **`apps/web/src/app/meetings/components/TimelineSection.tsx`**
   - Collapsible section with header + children
   - Props: `title: string`, `count: number`, `defaultExpanded: boolean`, `children`
   - Header: 13px bold text, click to expand/collapse
   - Animated height transition

5. **`apps/web/src/app/meetings/components/MeetingCardCompact.tsx`**
   - Minimal meeting card for "later" meetings
   - Props: `meeting: Meeting`
   - Shows: title, date, 1-2 avatar circles only
   - On hover: expands to full `MeetingCard`

### Modified Components

1. **`apps/web/src/app/meetings/page.tsx`**
   - Replace `activeTab` state with `viewMode: 'timeline' | 'series' | 'past'`
   - Add state: `searchQuery`, `quickFilter: 'all' | 'today' | 'week'`, `showAdvancedFilters`, `advancedFilters: { people, status, project }`
   - Add `useMemo` hook for temporal grouping (client-side, based on `Date` comparison)
   - Add `useMemo` hook for filtering (search + quick + advanced)
   - Replace flat meeting list with `<TimelineSection>` components per temporal bucket
   - Add header bar with search + quick filters + advanced toggle
   - Conditionally render `<AdvancedFiltersPanel>` when `showAdvancedFilters` is true

2. **`apps/web/src/app/meetings/components/MeetingCard.tsx`** (existing, slight modification)
   - Add prop: `importance: 'urgent' | 'normal' | 'compact'`
   - When `importance === 'urgent'`: add `.meeting-card-today` class
   - When `importance === 'compact'`: reduce padding, hide badges

### CSS Changes

**File:** `apps/web/src/app/globals.css`

Add utility classes:

```css
.meeting-card-today {
  border-right: 3px solid var(--accent); /* RTL */
  background: linear-gradient(to left, rgba(45, 212, 191, 0.05), transparent);
  padding: 20px;
}

.meeting-card-compact {
  padding: 12px 16px;
}

.timeline-section-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-body);
  margin: 24px 0 12px;
  cursor: pointer;
  user-select: none;
}

.filter-badge {
  position: absolute;
  top: -4px;
  left: -4px; /* RTL: left side */
  background: var(--accent);
  color: var(--bg-primary);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

.quick-filter-active {
  border: 1px solid var(--accent);
  color: var(--accent);
  background: rgba(45, 212, 191, 0.05);
}
```

### Logic: Temporal Grouping Helper

**File:** `apps/web/src/app/meetings/lib/temporal-grouping.ts` (new)

```typescript
import { isSameDay, isToday, isTomorrow, isThisWeek, isAfter, addDays } from 'date-fns'

export function groupMeetingsByTime(meetings: Meeting[]) {
  const now = new Date()
  const tomorrowDate = addDays(now, 1)
  const weekEnd = addDays(now, 7)
  const nextWeekEnd = addDays(now, 14)

  return {
    today: meetings.filter(m => isToday(new Date(m.date))),
    tomorrow: meetings.filter(m => isTomorrow(new Date(m.date))),
    thisWeek: meetings.filter(m => {
      const date = new Date(m.date)
      return !isToday(date) && !isTomorrow(date) && isThisWeek(date)
    }),
    nextWeek: meetings.filter(m => {
      const date = new Date(m.date)
      return isAfter(date, weekEnd) && date < nextWeekEnd
    }),
    later: meetings.filter(m => {
      const date = new Date(m.date)
      return isAfter(date, nextWeekEnd)
    })
  }
}
```

### Logic: Client-Side Search

**File:** `apps/web/src/app/meetings/lib/search.ts` (new)

```typescript
export function searchMeetings(meetings: Meeting[], query: string): Meeting[] {
  if (!query.trim()) return meetings
  
  const lowerQuery = query.toLowerCase()
  
  return meetings.filter(meeting => {
    // Search in title
    if (meeting.title.toLowerCase().includes(lowerQuery)) return true
    
    // Search in participants
    if (meeting.people?.some(p => p.name.toLowerCase().includes(lowerQuery))) return true
    
    // Search in project
    if (meeting.project?.name?.toLowerCase().includes(lowerQuery)) return true
    
    return false
  })
}
```

## Out of Scope

- Calendar view (month/week grid visualization)
- Inline meeting notes preview in cards
- Bulk operations (mark multiple meetings as completed)
- Drag-and-drop rescheduling
- Meeting types management UI (already exists in settings)
- External calendar sync UI changes (already exists)
- Custom sort orders (alphabetical, by attendee count)
- Mobile responsive layout changes (focus is desktop web)
- Timezone display/conversion
- Meeting duration optimization suggestions

## Open Questions

None.
