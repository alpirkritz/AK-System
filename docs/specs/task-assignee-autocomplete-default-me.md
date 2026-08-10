# Task Assignee — Autocomplete + Default to Me

> **Slug:** `task-assignee-autocomplete-default-me`
> **Status:** Draft
> **Last Updated:** 2026-08-06
> **Detected stack:** `next-trpc-monorepo` (+ Helm Expo mobile)

## Goal

Picking who owns a task is slower than it should be. On web the **אחראי** field is a plain `<select>` listing every contact, so finding a person means scrolling instead of typing. On Helm there is no assignee field at all. On top of that, almost every task the owner creates through the app is his own, yet each one starts with no assignee. This change turns the assignee field into a type-to-filter picker on both surfaces and makes "me" the default owner for tasks created through the system, while leaving Notion-sourced assignments untouched. It also adds a manual **סנכרן מ-Notion** button to the Helm tasks screen, matching the one web already has.

## User Stories

- As the owner, I want a new task to default to me as אחראי so I do not set the same value every time.
- As the owner, I want to click the אחראי field and type part of a name to filter the list, so I can pick a person without scrolling.
- As the owner, I want to clear the assignee explicitly when a task belongs to nobody, and have that choice respected.
- As the owner, I want to set the assignee from the Helm app too, not only on web.
- As the owner, I want tasks imported from Notion to keep the assignee Notion says they have, even when that is not me.
- As the owner, I want a sync button on the Helm tasks screen so I can pull tasks from Notion without opening the web app.

## Acceptance Criteria

- [ ] Creating a task without specifying `assigneeId` stores the owner's own person row as `assigneeId`.
- [ ] Creating a task with `assigneeId: null` (explicit "ללא אחראי") stores `null` — the default does not override it.
- [ ] Creating a task with an explicit `assigneeId` stores that value.
- [ ] `tasks.update` never injects a default assignee; editing a task with no assignee leaves it empty.
- [ ] Notion sync keeps assigning tasks to the person Notion reports; the new default does not apply to that path.
- [ ] `people.me` returns the owner's person row, creating it once if missing, and returns the same id on repeat calls.
- [ ] The web אחראי field is a combobox: clicking it focuses a text input, typing filters options by name, company, or role.
- [ ] The combobox supports `ArrowDown`/`ArrowUp` to move the highlight, `Enter` to select, `Escape` to close without changing the value.
- [ ] The combobox pins the owner to the top of the list with an **אני** tag and offers **ללא אחראי** to clear.
- [ ] Opening "משימה חדשה" on web pre-fills אחראי with the owner's name.
- [ ] Helm's task form shows an **אחראי** row that opens a searchable picker, pre-filled with the owner on `/task/new`.
- [ ] The Helm tasks screen shows a **סנכרן מ-Notion** button when Notion is configured; it disables while running, reports the result in Hebrew, and refreshes the list.
- [ ] The sync button is hidden when Notion is not configured.

## Data Model

**No schema changes.** `tasks.assigneeId` (text, nullable, FK → `people.id`) already exists in both `packages/database/src/schema.ts` and `schema.pg.ts`.

The "who am I" person is resolved by name, reusing the convention Notion sync already established: a `people` row whose `name` equals `NOTION_USER_NAME` (default `Alpir Kritzler`), created with an `id` prefixed `p_me_` when missing. No `isSelf` column, no `userSettings` field.

## tRPC API

### New service — `packages/api/src/services/self-person.ts`

```ts
export function getSelfPersonName(): string
export async function ensureSelfPerson(db?: Db): Promise<{ id: string; name: string; color: string | null }>
```

`ensureSelfPerson` looks up `people` by lowercased name and inserts a row (`status: 'confirmed'`, `source: 'manual'`, `color: '#e8c547'`) when absent. `packages/api/src/services/notion-tasks-sync.ts` delegates its inline "ensure a person row exists for the user" block to this service so both paths converge on one row.

### `packages/api/src/routers/people.ts`

| Procedure | Kind | Input | Return | Auth |
|---|---|---|---|---|
| `me` | query | none | `{ id: string; name: string; color: string \| null }` | required |

### `packages/api/src/routers/tasks.ts`

`create` keeps its input shape (`assigneeId: z.string().nullable().optional()`) but changes behaviour: when the key is absent (`undefined`), it resolves `ensureSelfPerson()` and stores that id. `null` and explicit ids pass through unchanged. `update` is untouched.

No changes to `tasks.syncFromNotion` — the Helm button calls the existing procedure with `{ windowDays: 60, dryRun: false }`.

## UI Surface

### Web — `apps/web`

**New:** `src/components/ui/PersonSelect.tsx` — combobox over `{ id, name, company, role, color }`, modelled on `CreatableSelect.tsx` but id-based and without a create-new affordance.

- Trigger uses `.input`, `role="combobox"`, `aria-expanded`, `aria-controls`; the popup uses `role="listbox"` with `role="option"` children and `aria-activedescendant`.
- Typing filters on name, company, role. Keyboard: arrows move the highlight, `Enter` selects, `Escape` closes, outside click closes.
- Self person pinned first with an **אני** tag; **ללא אחראי** clears to `null`; no matches renders **לא נמצא איש קשר**.
- Options are ≥44px tall, right-aligned, inheriting RTL from the layout.

**Changed:** `src/components/Modals/TaskModal.tsx` — the אחראי `<select>` is replaced by `PersonSelect`. In create mode the form initialises `assigneeId` from `trpc.people.me`; in edit mode the task's stored value wins and is never overwritten.

`QuickAddTaskModal.tsx` gains no field — the server default covers it.

### Mobile — `apps/mobile`

**Changed:** `lib/data.ts` — `TaskInput` gains `assigneeId?: string | null`; new `fetchSelfPerson`, `fetchNotionConfigured`, and `syncTasksFromNotion` wrappers.

**Changed:** `app/task/[id].tsx` — an **אחראי** row under the title opens a bottom-sheet `Modal` with a search `TextInput` and a filtered `FlatList` (same filter predicate as the people tab). `/task/new` pre-selects the owner with an **אני** tag. Rows are ≥48px, right-aligned, dark theme from `lib/theme.ts`.

**Changed:** `app/(tabs)/tasks.tsx` — an action row above the filter chips holds a ghost **סנכרן מ-Notion** button (rendered only when `notionConfigured` is true). While running it shows **מסנכרן…** with a spinner and is disabled; on completion it renders a neutral status line (`יובאו N משימות מ-Notion`, or `יובאו N משימות · X שגיאות`, or **הסנכרון נכשל**) and reloads the list. Pull-to-refresh stays a local reload.

### Hebrew microcopy

| Element | Copy |
|---|---|
| Field label | אחראי |
| Combobox placeholder | התחל להקליד שם... |
| Clear option | ללא אחראי |
| Self tag | אני |
| No results | לא נמצא איש קשר |
| Sync button | סנכרן מ-Notion |
| Sync pending | מסנכרן… |
| Sync failure | הסנכרון נכשל |

## Out of Scope

- Combobox treatment for the project, meeting, or workspace selects — they stay `<select>`.
- Changing the existing "קשור לאנשים" multi-select (it already has search).
- Adding an assignee field to `QuickAddTaskModal`.
- Creating a new contact from inside the picker.
- Changing how Notion sync picks an assignee.
- An `isSelf` column or a "who am I" setting screen.
- Background or automatic sync on mobile, a day-window selector, or dry-run from the app.

## Open Questions

None.
