# Tier 1 QA Daily WhatsApp Agent

> **Slug:** `tier1-qa-whatsapp-agent`
> **Status:** Implemented — see `reports/tier1-qa-whatsapp-agent.md` (APPROVED WITH NITS)
> **Last Updated:** 2026-09-30

## Goal

A new daily agent that scans the Notion "Tests for Tier 1" database (including linked engineering-task records, page content, and comments), computes QA status stats, diffs against yesterday's snapshot, and produces a short, accurate Hebrew WhatsApp status update for דור and אור. Ships first in **draft/review mode** (visible in-app only); WhatsApp delivery is switched on after a few clean runs.

Primary Notion source (from the user's request):
- Database: `https://app.notion.com/p/3de1f239094380788644d837cabcf10f`
- Data source: `collection://3de1f239-0943-804a-b84f-000b5ead53ec` (tests)
- Linked engineering-task collection: `collection://c7b1f239-0943-82d2-bd87-87926ab0a490`
- Timezone: `Asia/Jerusalem`

The classification rules, gap-detection rules, ownership-routing rules, and the "don't send partial data" safety rule are as specified verbatim by the user (see Appendix A) and are binding acceptance criteria, not paraphrased suggestions. **The message template is the exception:** Appendix A §10's verbose per-item template (with links) was implemented literally at first, but the spec's own "Target output style" example further down was always the actual binding tone/format bar and was missed during implementation — corrected 2026-09-30 to the compact dashboard format (see the message-template acceptance criterion below and `A_Agents/10_tier1_qa_reporter.md`, which is the source of truth for exact wording).

## Why this needs a spec (not a one-line change)

This touches `packages/database` (new snapshot table), `packages/api` (new Notion service + tRPC surface), `apps/web` (cron wiring, notification-preference gating), and `apps/whatsapp-bridge` (a deliberate security guard has to be loosened). Per `.cursor/rules/dev-pipeline.mdc` this requires spec → (no UI needed) → dev → tests → QA → review before any code lands.

## Key architectural finding from research (read this first)

The WhatsApp bridge (`apps/whatsapp-bridge`) currently **hard-blocks every outbound send except to your own self-chat** (`isSelfChatJid` guard in `whatsapp-client.ts` + a second check in `server.ts`'s `/send` route). This is an intentional security control, not an oversight. The user confirmed (see clarification below) the update should go to an **existing WhatsApp group** that דור and אור are already both in — so this spec requires a small, explicitly-scoped loosening of that guard (Section 5), not a wide-open "send to anyone" change.

## Clarifications already resolved with the user

1. **Delivery mechanism:** send into an existing WhatsApp group (not self-chat, not a new Business API/Twilio integration). Group: **"טכני"**, JID `120363411443506535@g.us` (provided by Alpir from memory — to be cross-checked against `/settings/whatsapp`'s discovered-groups list, which shows name+JID together, before it's hardcoded into `WHATSAPP_ALLOWED_GROUP_JIDS`; see Section 9 #1).
2. **Schedule:** default `07:00 Asia/Jerusalem`, but must remain user-editable to a later hour via the existing `/agents/manage` schedule UI (no new UI needed — `agent_schedules.scheduleTimes` already supports this).
3. **Rollout:** ship in draft/review mode first (message generated and visible in-app/push only); flip a config switch to enable real WhatsApp delivery after a few clean runs (per the user's own instructions in the source prompt).

## User Stories

- As Alpir, I want a daily Hebrew WhatsApp message summarizing Tier 1 QA status so דור and אור don't have to open Notion to know what's blocking them.
- As Alpir, I want the agent to refuse to send a partial/incomplete update rather than silently under-reporting.
- As Alpir, I want to review the generated message myself for a few days before it auto-sends to the group.
- As דור, I want to see, every day, which bugs are mine, which have no assignee/due date, and which need re-testing because they shipped (Released) but the test isn't closed.
- As אור, I want to see exactly which addresses/tests are waiting on my professional review, with a link to the Notion page or run result.

## Acceptance Criteria

- [ ] Loads **all** rows from the tests data source (`collection://3de1f239-0943-804a-b84f-000b5ead53ec`), ignoring any Notion View filter, with pagination (no row-count cap).
- [ ] For each test row, captures: Street, גוש, חלקה, סטטוס בדיקה, לינק לתוצאות הריצה, Engineering tasks (relation), Tested by, Done, ID, and the test page URL.
- [ ] For each test page, fetches full block content, all comments (open and resolved, if the Notion API exposes both), and each comment's author + timestamp.
- [ ] For every linked Engineering task (including Archived/Deleted, flagged as such), fetches: Task ID, Task name, Status, Priority, Assignee, QA, Reporter, Type, Due, "Tests for Tier 1" (back-relation), task URL, task content, and task comments.
- [ ] Recomputes on every run (no caching of counts): total tests; counts per סטטוס בדיקה; count Done; count with Tested by; count with a run-result link; total linked bugs; counts by active/released/cancelled/archived/deleted; active-bug breakdown by Status × Priority; open bugs with no Assignee; open bugs with no Due date.
- [ ] Applies the exact classification rules from Appendix A §6 (Released ≠ open but needs regression if test not Done; Cancelled/Archived ≠ open; Deleted task ≠ active bug but flag if still linked; anything else = open; never infer test-complete from bug-released; never treat a stale comment as still valid if task status changed after it — flag "needs verification" instead; never invent owner/due/date/decision).
- [ ] Detects every gap category listed in Appendix A §7 (waiting-for-fix test with no active bug; Released bug with test still pending; test linked only to a Cancelled/Archived/Deleted bug; test waiting on אור review after its bug already Released; open bug missing Assignee or Due; unanswered open question in comments; a comment where דור says he's waiting on אור; cancelled test still linked to an active task; missing גוש/חלקה or run-result link where relevant).
- [ ] Routes every action item to exactly one owner bucket — לאור / לדור / לאלפיר/QA — per Appendix A §8, and writes "נדרש לקבוע בעלים" when no rule clearly applies. Never assigns an owner without a clear basis.
- [ ] **Ready for QA routing (added 2026-10-05, per Alpir):** an open bug whose Status is `Ready for QA` produces a `ready_for_qa` gap owned by the specific people in that ticket's **QA** field; if QA is empty, by the ticket's **Reporter**; if both are empty, "נדרש לקבוע בעלים". Owner bucket for this case is `לבעלים מהטיקט`, with the resolved names carried in `people[]` (and `peopleSource: 'qa' | 'reporter'`) on both the gap and the owner action. Deterministic, code-side (`detectGaps` / `routeOwner`) — the LLM only renders the names, as `@<name>` in "הצעדים להיום".
- [ ] The grounding payload exposes each bug's `qa` and `reporter` names, so wording-only rules about those fields can be added in the agent card without code changes.
- [ ] **A Ready for QA bug is never routed to דור (added 2026-10-05, per Alpir):** once an open bug's Status is Ready for QA, a missing Assignee or Due date no longer produces `open_bug_missing_assignee`/`open_bug_missing_due` (which route to `לדור`) — dev's part of the work is done, so ownership is only ever `לבעלים מהטיקט` (QA/Reporter) or `נדרש לקבוע בעלים`, never דור. Prevents the same bug double-counting under both "@דור" and the Ready for QA ownership section.
- [ ] If a prior day's snapshot exists, computes a real diff (status changes, new bugs, released bugs, new comments, new decisions) and includes it as "מה השתנה מאתמול" (max 5 items); omits the section entirely if no reliable prior snapshot exists.
- [ ] **Renders the compact dashboard format** (superseded 2026-09-30 — see below), not the verbose Appendix A §10 structure verbatim: `*תמונת מצב — בדיקות Tier 1* 📊` header, a status-breakdown bullet list with emoji + bolded counts, an optional "מה השתנה מאתמול" line, `---` dividers, a name-only "ממתינות לאור" list (no per-item detail, no links), a short "דגשים" callout list for genuine anomalies only, bugs grouped by their linked test/street (not listed flat), and a 3–5 item "הצעדים להיום" tagging `@אור`/`@דור`. Single-asterisk bold, no tables, **no links anywhere** (no `pageUrl`/`resultLink`), target ~120–250 words. The exact template lives in `A_Agents/10_tier1_qa_reporter.md` — that file is the source of truth for wording/structure, this bullet is a summary of intent.
- [ ] Runs the pre-send validation checks from Appendix A ("בדיקות תקינות"): status breakdown sums to total; each open bug counted exactly once; every task maps to the correct test; links resolve; date shown is Asia/Jerusalem.
- [ ] **Hard safety rule:** if any record set (tests, linked bugs, or comments) failed to load completely, the run must NOT send a partial update. It must instead produce exactly: `"עדכון Tier 1 לא נשלח: הסריקה לא הושלמה. חסרים הנתונים הבאים: [...]"`, and this failure path bypasses the WhatsApp channel entirely regardless of notification-preference settings.
- [ ] New daily snapshot is persisted only after a successful, validated run (see Data Model).
- [ ] Agent is switchable on/off and re-schedulable through the existing `/agents/manage` → **הגדרות והרצה** UI — no new UI required for this.
- [ ] While in draft mode, the composed message is visible via the existing in-app notification/push channel but is **not** sent to WhatsApp. An explicit config flip (Section 6) turns on real WhatsApp delivery.

## Data Model

Both files updated together, as always: `packages/database/src/schema.pg.ts` (source of truth) and `packages/database/src/schema.ts` (SQLite mirror), plus the matching bootstrap `CREATE TABLE IF NOT EXISTS` block in `packages/database/src/index.ts`.

### New table: `tier1QaSnapshots`

Nothing in the existing schema (`facts`, `memories`) supports day-over-day diffing — this is genuinely new. One row per successful run.

| Column | Type | Notes |
|---|---|---|
| `id` | pk (uuid/serial, matches repo convention) | |
| `snapshotDate` | text, `YYYY-MM-DD` | Asia/Jerusalem calendar day; unique |
| `testsSnapshot` | json/text | array of `{ testId, statusBdika, done, testedBy, hasResultLink, linkedBugIds[] }` |
| `bugsSnapshot` | json/text | array of `{ bugId, status, priority, assignee, due, archived, deleted }` |
| `summaryStats` | json/text | the computed aggregate counts (for debugging/audit, and so a re-render doesn't require re-deriving from the two arrays above) |
| `createdAt` | timestamp, default now | |

### `tier1QaRunLog` — decided: not building

Considered, then dropped: the existing `agentMessages`/`chatMessages` history (already populated by the generic agent-run path, `runAgentTrigger` → `pushAssistantMessage`) already records every day's composed message and `agent_schedules.lastRunStatus/lastRunError` already records run outcome — a dedicated log table would duplicate both. Only `tier1QaSnapshots` above is new.

## Services & Library Integration

- **`packages/api/src/services/notion-tier1-qa.ts`** (new): follows the existing self-contained REST-over-`fetch` pattern used by `notion-tasks-sync.ts` (no `@notionhq/client` dependency added — none of the other 8 Notion services use it). Responsibilities:
  - Paginated `POST /v1/databases/{id}/query` (or the newer data-source query endpoint, matching whichever the account's Notion API version supports) against the tests data source, no view filter.
  - Property extraction for all fields in Acceptance Criteria #2, following the property-type-mapping heuristic already in `notion-tasks-sync.ts`.
  - Page content fetch: reuse the block-children pattern from `notion-meeting-note-body.ts`.
  - **Comments fetch — new capability.** No existing service calls the Notion Comments API (`GET /v1/comments?block_id=...`). This requires the integration's Notion capability "Read comments" to be enabled (an external Notion-side setting, not just code) — flagged as a prerequisite in Section 9.
  - Linked-task resolution: reuse the relation-following pattern from `notion-people-directory.ts` / `notion-tasks-sync.ts`'s project-relation matching, applied to the Engineering-tasks relation → the tasks collection (`collection://c7b1f239-...`).
  - Returns one structured payload: `{ tests[], bugs[], gaps[], classification, stats, incomplete: boolean, missingParts: string[] }`. All counting/classification/gap-detection (Appendix A §5–§7) happens here, in deterministic code — not left to the LLM — so the numeric guarantees in the acceptance criteria and the "never invent" rules are enforced by code, not by prompting.

- **Message composition — DECIDED: LLM-narrated, grounded in pre-computed data** (mirrors `04_meeting_prep_herald.md`'s pattern, not `05_ibkr_daily_import.md`'s fully-deterministic one). All counting, classification (§6), gap detection (§7), owner routing (§8), and diffing (§9) stay in deterministic code in `notion-tier1-qa.ts` — the LLM never computes a number or decides a classification. The service exposes its output as a single grounding payload (like the "sources of truth" tool pattern already used by meeting-prep-herald), and the agent's job is purely to phrase it into the Hebrew WhatsApp template from Appendix A §10, following the writing rules (natural Hebrew, single-asterisk bold, no tables, 300–600 words, collapse 50+ same-status tests, detail every אור-pending test/fix-pending test/active bug). The agent card's grounding rule must state explicitly: every number, name, and status in the output must trace back to the payload verbatim — no computing, re-deriving, or estimating counts itself.
- **Hard safety rule stays code-side, ahead of the LLM call**: if the service's `incomplete` flag is true, `runAgentTrigger` (or the agent's own run protocol) must skip the LLM entirely and emit the fixed failure string from Appendix A verbatim — never let the LLM see partial data and try to narrate around it.

- **Diffing:** compare current `tests`/`bugs` arrays against the most recent `tier1QaSnapshots` row (if `snapshotDate` = yesterday or the last available one); emit only real changes, capped at 5, per Appendix A §9.

- **Agent card + skill file** (created during implementation, not part of this spec's code diff but tracked here for completeness): `A_Agents/10_tier1_qa_reporter.md` (next available ID after `09_conversation_analyst.md`) + `S_Skills/wf_tier1_qa_reporter.md`, following the `04_meeting_prep_herald.md` template (LLM + sources-of-truth tool, with an explicit "no invention" grounding rule) rather than the fully-deterministic IBKR style, per the composition decision above.

## Cron / Scheduling

No new cron route needed. This rides the existing generic mechanism:
- Register via `/agents/manage` like any other agent (per CLAUDE.md: "dropping in a new `.md` needs no code change").
- Default `agent_schedules` row: `enabled = true`, `scheduleTimes = ["07:00"]`, editable by Alpir to any later time via the existing UI.
- `/api/cron/scheduled-agents` → `runScheduledAgents()` → `runAgentTrigger('10_tier1_qa_reporter')` picks it up like any scheduled agent, going through the **generic Gemini/Cursor LLM path** (no special-casing like IBKR), consistent with the LLM-narration decision above. The one addition needed in `runAgentTrigger` (or wherever the agent's tools are wired): before invoking the LLM, call the deterministic `notion-tier1-qa.ts` service; if `incomplete: true`, short-circuit and post the fixed failure message directly, skipping the LLM call entirely (cheaper and removes any risk of the model trying to "fill in" missing data).

## WhatsApp delivery — bridge change required

This is the one piece of new *infrastructure* risk in the spec, and it directly touches an existing security control, so it's called out on its own:

- **New, narrowly-scoped bridge capability**: a new endpoint (e.g. `POST /send-group`) or an extension of `/send` that accepts a `to` JID **only** when it matches a small, explicit allow-list of group JIDs read from a new env var (e.g. `WHATSAPP_ALLOWED_GROUP_JIDS`), separate from the existing self-chat-only guard — the self-chat guard stays exactly as-is for every other caller/endpoint. No other change to `isSelfChatJid` or the general `/send` behavior.
- Group JID discovery: `GET /groups/available` (`discoverAvailableGroups()`) already lists every group the WhatsApp account participates in with `{ jid, name, participantCount }` — use this once to find the JID for whichever group Alpir names, then hardcode it into the allow-list env var. No need to expose group-picking in product UI.
- `packages/api/src/services/whatsapp-bridge-client.ts` gets a new `sendBridgeGroupText(groupJid, text)` wrapper alongside the existing `sendBridgeText`.
- Gated by the same `notification-preferences` channel-toggle pattern already used for `whatsapp-daily-digest` (`resolveNotificationChannels`): a new `NOTIFICATION_TYPES` entry, e.g. `tier1_qa_daily_update`, with `whatsapp` **disabled by default** — this is the literal mechanism for "draft mode → flip a switch to go live" (Section on rollout), reusing an existing, already-reviewed pattern rather than inventing a new approval UI.
- The hard safety rule (blocked/incomplete → never send) is enforced in the service layer *before* the notification-channel check, so it applies unconditionally, whether or not WhatsApp delivery is enabled.
- **Baileys version requirement (found in production, 2026-09-30):** group sends need a LID-aware Baileys. The bridge's `^6.7.18` range had resolved to `6.17.16`, a mis-versioned republish of pre-LID `6.7.16` code, and every group send failed with WhatsApp's `not-acceptable` (406) while self-chat kept working. The bridge now pins **`6.7.24`** exactly (no caret — the caret is what let `6.17.16` in), replaces the removed `makeInMemoryStore` with a small local store, and preflights `groupMetadata()` in `sendWhatsAppGroupMessage` so a wrong JID / community parent / admins-only group returns a readable error. Details in `reports/tier1-qa-whatsapp-agent.md`, post-review fix 7.

## Rollout Plan

1. Ship with `tier1_qa_daily_update` WhatsApp channel **off**; only push/in-app notification enabled. Alpir reviews the daily generated message for a few days.
2. Once satisfied, Alpir flips the channel on in Settings (existing notification-preferences UI) → real sends begin to the configured group.
3. No code change needed between steps 1 and 2.

## Out of Scope

- Twilio / WhatsApp Business API integration (the user's original automation sketch mentioned this as an option; superseded by using the existing bridge + group, per the clarification).
- A new "confirmation" UI/tap-to-approve widget — draft-mode is handled via the existing channel-toggle mechanism instead.
- Any change to the self-chat guard's behavior for callers other than this agent's new, allow-listed group endpoint.
- Multi-group broadcast, or messaging דור/אור as individuals (DMs) — out of scope unless the chosen group approach turns out not to work.
- Historical backfill of snapshots before this feature ships (diffing starts from day 2 onward).

## Open Questions

1. **Which WhatsApp group?** Group name **"טכני"**; Alpir provided JID `120363411443506535@g.us` from memory (not yet verified against a live lookup — I have no runtime access to the production bridge from here). **Before wiring this into `WHATSAPP_ALLOWED_GROUP_JIDS`, the Dev Agent must verify it**: open `/settings/whatsapp` in the app, click "רענון מ-WhatsApp" (`trpc.whatsapp.groups.discover` → bridge `/groups/available`), and confirm the discovered list shows name **"טכני"** paired with exactly this JID. A wrong/stale JID here means the daily update silently goes to the wrong group (or fails), so this check is not optional. Fallback lookup: `curl -s "$WHATSAPP_BRIDGE_URL/groups/available" -H "Authorization: Bearer $BRIDGE_SECRET" | jq '.groups[] | select(.name | contains("טכני"))'`.
2. ~~Notion integration/token~~ **Resolved (corrected 2026-09-30):** the actually-configured `NOTION_ACCOUNTS` label is `DAZ` (its token is already used for DAZ Tasks/People/Meetings, in the same Notion workspace as the Tier 1 tests + engineering-tasks databases). An earlier draft of this spec used the label `alpir-daz`, which doesn't exist in `NOTION_ACCOUNTS` and caused the agent's hard safety rule to correctly block a run (`"חשבון Notion \"alpir-daz\" לא מוגדר"`) — fixed in `notion-tier1-qa.ts`. Still need to confirm this integration has the "Read comments" capability enabled in Notion's integration settings (a Notion-side toggle, not code); if not, it needs to be turned on there before comments can be fetched.
3. **Exact Notion property keys**: the user's field names (Street, גוש, חלקה, סטטוס בדיקה, etc.) need to be confirmed against the live database schema during implementation (property names/types can differ subtly from labels, e.g. relation vs rollup).
4. ~~Message composition~~ **Resolved:** LLM-narrated, grounded in the deterministic payload (see Services & Library Integration above) — not a fully deterministic template.
5. **`tier1QaRunLog` table: decided — skip it.** Reuse the existing `agentMessages`/`chatMessages` history (already populated by the generic agent-run path) for audit trail; only `tier1QaSnapshots` is a new table.
6. **Time of day**: defaulting to 07:00 Asia/Jerusalem per the clarification; confirmed user-editable later — no further input needed unless a different default is wanted now.
7. ~~Draft-review UX~~ **Resolved:** view-only via existing in-app/push notifications during the trial period (no new "approve & send" button/mutation) — matches the Rollout Plan above exactly as originally proposed.

---

## Appendix A — Verbatim source instructions (Hebrew, as provided by the user)

This is the binding specification for behavior. All numbered acceptance criteria above reference the section numbers below.

```
אתה סוכן QA תפעולי שמפיק בכל יום עדכון WhatsApp בעברית עבור דור ואור.

המטרה:
לסרוק את כל נתוני בדיקות Tier 1 ב-Notion, כולל תוכן העמודים, הערות, תגובות ובאגים מקושרים, ולהפיק הודעת סטטוס יומית קצרה, מדויקת ואופרטיבית.

מקור ראשי:
Database URL:
https://app.notion.com/p/3de1f239094380788644d837cabcf10f

Data source:
collection://3de1f239-0943-804a-b84f-000b5ead53ec

מאגר משימות ההנדסה המקושר:
collection://c7b1f239-0943-82d2-bd87-87926ab0a490

אזור זמן:
Asia/Jerusalem

בצע את השלבים הבאים לפי הסדר:

1. טען את כל הרשומות ממאגר הבדיקות, ללא הסתמכות על פילטר של View וללא הגבלת מספר הרשומות.

2. עבור כל בדיקה טען את השדות הבאים:
- Street
- גוש
- חלקה
- סטטוס בדיקה
- לינק לתוצאות הריצה
- Engineering tasks
- Tested by
- Done
- ID
- כתובת עמוד הבדיקה

3. עבור כל עמוד בדיקה טען גם:
- כל תוכן העמוד
- כל התגובות וההערות
- תגובות פתוחות וגם תגובות שנסגרו, אם המערכת מאפשרת
- שם כותב התגובה ותאריך התגובה

4. עבור כל רשומה שמכילה Engineering tasks:
- טען כל משימה מקושרת בנפרד.
- טען גם משימות Archived או Deleted אם הן עדיין מקושרות, וסמן אותן ככאלה.
- טען את השדות:
  - Task ID
  - Task name
  - Status
  - Priority
  - Assignee
  - QA
  - Reporter
  - Type
  - Due
  - Tests for Tier 1
  - כתובת המשימה
- טען את תוכן המשימה ואת כל התגובות עליה.

5. חשב מחדש בכל הרצה:
- מספר הבדיקות הכולל.
- מספר הבדיקות בכל "סטטוס בדיקה".
- מספר הבדיקות המסומנות Done.
- מספר הבדיקות עם Tested by.
- מספר הבדיקות עם לינק לתוצאות ריצה.
- מספר הבאגים המקושרים הכולל.
- מספר הבאגים הפעילים, ששוחררו, בוטלו, הועברו לארכיון או נמחקו.
- התפלגות הבאגים הפעילים לפי Status ו-Priority.
- מספר הבאגים הפתוחים ללא Assignee.
- מספר הבאגים הפתוחים ללא Due date.

6. כללי סיווג:
- באג בסטטוס Released אינו נחשב "פתוח", אבל מחייב בדיקת רגרסיה אם הבדיקה המקושרת עדיין לא Done.
- באג בסטטוס Cancelled או Archived אינו נחשב "פתוח".
- משימה Deleted אינה נחשבת באג פעיל, אך יש לציין אם בדיקה עדיין מקושרת אליה.
- כל Status אחר, כגון Pending, Not started, Reopen, In Dev, Ready for QA או In QA, נחשב פתוח.
- אין להסיק שבדיקה הושלמה רק מפני שהבאג Released.
- אין להסיק שתגובה ישנה עדיין נכונה אם סטטוס המשימה השתנה לאחר כתיבתה. במקרה כזה ציין שיש צורך באימות.
- אל תמציא בעלים, תאריך יעד, תיקון או החלטה שאינם מופיעים בנתונים.

7. אתר פערים וחוסר עקביות, במיוחד:
- בדיקה שממתינה לתיקון אבל אין לה באג פעיל.
- באג Released כאשר הבדיקה עדיין ממתינה לתיקון או לבדיקה.
- בדיקה שממתינה לתיקון אך מקושרת רק לבאג Cancelled, Archived או Deleted.
- בדיקה שממתינה לבדיקת אור לאחר שהבאג המקושר כבר Released.
- באג פתוח ללא Assignee או Due date.
- שאלה פתוחה בתגובות שלא קיבלה מענה.
- תגובה שבה דור מציין שהוא ממתין לאור.
- בדיקה שבוטלה אך עדיין מקושרת למשימה פעילה.
- רשומה ללא גוש/חלקה או ללא לינק לתוצאה, כאשר הדבר רלוונטי להתקדמות.

8. חלק את הפעולות הנדרשות לפי בעלים:
- "לאור" — בדיקות מקצועיות, אימות תוצאות, תשובות לשאלות מקצועיות ואימות נתוני תכנון.
- "לדור" — תיקוני פיתוח, שיוך באגים, קביעת עדיפות, עדכון סטטוסים ותאריכי יעד.
- "לאלפיר/QA" — בדיקות רגרסיה, הרצות חוזרות, עדכון Tested by, Done וסטטוס הבדיקה.
אל תשייך פעולה לאדם אם אין לכך בסיס ברור. במקרה של ספק כתוב "נדרש לקבוע בעלים".

9. אם קיים snapshot מאתמול:
- השווה את הנתונים למצב הקודם.
- ציין רק שינויים ממשיים: בדיקות ששינו סטטוס, באגים שנפתחו, באגים ששוחררו, תגובות חדשות והחלטות חדשות.
- אל תציג שינוי אם אין ערך קודם אמין להשוואה.
אם אין snapshot קודם, השמט את סעיף "מה השתנה מאתמול".

10. הפק הודעת WhatsApp בעברית בפורמט הבא:

היי דור ואור, עדכון בדיקות Tier 1 ל-[תאריך ושעה בישראל]:

*תמונת מצב*
- [סך הבדיקות וההתפלגות לפי סטטוס]
- [צוואר הבקבוק העיקרי]
- [מספר הבאגים הפתוחים והתפלגות קצרה]

*מה השתנה מאתמול*
- [רק אם קיים snapshot אמין]
- [עד 5 שינויים חשובים]

*ממתין לאור*
- [כתובת]: [מה צריך לבדוק או להכריע]
- כלול קישור Notion או קישור לתוצאת הריצה כאשר הוא שימושי.

*ממתין לדור / פיתוח*
- [כתובת + מספר באג]: [הבעיה, הסטטוס והפעולה הנדרשת]
- ציין Priority כאשר הוא High.
- ציין במפורש באגים ללא Assignee או Due date.

*בדיקות חוזרות נדרשות*
- [בדיקות שבהן הבאג Released אבל הבדיקה טרם נסגרה]

*פערים שדורשים החלטה*
- [בדיקה ללא באג, משימה שנמחקה, שאלה פתוחה או סטטוס לא עקבי]

*הצעדים להיום*
1. [הפעולה הדחופה ביותר]
2. [הפעולה השנייה]
3. [הפעולה השלישית]

כללי כתיבה:
- כתוב בעברית טבעית, ישירה ומקצועית.
- התאם את ההודעה ל-WhatsApp: פסקאות קצרות ובולטים, ללא טבלאות.
- השתמש בכוכבית אחת להדגשות WhatsApp.
- אל תציג רשימה מלאה של 50+ בדיקות אם לכולן אותו סטטוס; הצג מספר כולל וסכם את הפעולה הנדרשת.
- כן פרט כל בדיקה שממתינה לאור, כל בדיקה שממתינה לתיקון וכל באג פעיל.
- תן עדיפות לחסמים, לבאגים High ולשאלות ללא מענה.
- אל תציג מידע שאינו קיים במקורות.
- אל תכלול ניתוח פנימי, JSON, הסברים טכניים או ציטוטים ארוכים מהתגובות.
- אורך יעד: 300–600 מילים. אם יש מעט שינויים, כתוב הודעה קצרה יותר.

בדיקות תקינות לפני שליחה:
- ודא שסכום ההתפלגות לפי סטטוס שווה למספר הבדיקות הכולל.
- ודא שכל באג פתוח נספר פעם אחת בלבד.
- ודא שכל משימה מקושרת לבדיקה הנכונה.
- ודא שהקישורים תקינים.
- ודא שהתאריך מוצג לפי Asia/Jerusalem.

כלל בטיחות קריטי:
אם לא הצלחת לטעון את כל הרשומות, את הבאגים המקושרים או את התגובות, אל תשלח עדכון חלקי כאילו הוא מלא. במקום זאת החזר:
"עדכון Tier 1 לא נשלח: הסריקה לא הושלמה. חסרים הנתונים הבאים: [פירוט]."
```

### Automation wrapper (as sketched by the user; superseded where this spec differs)

1. Schedule: כל יום בשעה הרצויה, באזור הזמן `Asia/Jerusalem`.
2. Notion: קריאת כל הרשומות, העמודים, התגובות והמשימות המקושרות.
3. Snapshot: שמירת תוצאת הסריקה היומית כדי לזהות שינויים למחרת.
4. AI: הפעלת הפרומפט לעיל על הנתונים שנאספו.
5. Validation: עצירה אם הקריאה חלקית או נכשלה.
6. WhatsApp: שליחה — **per clarification, via an existing WhatsApp group the bridge can reach, not Twilio/Business API** (see "WhatsApp delivery" section above).
7. לאחר הצלחה: שמירת ה-snapshot החדש עם זמן ההרצה.

### Target output style (example provided by the user — binding tone/format bar)

```
*תמונת מצב — בדיקות טיר1* 📊

*סטטוס כולל (68 בדיקות):*
• ⏳ *52* ממתינות להורדת מסמכים (צוואר בקבוק מרכזי)
• 👤 *8* ממתינות לבדיקה של אור
• 🛠 *6* ממתינות לתיקון
• ❌ *2* בוטלו
• ✅ *0* מסומנות כ-Done

---

*ממתינות לאור (8 בדיקות):*
הזוהר 33, בני דן 54, לואי מרשל 16, שלומציון המלכה 73, לואי מרשל 14, עקיבא אריה 25, בני דן 72, לואי מרשל 10.

*דגשים:*
• *עקיבא אריה 25:* באג סומן Released — נדרש re-test.
• *בני דן 72:* באג Released, נחסם בהרצה עקב בעיית היתכנות — לנסות שוב.
• *שלומציון המלכה 73:* נאספו 52 מסמכים — לוודא כמות מול הדרישה.

---

*באגים פתוחים (7 סה״כ | 4 Pending, 3 Not Started):*
*(ללא תאריכי יעד כרגע)*

• *עמיאל 36 (High):* רובוט נתקע באיסוף מסמכים עקב כשל חיבור.
• *צירלסון 22 (3 באגים):* חיווי התקדמות, קווי בניין, ושטחים (דור ממתין לאור).
• *הזוהר 35 (2 באגים):* אי-התייחסות לקיר משותף + הדמיית תלת-ממד/קווי בניין.
• *דרך נמיר 123:* קומות, קווי בניין ושטחים — ב-Pending ללא Assignee וללא סיבה מתועדת.
• *הרב קוק 35:* מסומן "ממתין לתיקון" ללא באג מקושר — מהות התיקון לא ברורה.
• *הזוהר 41:* באג כבר Released — להריץ מחדש ולעדכן סטטוס בדיקה.

---

*Next Steps מיידיים:*

1. *@אור* — לעבור על 8 הבדיקות הממתינות ולתת מענה בצירלסון 22 וברב קוק 35.
2. *@דור* — לקחת בעלות (Owner) ולו"ז ל-7 הבאגים הפתוחים, בעדיפות עליונה לעמיאל 36 (High).
3. *רגרסיה:* לבדוק באגים שסומנו Released ולעדכן סטטוסים.
4. *צוואר בקבוק:* לגבש פתרון/תוכנית עבודה ל-52 ההורדות התקועות.
5. *היגיינת דאטה:* לעדכן Tested By ו-Done בזמן אמת.
```
