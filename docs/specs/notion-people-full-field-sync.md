# Notion People Full-Field Sync (phone, role, company, LinkedIn)

**Stack:** `next-trpc-monorepo`
**Slug:** `notion-people-full-field-sync`
**Status:** Draft — awaiting approval
**Created:** 2026-09-30
**Depends on:** `notion-tasks-people-sync` (existing People pass), `notion-people-source-manager` (the add-source flow this extends)

---

## Goal

The People pass in `syncNotionTasks` (`packages/api/src/services/notion-tasks-sync.ts`) only ever reads a Notion page's **title** (name) and an `email`-type property. Every other field on the local `people` row — `phone`, `companyId`, `role`, `linkedin`, `tags`, `jobTitle`, `notes`, `expertIn` — is left null on creation and untouched forever after, even when the source Notion page has that data filled in. This spec extends the People pass to also pull `phone`, `role`, `company` (resolved to `companyId`), and `linkedin`, and — per the owner's follow-up — makes the **add-source flow** (Settings ← מקורות ← הוסף בסיס נתונים) ask, at the moment a database is connected, which property maps to which field whenever automatic detection can't confidently tell.

## Real property inspection (grounds this spec in actual data, not assumptions)

Queried both currently-configured Notion people databases live (`GET /v1/databases/{id}`) before writing this spec:

**"Personal / DT - People directory"**: `Type` (select), `Files & media` (files), `Personal email` (email), `Todos` (relation), **`Phone number` (phone_number)**, `Office location` (select), `Button` (button), `Birthday` (date), `Tenure` (formula), `Reports to` (relation), `Team` (multi_select), `Languages` (multi_select), `End date` (date), `Start day` (date), **`Role` (rich_text)**, `Company email` (email), `Name` (title). No company relation, no url/linkedin property. Two `email`-type properties (pre-existing ambiguity, see below).

**"DAZ / DAZ People"**: **`Phone` (phone_number)**, `📅 Meetings & Interactions` (relation), `Email` (email), **`Linkedin` (url)**, **`Company` (relation)**, `Contact Personas` (multi_select), `Name` (title). No role/rich_text property. Two `relation`-type properties.

Takeaways: `phone` (phone_number) and `role` (rich_text) each have exactly one candidate in the database where they exist — safe to auto-detect. `company` and `linkedin` sit among *multiple* properties of the same type (DT has two relations; DAZ has two relations too), so name alone decides which one is right — and a differently-worded property name would defeat a fixed regex. That's exactly the case the interactive picker below exists for. `tags`/`jobTitle`/`notes`/`expertIn` have no obvious candidate in either real database and stay out of scope (see below).

## Two different mechanisms for two different kinds of source

- **Env-configured databases** (`NOTION_ACCOUNTS`) have no interactive moment — they're wired by editing an env var and restarting. These keep working on **heuristics only**: type match where unambiguous (phone, role), type + name-pattern match where not (company, linkedin). Same as originally scoped.
- **Self-service sources** (`people_notion_sources`, added via Settings ← מקורות) *do* have an interactive moment — the add-source modal already fetches the database's full property list to resolve/preview it (`resolveNotionDatabaseLink` → `fetchDatabaseInfo`). This spec uses that same moment to **pin an explicit property-name mapping per field**, decided once at add-time (confidently auto-picked, or chosen by the owner when ambiguous), and stored on the source row. Sync then reads that pinned name directly for that source — no re-guessing, no drift if a later renamed/added property would otherwise confuse a live heuristic.

## User Stories

- As the owner, I want a Notion contact's phone number, role, company, and LinkedIn to show up in the app automatically when I sync, so I don't have to re-type what's already in Notion.
- As the owner, when I connect a new people database whose fields aren't obviously "the phone one" or "the company one" (e.g. two relation properties, and I need to say which is right), I want to be asked once at connect-time, so I don't have to guess whether it worked or dig into logs afterward.
- As the owner, I want sync to never overwrite something I already filled in locally, so my own edits are never silently clobbered by a stale or differently-formatted Notion value.
- As the owner, I want the sync result banner to reflect these fill-ins as real updates, so "0 imported" doesn't hide the fact that new data actually landed on existing contacts.

## Acceptance Criteria

### Field extraction — env-configured databases (heuristic only, unchanged mechanism)

- Given a Notion people page has exactly one `phone_number`-type property, when it's synced, then its value is written to `people.phone`.
- Given a Notion people page has exactly one `rich_text`-type property (other than the title), when it's synced, then its value is written to `people.role`; if there are two or more, the first found is used (same class of limitation `getEmail` already has today — not fixed here).
- Given a Notion people page has one or more `relation`-type properties, when it's synced, then the one whose name matches `/company|companies|חברה|לקוח/i` (if any) has its related page looked up against `companies.notionPageId`; a match writes `people.companyId`.
- Given a Notion people page has one or more `url`-type properties, when it's synced, then the one whose name matches `/linkedin/i` (if any) is written to `people.linkedin`.
- Given none of the above match on a page, when it's synced, then the corresponding local field is simply left as-is — no error, no placeholder.

### Add-source flow — interactive field mapping for self-service sources

- Given the owner clicks "בדוק" in the add-source modal with a valid, accessible link, when the database resolves, then the response also reports, for each of `phone` / `role` / `company` / `linkedin`: the list of that database's properties of the compatible type (`phone_number` / `rich_text` / `relation` / `url` respectively, excluding the title property for `role`), and — when exactly one exists, or exactly one matches that field's name pattern among several — which one was auto-picked.
- Given a field was auto-picked, when the modal renders, then it's shown as already resolved (e.g. "טלפון: Phone number ✓") without blocking "הוסף", with an option to change it if the owner disagrees.
- Given a field has two or more candidates and none (or more than one) matches the name pattern, when the modal renders, then a picker for that field is shown listing all same-type candidates plus "ללא" (don't sync this field for this source) — the owner must resolve it (pick one or explicitly skip) before "הוסף" is enabled.
- Given a field has **zero** candidate properties on that database, when the modal renders, then nothing is shown for that field at all — there's nothing to ask.
- Given the owner confirms and clicks "הוסף", when the source is created, then whatever was auto-picked or chosen (including an explicit "ללא"/null) is stored on the new `people_notion_sources` row, one property name per field.
- Given a self-service source has a pinned property name for a field, when sync runs, then that exact property name is read directly from the page (whatever its current type happens to report) — if that named property no longer exists on a later fetch (renamed/deleted in Notion), the field is simply skipped for that page, not treated as an error.

### Update policy — fill blanks only, never overwrite

- Given a **new** person created by this sync, when the insert happens, then all four fields above are set directly from whatever Notion has (nothing to preserve yet).
- Given an **already-existing** matched person (by `notionPageId` → email → name, same precedence as today), when any of `phone` / `role` / `companyId` / `linkedin` is currently **null** locally and Notion has a value for it, then that field is filled in.
- Given an already-existing matched person where a field is **already non-null locally** (typed manually or filled by an earlier sync), when sync runs again, then that field is **never overwritten**, even if Notion's value differs — applies uniformly regardless of the person's `source`.
- Given any of these fields actually get filled in on an existing person (not just `notionPageId`), when the sync result is computed, then `peopleUpdated` counts it — broadens today's condition (which only counts a newly-set `notionPageId`) so the People-page sync banner (`docs/specs/people-sync-visibility.md`) reflects real field fill-ins.

## Data Model

`people.phone` / `role` / `companyId` / `linkedin` already exist — no change there.

`people_notion_sources` gains four nullable columns (both `schema.ts` and `schema.pg.ts`, plus the SQLite bootstrap ALTERs in `packages/database/src/index.ts`):

```ts
phonePropertyName: text('phone_property_name'),
rolePropertyName: text('role_property_name'),
companyPropertyName: text('company_property_name'),
linkedinPropertyName: text('linkedin_property_name'),
```

Null means "nothing was picked / nothing to pick" (that field is skipped for this source) — not "fall back to the heuristic": pinning is all-or-nothing per source, so behavior for a self-service source is fully explicit and reproducible from what's stored.

## tRPC API Shape

`packages/api/src/routers/people.ts`:

- `resolveNotionDatabaseLink` — response gains a `fieldMappings` object:
  ```ts
  {
    notionDatabaseId, name, alreadyAdded,
    fieldMappings: {
      phone:    { candidates: string[]; auto: string | null },
      role:     { candidates: string[]; auto: string | null },
      company:  { candidates: string[]; auto: string | null },
      linkedin: { candidates: string[]; auto: string | null },
    },
  }
  ```
  `candidates` lists property names of the compatible type on that database (empty array when the type doesn't appear at all — the UI shows nothing for that field). `auto` is the confidently-detected name (single candidate, or single name-pattern match among several) or `null` when the owner needs to choose.
- `addNotionSource` — input gains four optional fields: `phonePropertyName?`, `rolePropertyName?`, `companyPropertyName?`, `linkedinPropertyName?` (each `string | null`), persisted onto the new row as-is.

## Implementation Notes (packages/api/src/services/notion-tasks-sync.ts)

Generic-by-type readers (used both for env heuristics and for reading a self-service source's pinned name):

```ts
function readPhoneNumber(v: NotionProp): string | null { ... }   // v.phone_number
function readRichText(v: NotionProp): string | null { ... }      // reuses richTextValue
function readRelationId(v: NotionProp): string | null { ... }    // v.relation?.[0]?.id
function readUrl(v: NotionProp): string | null { ... }           // v.url
```

Heuristic path (env sources — `NotionDb` entries with no pinned names): scan properties by type as in the earlier draft, with a name-pattern tiebreak added for `role` too (`/role|position|job|תפקיד/i`) when there are 2+ `rich_text` candidates, mirroring `company`/`linkedin`.

Pinned path (self-service sources — `NotionDb` extended with optional `phonePropertyName` / `rolePropertyName` / `companyPropertyName` / `linkedinPropertyName`, populated by `resolvePeopleDatabases` from the `people_notion_sources` row): look up `page.properties[pinnedName]` directly and read it with the matching generic reader; a missing property is a silent skip for that page.

Before the People pass loop, preload `companies.notionPageId → companies.id` (same shape as the Tasks pass's `projectByNotionId`). Inside the loop, both the insert branch and the "fill blanks on existing" branch build a values/set object that only includes a field when (insert: always) / (existing: currently null locally) and the extracted value is non-null. `peopleUpdated` increments whenever that object is non-empty, in addition to the existing `notionPageId`-newly-set case.

## UI Surface

`apps/web/src/components/Modals/AddPeopleSourceModal.tsx` — after "בדוק" resolves successfully, render a compact per-field summary between the resolved-name confirmation and the action buttons:
- Auto-detected field: one line, non-interactive, e.g. `טלפון: Phone number ✓` (with a small "שנה" link revealing a `<select>` if the owner wants to override).
- Ambiguous/undetected field with candidates: a required `<select>` (`בחר שדה עבור <תווית>`), options = candidates + `ללא`, defaulting to `ללא` (not blocking "הוסף" — skipping is a valid choice, just not silent-guessing).
- Field with zero candidates: nothing rendered.
"הוסף" sends whatever ended up selected (auto value, overridden value, or null) as the four optional `addNotionSource` inputs.

## Out of Scope

- `tags`, `jobTitle`, `notes`, `expertIn` — no property in either currently-configured database maps cleanly to these without a product decision on intended meaning. Follow-up spec once there's a clear per-field mapping decision.
- Fixing the pre-existing `getEmail` ambiguity on DT's two email properties ("Personal email" vs "Company email") — unrelated, pre-existing.
- Any change to `people.company` (legacy free-text, distinct from `companyId` per the schema's own comment) — only the `companyId` FK gets populated.
- Auto-creating `companies` rows from an unresolved company relation — stays `notionGraph.sync`'s job.
- Reformatting/normalizing phone numbers on ingest — stored as Notion provides them.
- Extending the same interactive picker to env-configured (`NOTION_ACCOUNTS`) databases — those have no UI moment to ask through; they stay heuristic-only. A parallel idea (letting `NOTION_ACCOUNTS`'s JSON schema itself carry per-database field-name hints) is a plausible future extension, not built here.
- Re-resolving a self-service source's pinned mapping after it's added (e.g. if the Notion property gets renamed later) — the owner would need to remove and re-add the source; no "edit mapping" UI in this pass (mirrors `notion-people-source-manager`'s existing "remove + re-add covers renaming" stance).

## Open Questions

- Should the modal let the owner override an auto-picked field even when confident (via "שנה"), or only fall back to a picker on genuine ambiguity? Proposed: allow override always (cheap to add, avoids a wrong-but-confident guess being unfixable without remove+re-add).
- If either Notion people database later gains more properties of a type that's currently unambiguous (env sources only), heuristic "first match wins" could silently pick the wrong one — same class of limitation `getTitle`/`getEmail` already have. Not fixing proactively for env sources; self-service sources don't have this problem once pinned.
