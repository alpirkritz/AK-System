# Intelligence Harness

## Goal

Cross-domain intelligence layer. Today every cron assembles its own snapshot of one
domain and throws it away. The harness keeps a persistent world model over *all*
domains (people, meetings, commitments, WhatsApp, finance, voice, email) and derives
insights that no single domain can produce on its own.

Example of an insight that is impossible today:

> הפגישה עם דן מחר — שתיקה של 3 שבועות בוואטסאפ, התחייבות פתוחה שלך אליו.

## Non-goals / Out of scope

- Replacing `person-context.ts`, `warmth.ts` or `commitments.ts`. The harness reads them.
- Moving the authoritative store into grag. See "Storage decision" below.
- Changing how existing crons deliver their own notifications.

## Storage decision — app DB, not grag

The plan named grag as the world model. `grag` is a CLI at `~/.local/bin/grag` on the
Mac; production runs in Docker on EC2 where it is not installed, so a grag-backed world
model would be dev-only.

The world model therefore lives in the app database (Postgres in prod, SQLite locally)
as three tables. grag stays available as an **optional mirror**: when `GRAG_DB_PATH` is
set and the binary resolves, the indexer also writes memories through the CLI. Failure
to mirror never fails a run.

## Data model

Both `schema.pg.ts` and `schema.ts` get the same three tables, plus the SQLite
bootstrap block in `packages/database/src/index.ts`.

### `harness_nodes`

| column | type | notes |
|---|---|---|
| `id` | text PK | `person:<id>`, `meeting:<id>`, … — deterministic, so re-index upserts |
| `kind` | text | `person` \| `meeting` \| `commitment` \| `financial_event` \| `whatsapp_signal` \| `voice_recording` |
| `entity_id` | text | the source row id |
| `label` | text | display name |
| `summary` | text | one short line, used in LLM prompts |
| `attrs` | text | JSON bag |
| `occurred_at` | text | ISO; null for timeless nodes. Drives temporal queries |
| `created_at` / `updated_at` | text | |

Indexes on `kind`, `occurred_at`, `entity_id`.

### `harness_edges`

| column | type | notes |
|---|---|---|
| `id` | text PK | `<kind>:<from>:<to>` — deterministic |
| `from_id` / `to_id` | text | node ids |
| `kind` | text | `ATTENDED` \| `HAS_COMMITMENT` \| `MENTIONED_IN` \| `TRIGGERED_SPEND` \| `RELATED_TO` |
| `weight` | real | default 1 |
| `occurred_at` | text | |
| `attrs` | text | JSON |
| `created_at` | text | |

Indexes on `from_id`, `to_id`, `kind`.

### `harness_insights`

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `kind` | text | detector id, e.g. `silent_before_meeting` |
| `title` / `body` | text | Hebrew |
| `severity` | text | `info` \| `attention` \| `urgent` |
| `score` | real | ranking, 0–1 |
| `person_id` | text | nullable FK → `people` |
| `sources` | text | JSON array of `{ nodeId, kind, label }` — source attribution for the UI |
| `status` | text | `open` \| `dismissed` \| `acted` |
| `dedupe_key` | text | unique; a detector re-firing updates instead of duplicating |
| `generated_at` / `expires_at` | text | expired insights drop out of `insights()` |
| `created_at` / `updated_at` | text | |

## Services

### `packages/api/src/services/harness-context.ts` — Context Indexer

`indexHarnessWorld(db, { scopes, windowDays })` reads the source tables and upserts
nodes and edges. Scopes: `people`, `meetings`, `commitments`, `whatsapp`, `finance`,
`voice`. Default window 30 days so a run stays bounded.

Edges written:

- person → meeting `ATTENDED` (from `meeting_people`)
- person → commitment `HAS_COMMITMENT` (from `commitments.person_id`)
- person → whatsapp_signal `MENTIONED_IN`
- meeting → financial_event `TRIGGERED_SPEND` (transaction within 2 days of a meeting)
- person → voice_recording `RELATED_TO`

### `packages/api/src/services/harness-grag.ts` — optional mirror

`mirrorToGrag(lines)` spawns `grag --db $GRAG_DB_PATH remember`. No-op when unset.

### `packages/api/src/services/harness-reasoner.ts` — Cross-Domain Reasoner

Deterministic detectors first — each returns candidates with source attribution:

| detector | correlation |
|---|---|
| `silent_before_meeting` | upcoming meeting + attendee silent ≥14d + open commitment |
| `cooling_with_open_loop` | `warmth.trend === 'cooling'` + open commitment |
| `stale_commitment` | commitment `proposed`/`accepted` open ≥21d |
| `spend_spike_vs_meetings` | month spend ≥40% above trailing average + meeting count |
| `unanswered_thread` | email thread with no reply + upcoming meeting with that person |

Candidates then go to Gemini (via `gemini-gateway`, priority `batch`) for Hebrew phrasing
and ranking. **No API key or any Gemini failure falls back to deterministic Hebrew
templates** — the harness must never go dark because the LLM is down.

## tRPC API — `packages/api/src/routers/harness.ts`

| procedure | type | returns |
|---|---|---|
| `harness.worldState` | query | counts per node kind, last index time, top open insights — the Hugo context payload |
| `harness.insights` | query | ranked open insights, `{ limit, severity? }` |
| `harness.personSignals` | query | unified signals for one person (nodes + edges + insights) |
| `harness.syncToGraph` | mutation | manual re-index |
| `harness.dismissInsight` | mutation | sets status `dismissed` |

Registered in `appRouter` as `harness`.

## Cron — `apps/web/src/app/api/cron/harness-insights/route.ts`

Every 6 hours (`deploy/crontab.example`). Indexes, reasons, persists insights, and pushes
an `urgent` digest through the existing notification path. Honours `CRON_SECRET` like
every other cron route.

## UI surface

`apps/web/src/components/HarnessWidget.tsx`, mounted on the dashboard under the
conflicts widget. Ranked insight list, severity colour on the right edge (RTL), source
attribution chips ("מה גרם לתובנה"), dismiss button. Uses `.card` / `.btn` design-system
classes, Hebrew copy, dark theme. Renders nothing when there are no open insights.

## Morning briefing

`formatMorningBriefingContext` gains an optional `harnessInsights` argument; the cron
fetches `harness.insights({ limit: 3, severity: 'attention' })` inside a `try`/`catch`
so a harness failure degrades to today's brief rather than a 500 — same pattern finance
already uses there.

## Acceptance criteria

- [ ] Re-running the indexer twice produces no duplicate nodes, edges or insights
- [ ] Reasoner returns Hebrew insights with `GEMINI_API_KEY` unset
- [ ] Every insight carries at least one source attribution entry
- [ ] Dismissed insights do not reappear on the next run
- [ ] Morning briefing still sends when the harness throws
- [ ] Widget hidden when no open insights
