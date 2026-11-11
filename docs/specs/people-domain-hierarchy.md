# People Domain Hierarchy

> **Slug:** `people-domain-hierarchy`
> **Status:** Draft
> **Last Updated:** 2026-10-20

## Goal

Every person in the system currently lives in a flat, context-free list. Hugo (the Harness) can see that "מיכל לוי" exists but has no idea she is Alpir's direct manager at Dragontail (employer), not a client at Alpir Consulting. This feature adds a **life-domain layer**: each person is linked to one or more **workspaces** (life domains) with an explicit relationship type and an optional org-chart `reportsTo` line. The Harness person nodes are enriched with full domain context so Hugo can reason across domains ("who are my direct reports at Dragontail and what commitments are open with them?"). Google Contacts sync is enriched to pull phone, company, job title, and notes — providing additive enrichment of person records. The UI must be fully responsive and comfortable on **Samsung Galaxy Z Fold 7** both folded (cover, ~390 px) and unfolded (inner screen, ~768 px).

---

## Life Domains (current workspaces)

| Workspace | kind | Description |
|---|---|---|
| DAZ | `own_company` | סטארטאפ — שותף מייסד עם שני שותפים |
| Dragontail | `employer` | חברה בה אלפיר שכיר |
| Alpir Consulting | `own_company` | חברה פרטית — הרצאות וייעוץ |
| חיים אישיים | `personal` | משפחה, חברים, מכרים |

---

## User Stories

- As Alpir, I want to tag each person with the life domain(s) they belong to and the type of relationship, so I always know the context when Hugo mentions them.
- As Alpir, I want to see who reports to whom within each workspace, so I can navigate the org structure quickly.
- As Alpir, I want to filter the people list by workspace, so I can focus on one domain at a time.
- As Alpir, I want Google Contacts sync to fill in phone, company, job title, and notes that are missing from the system, so I don't have to re-enter data I already maintain in Google.
- As Alpir, I want Hugo to include domain and relationship context in every insight about a person, so the briefings are actionable and not generic.
- As Alpir, I want the people pages to work comfortably on my Z Fold 7 both folded and unfolded, so I can manage contacts on the go.

---

## Acceptance Criteria

- [ ] `workspaces` table has a `kind` column (`employer | own_company | personal | other`) and a `description` column; existing rows are unaffected.
- [ ] New table `person_workspaces` exists with the columns specified in Data Model.
- [ ] `workspaces.update` tRPC mutation accepts `kind` and `description`.
- [ ] `people.linkToWorkspace` creates/updates a `person_workspaces` row; duplicate `(personId, workspaceId)` is an upsert. A person may be linked to multiple workspaces simultaneously — this is expected behaviour, not an error.
- [ ] A person linked to both Dragontail and חיים אישיים shows two workspace badges and appears in both workspace filter views.
- [ ] `people.unlinkFromWorkspace` deletes the row.
- [ ] `people.listByWorkspace` returns confirmed people for a workspace, each with their `relationshipType` and `reportsToName`.
- [ ] `/people` page shows workspace filter chips; selecting one filters the list.
- [ ] Each person row/card shows workspace badge(s) + relationship type pill(s).
- [ ] `PersonDetailDrawer` has a "שיוכים" section: lists workspace affiliations, relationship type, reports-to; supports add/edit/remove via modal.
- [ ] Settings workspaces list shows a `kind` selector per workspace row.
- [ ] Google Contacts sync fills `people.phone`, `people.company`, `people.jobTitle`, `people.notes` additively (never overwrites existing non-empty values).
- [ ] Google Contacts sync shows a dry-run diff before committing.
- [ ] Harness person nodes carry `workspaces: [{name, kind, relationshipType, reportsToName?}]` in `attrs` and include one domain-context line in `summary`.
- [ ] All new UI is responsive: usable on 390 px (Z Fold 7 folded cover) and 768 px (Z Fold 7 unfolded inner screen).

---

## Data Model

### `workspaces` — additive columns

Changes in **`packages/database/src/schema.pg.ts`** and **`packages/database/src/schema.ts`**:

```
kind        text   nullable  -- 'employer' | 'own_company' | 'personal' | 'other'
description text   nullable  -- free text, e.g. "סטארטאפ עם שני שותפים"
```

No index needed (small table, never queried by kind in hot paths). Bootstrap SQL in `database/src/index.ts`:

```sql
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS description TEXT;
```

---

### New table `person_workspaces`

Add to **`schema.pg.ts`** and **`schema.ts`** (mirror exactly):

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | prefix `pw_` |
| `personId` | text NOT NULL → `people.id` CASCADE | |
| `workspaceId` | text NOT NULL → `workspaces.id` CASCADE | |
| `relationshipType` | text NOT NULL | free text; suggested values per kind (see below) |
| `reportsToPersonId` | text nullable → `people.id` SET NULL | org-chart line within this workspace |
| `notes` | text nullable | context note for this affiliation |
| `createdAt` | text NOT NULL | ISO timestamp |
| `updatedAt` | text NOT NULL | ISO timestamp |

Constraints:
- Unique index on `(personId, workspaceId)` — one row per (person, workspace) pair, **but a person may have rows for multiple workspaces** (many-to-many). For example, Lior can have `{ Dragontail, external }` AND `{ חיים אישיים, friend }` simultaneously. This is the expected and common case.
- Index on `workspaceId` for `listByWorkspace`.
- Index on `personId` for joining in people queries and Harness context.

Bootstrap SQL block in `database/src/index.ts`:

```sql
CREATE TABLE IF NOT EXISTS person_workspaces (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  reports_to_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_person_workspaces_pair
  ON person_workspaces(person_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_person_workspaces_workspace_id
  ON person_workspaces(workspace_id);
CREATE INDEX IF NOT EXISTS idx_person_workspaces_person_id
  ON person_workspaces(person_id);
```

Export inferred types `PersonWorkspace` and `NewPersonWorkspace` from `packages/database/src/index.ts`.

---

### Suggested `relationshipType` values per workspace kind

The column is **free text** — any value is valid. The suggestions below are chips shown in the add/edit modal to speed up entry. The user can always type something custom (e.g. `"חשב"`, `"מאמן כושר"`, `"שותף עסקי פרטי"`).

| kind | Suggested chips |
|---|---|
| `employer` (Dragontail) | `colleague` · `manager` · `direct_report` · `external` · `vendor` · `partner` |
| `own_company` — startup (DAZ) | `co_founder` · `employee` · `advisor` · `investor` · `vendor` · `partner` |
| `own_company` — consulting (Alpir Consulting) | `client` · `prospect` · `partner` · `lecture_organizer` · `vendor` · `service_provider` |
| `personal` | `family` · `friend` · `acquaintance` · `vendor` · `partner` · `service_provider` |

**Key design intent:** `personal` deliberately includes `vendor`, `partner`, and `service_provider` because:
- A private accountant, lawyer, or trainer is a vendor in the personal domain.
- A business collaborator known personally belongs in both `personal` (friend) and a professional workspace (partner) — two separate `person_workspaces` rows, each with its own `relationshipType`.

There is no constraint preventing the same value from appearing across different workspace kinds.

### Production rollout (EC2) — how the schema actually lands

Production is **SQLite on EC2** (`/data/ak_system.sqlite` on the `web-data` Docker volume), not Postgres. Verified against a schema-only replica of production on 2026-10-20:

1. `scripts/production-start.sh` runs `pnpm db:push` (drizzle-kit) on every container start. On production it **always fails and rolls back** — a pre-existing drizzle-kit bug where rebuilt tables emit each index twice (`index idx_memories_kind already exists`). The start script tolerates the error, so push is effectively a no-op there.
2. The schema is therefore applied by the **`getDb()` bootstrap** in `packages/database/src/index.ts` on first DB use: `WORKSPACES_COLUMNS` (adds `kind`, `description`), `WORKSPACES_KIND_SEED` (sets kind for the four default ids only where `kind IS NULL`), and `PERSON_WORKSPACES_TABLE`.
3. `PERSON_WORKSPACES_TABLE` is written in drizzle-kit's exact output form (table-level `FOREIGN KEY … ON UPDATE no action`). With inline `REFERENCES`, drizzle-kit would see a diff and rebuild the table on every push, which crashes local `pnpm test`/`pnpm e2e` (their pretest runs `db:push`).
4. Rollout is additive and needs no manual step: a new nullable column pair plus a new empty table. Existing rows are untouched. Production's two non-default workspaces (`DAZ - Engineering Tasks`, `Design Tasks`) keep `kind = NULL` until set in `/settings/workspaces`.
5. Postgres (`schema.pg.ts`) is kept in sync for type truth only; there is no live Postgres deployment to migrate.

---

## tRPC API

### `packages/api/src/routers/workspaces.ts` — extend `update`

Extend the existing `updateInput` Zod schema and `update` mutation handler:

```ts
// Add to updateInput:
kind: z.enum(['employer', 'own_company', 'personal', 'other']).optional(),
description: z.string().optional(),
```

The mutation already writes `updatedAt`; just add the two new fields to the `updates` object.

---

### `packages/api/src/routers/people.ts` — three new procedures

#### `people.linkToWorkspace`
- **Kind:** mutation, `protectedProcedure`
- **Input:**
  ```ts
  z.object({
    personId: z.string().min(1),
    workspaceId: z.string().min(1),
    relationshipType: z.string().min(1),
    reportsToPersonId: z.string().nullable().optional(),
    notes: z.string().optional(),
  })
  ```
- **Logic:** upsert into `person_workspaces` on `(personId, workspaceId)`.
- **Returns:** the upserted `PersonWorkspace` row.

#### `people.unlinkFromWorkspace`
- **Kind:** mutation, `protectedProcedure`
- **Input:** `z.object({ personId: z.string(), workspaceId: z.string() })`
- **Logic:** delete the matching row from `person_workspaces`.
- **Returns:** `{ ok: true }`

#### `people.listByWorkspace`
- **Kind:** query, `protectedProcedure`
- **Input:** `z.object({ workspaceId: z.string().min(1) })`
- **Logic:** join `person_workspaces` → `people` → optionally `people AS reportsTo` for the name. Filter `people.status = 'confirmed'`.
- **Returns:** `Array<{ person: People; relationshipType: string; reportsToPersonId: string | null; reportsToName: string | null; notes: string | null }>`

---

### `packages/api/src/routers/contacts.ts` — enrich Google sync

Extend the `syncFromGoogle` mutation to call `syncGoogleContacts` with enriched `personFields`:

```ts
personFields: 'names,emailAddresses,phoneNumbers,organizations,biographies'
```

Add a `dryRun` boolean input (default `false`). When `dryRun = true`, return the diff without writing. See Google Contacts sync enrichment in services section below.

---

### `packages/api/src/services/google-contacts-sync.ts` — enrichment

Change `personFields` string. For each contact, additive fill (only when the existing DB value is null/empty):

| Google field | Fills |
|---|---|
| `phoneNumbers[0].value` | `people.phone` |
| `organizations[0].name` | `people.company` |
| `organizations[0].title` | `people.jobTitle` |
| `biographies[0].value` | `people.notes` (Google's Notes field) |

Return a `diff` array: `{ action: 'new' | 'enrich' | 'skip'; personId?; name; fields: string[] }[]` — shown to the user before committing.

---

## UI Surface

### Breakpoints (Z Fold 7)

| State | Viewport | Layout target |
|---|---|---|
| Folded (cover screen) | ~390 px | Single-column; chips scroll horizontally; drawer is full-screen |
| Unfolded (inner screen) | ~768 px | Two-column where beneficial; filter bar fully visible; drawer is side panel |

Use Tailwind breakpoint `md:` (≥768 px) as the unfolded threshold throughout.

---

### `/settings` — `apps/web/src/app/settings/page.tsx`

In the existing workspaces section, add per-workspace:
- **Kind selector** — `<select>` with options: מעסיק · חברה/סטארטאפ · אישי · אחר. Saves via `workspaces.update`.
- **Description field** — single-line text input, saves on blur via `workspaces.update`.
- Responsive: on `< md` stack kind + description below the workspace name row; on `≥ md` show inline.

---

### `/people` — `apps/web/src/app/people/page.tsx`

**`PeopleFilterBar.tsx`** — add workspace filter chips above existing filters:
- One `<button>` chip per workspace (from `workspaces.list`), plus "הכל".
- Active chip highlights in the workspace's `color`.
- On `< md`: horizontal scroll (`overflow-x: auto; white-space: nowrap`), no wrapping.
- On `≥ md`: chips wrap naturally, full bar visible.
- Selecting a chip filters people via `people.listByWorkspace` (replaces the full `people.list` query).
- **"הכל" deduplicated:** when no workspace filter is active, `people.list` is used and each person appears once, even if they are linked to multiple workspaces. Workspace badges are shown per row.
- **Multi-workspace people appear in every matching filter:** Lior (both `Dragontail` and `חיים אישיים`) appears in both chips' filtered views — this is correct behaviour, not a bug.

**`PersonRow.tsx`** and **`PersonCard.tsx`** — add workspace badges column/slot:
- Show **all** workspace badge pills (workspace color, short name) + relationship type label. A person may have 2-3 badges if they span multiple domains.
- On `< md` (card grid): badges below the person name, wrapping up to 2 lines; overflow collapsed to `+N`.
- On `≥ md` (table row): new "עולמות" column, showing all badges inline; if more than 3, truncate with `+N` overflow pill.

---

### `PersonDetailDrawer.tsx` — `apps/web/src/components/people/PersonDetailDrawer.tsx`

Add a new **"שיוכים"** (Affiliations) section, placed after the basic info block and before the signals/traits section:

**Structure:**
```
שיוכים לעולמות
  [+ שייך לעולם]
  ┌─────────────────────────────────────────┐
  │ • Dragontail · מעסיק                   │
  │   קשר: עמית  מדווח ל: מיכל לוי [ערוך] │
  │ • DAZ · סטארטאפ                         │
  │   קשר: co_founder                [ערוך] │
  └─────────────────────────────────────────┘
```

**Add/Edit modal** (inside the drawer, not a separate route):
- Dropdown: workspace (from `workspaces.list`).
- Suggested chips for `relationshipType` based on selected workspace's `kind`; free-text fallback.
- Autocomplete for `reportsToPersonId`: search confirmed people within the selected workspace.
- Notes text area (optional).
- Saves via `people.linkToWorkspace`.

**Responsive:**
- On `< md`: affiliation rows stacked full-width; modal is a bottom sheet.
- On `≥ md`: affiliation rows in a compact table; modal is an inline form within the drawer.

---

### Settings → Google Contacts sync

In `apps/web/src/app/settings/page.tsx`, the existing Google Contacts sync button:
1. First call: `contacts.syncFromGoogle({ dryRun: true })` → show diff table.
2. User confirms → second call: `contacts.syncFromGoogle({ dryRun: false })`.

Diff table columns: פעולה · שם · שדות שיתמלאו.

Responsive: full-width table on both breakpoints; action column uses icon + label on `≥ md`, icon only on `< md`.

---

## Harness Update

**`packages/api/src/services/harness-context.ts`** — `scopes.has('people')` block:

1. After fetching `people` rows, batch-fetch matching `person_workspaces` joined with `workspaces` and the `reportsTo` person name.
2. Aggregate per `personId`: `workspaces: Array<{ name, kind, relationshipType, reportsToName? }>`.
3. Update `summary` to include one domain-context line, e.g.:
   - Single workspace: `"Dragontail · מעסיק · עמית"`
   - Multiple: `"Dragontail · מעסיק · עמית | DAZ · סטארטאפ · co_founder"`
   - No workspace: `role + company` (current behaviour, unchanged)
4. Update `attrs` to include the full `workspaces` array (JSON-serialised).

No new edge kind is required for MVP — the person node's enriched attrs are sufficient for the reasoner.

---

## Out of Scope

- Visual org-chart diagram (tree/graph view) — text list in PersonDetailDrawer is sufficient for now.
- Mobile app (`apps/mobile`) changes — web-only.
- Syncing data back to Google Contacts — read-only sync only.
- Auto-inferring workspace assignment from Google Contact groups — no groups/labels in use.
- Bulk workspace assignment UI (assign 20 people to DAZ at once) — single-person edit only.
- Multi-user / team workspace sharing.
- The `WORKS_IN` Harness edge kind — deferred to a future graph-traversal feature.
- Cron-scheduled Google Contacts sync — remains on-demand from settings.

---

## Open Questions

- **reportsTo scope:** `reportsToPersonId` in `person_workspaces` is workspace-scoped (correct for someone who is a direct report at Dragontail but a peer at DAZ). If querying gets painful, promote to `people.managerId` in a follow-up.
- **Google Contacts notes field:** ✅ Confirmed — the standard "Notes" field in Google Contacts maps to `biographies[0].value` in the People API. Dev should use that field.
- **Workspace filter + full-text search:** should workspace filter compose with the existing text search (`PeopleFilterBar` already has a search input), or replace it? Proposed: AND logic — filter by workspace AND text simultaneously.

---

## Design Decision Log

| Decision | Rationale |
|---|---|
| Many-to-many `person_workspaces` | A person frequently appears in multiple life domains simultaneously (e.g., Lior = Dragontail external + personal friend). One-to-one would be wrong. |
| `reportsToPersonId` workspace-scoped | The same person can be your peer in DAZ but your direct report in Dragontail. Global `managerId` would lose this nuance. |
| `relationshipType` free text with suggestions | Enforced enum would break edge cases (e.g. private vendor, personal partner). Suggestions per `kind` guide the user without constraining them. The same value (`vendor`, `partner`) appears across multiple kinds by design. |
| Google sync additive only | Never overwrite data the user intentionally entered in the system. Google is enrichment, not master. |
| Workspace assignment manual (not from Google groups) | No contact groups/labels maintained in Google Contacts; auto-mapping is not possible. |
| Profile fill lives on `/people` next to "טלפונים מגוגל" | Same preview → review → apply pattern as the phone fill (`contacts.previewGoogleProfiles` / `applyGoogleProfiles`); `syncGoogle` is unchanged. |
| Affiliation badges under the name, not a new table column | Keeps the table narrow enough for the unfolded Fold (768px). Below 768px the page defaults to cards and the drawer goes full-width. |
| Affiliation editor inline in the drawer (not a bottom sheet) | The drawer is already full-screen on a folded phone; an inline form avoids a modal-on-modal. |
| Added `people.affiliations` and `listPaginated.workspaceId` | Drawer needs one person's affiliations; the list filter needs server-side filtering so pagination totals stay correct. |
