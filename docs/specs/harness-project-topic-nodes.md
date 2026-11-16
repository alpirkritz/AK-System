# Harness — projects and topics as first-class nodes

> **Slug:** `harness-project-topic-nodes`
> **Status:** Draft
> **Last Updated:** 2026-11-16
> **Builds on:** `intelligence-harness.md`, `hugo-entity-memory.md`, `meeting-prep-topic-isolation.md`

## Goal

Give the harness world model `project` and `topic` nodes, keep project standing briefs fresh without a manual click, and give Hugo one call that returns the full picture of a project or a topic across meetings, tasks, chat and memory.

### Why

- `HARNESS_SCOPES` covers people, meetings, commitments, whatsapp, slack, finance, voice and email. There is no project node and no topic node. A meeting carries `projectId` only as an attribute (`harness-context.ts:329`), so the graph cannot answer "what is happening in Algo 4".
- `projects.standingBrief` is written only when the user clicks write in `InsightStrands` (`projects.writeStanding`). `readProjectStanding` already knows when the brief is stale, but nothing acts on that.
- Hugo's `get_projects` returns a list with open-task counts. There is no per-project depth tool.
- Topics ("DD release", "Algo 4") exist only as `topicTokens()` inside meeting prep, and as the free-text `meeting_analyses.topic`. Work that spans projects (or has none) has no handle.

## User stories

- As Alpir, I want to ask "מה המצב עם Algo 4" and have Hugo answer from the brief, open tasks, recent meetings, people, open insights and saved memories in one pass.
- As Alpir, I want to ask "מה קורה עם DD" about a topic that has no project and get the meetings, tasks and chat mentions that carry that topic.
- As Alpir, I want project briefs to refresh by themselves after a new meeting analysis lands, so the brief I read is not weeks old.
- As Alpir, I want harness insights about a project ("פרויקט נהיה שקט") to point at the project node, so I can open it.

## Acceptance criteria

### Indexing

- [ ] `HarnessScope` gains `projects` and `topics`, and both are added to `HARNESS_SCOPES`.
- [ ] **Project nodes.** Each project becomes a node `project:<id>` with kind `project`.
  - `label` is the project name.
  - `summary` is the first 180 chars of `standingBrief`, or the name when there is no brief.
  - `attrs` holds `{ workspaceId, openTasks, lastMeetingAt, warmth }`.
  - `occurred_at` is the last meeting date.
- [ ] **Project edges:**
  - `BELONGS_TO`: meeting → project, from `meetings.projectId`.
  - `MEMBER_OF`: person → project, from `project_people`.
- [ ] **Topic nodes.** A topic node `topic:<token>` is created for each token returned by `topicTokens()` that appears in at least **2** distinct sources within the index window. Sources are:
  - meeting titles,
  - `meeting_analyses.topic`,
  - open task titles,
  - WhatsApp group names,
  - tokens already used as `memory_links` topics.
- [ ] **Topic edges.** `ABOUT` edges run from meeting, task and `whatsapp_signal` nodes to the topic. Edge weight is the number of hits in that source.
- [ ] Tokens that are a project's name tokens do not become topic nodes. The project node already covers them.
- [ ] Indexing stays idempotent, because node and edge ids are deterministic. Re-running does not duplicate anything.

### Standing refresh

- [ ] The `harness-insights` cron refreshes up to **3** stale project briefs per run, using `standingIsStale` and `writeProjectStanding`.
- [ ] The most recently active projects are refreshed first.
- [ ] A Gemini failure on one project does not stop the run or the others.
- [ ] The manual "write" button keeps working unchanged.

### Detectors

- [ ] `detectProjectGoneQuiet` cites the `project:<id>` node in `sources`, so the insight can link to the project.

### Tools

- [ ] **New Hugo tool `get_project_context({ project })`.** It takes a name and resolves it like `resolveNamedEntities`. It returns:
  - `{ name, brief, briefStale, warmth }`,
  - the 10 open tasks with the soonest due date,
  - the last 5 meetings with each one's analysis summary line,
  - the people on the project,
  - open harness insights whose `sources` contain the project node,
  - every memory linked to the project, with no cap.
- [ ] **New Hugo tool `get_topic_context({ topic })`.** It returns:
  - meetings in the last 60 days whose title or analysis topic carries the token,
  - open tasks with the token,
  - WhatsApp groups with the token,
  - memories linked to the topic.
- [ ] Both tools are gated to the same agent set as `get_harness_insights`.
- [ ] Both tools return `notFound: true` when the name does not resolve, and never return raw transcript text.
- [ ] The Hugo Chief of Staff block gets one line: on a named project or topic, call the matching context tool in the depth pass.

## Data model

- **No new tables.** `harness_nodes` and `harness_edges` already take free-text `kind` values.
- **New node kinds:** `project`, `topic`.
- **New edge kinds:** `BELONGS_TO`, `MEMBER_OF`, `ABOUT`.
- `intelligence-harness.md` is updated so its kind lists include these values.

## tRPC API

Router `packages/api/src/routers/harness.ts` (existing):

| procedure | kind | input | returns |
|---|---|---|---|
| `projectContext` | query | `{ projectId: string }` | the `get_project_context` shape |
| `topicContext` | query | `{ topic: string }` | the `get_topic_context` shape |
| `syncToGraph` | mutation | `scopes` now accepts `projects` and `topics` | unchanged |

The service logic lives in `packages/api/src/services/harness-context.ts`, as new indexer sections plus `projectContext()` and `topicContext()`.

## UI surface

- `HarnessWidget` (`apps/web/src/components/HarnessWidget.tsx`): an insight whose sources include a project node links to `/projects/<id>`.
- No new pages.

## Tests

- **Vitest — indexer:**
  - project nodes and both project edge kinds;
  - the 2-source threshold for topics;
  - a project-name token does not become a topic;
  - idempotent re-index.
- **Vitest — `projectContext` and `topicContext`:** the result shape, and `notFound`.
- **Vitest — standing refresh:** at most 3 projects per run, and one failure does not stop the others.
- **Vitest — tool gating and dispatch** in `conversation-engine`.

## Out of scope

- Commitments → project edges. `commitments` has no `projectId`. This can be revisited if one is added.
- A topics page in the UI.
- Embedding-based topic clustering. Topics stay token-based.

## Open questions

- Is a 2-source threshold right for topic nodes? The default here is 2. Raising it makes fewer, sharper topics.
