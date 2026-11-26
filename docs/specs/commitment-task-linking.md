# A meeting action item and its commitment are one thing

> **Slug:** `commitment-task-linking`
> **Status:** Approved (v3)
> **Last Updated:** 2026-11-25
> **Builds on:** `conversation-analysis-task-created-state`, `calendar-link-and-commitment-task-modal`

## The problem (Alpir's words)

"I finish a meeting, the conversation analysis produces action items, and they show up both on
the meeting **and** under התחייבויות." That's the same item twice. Handling it in one place
doesn't update the other, so I either see it twice or create the task twice.

## What the code does today

After an analysis finishes, `proposeCommitmentsFromAnalysis` (`services/commitments.ts`)
copies each action item into a **new, separate** `commitments` row (`source='meeting_analysis'`
or `voice`, `sourceId=meetingId`). From then on there are two unrelated objects:

| Action | Meeting page | התחייבויות |
|---|---|---|
| "צור משימה" on the meeting | ✓ נוצר | closed **only if the text matches exactly** (`acceptCommitmentsForActionItem`, `content ===`, 140-char trim), so it often stays open |
| "אשר → משימה" in התחייבויות (`commitments.accept` / `linkTask`) | **nothing is written back to `action_items_json`**, still shows "צור משימה" | ✓ |
| "דחה" in התחייבויות (`dismiss`) | still shows | gone |

So the link is by text, and only in one direction.

## Goal

One item, one id. The action item and its commitment share an id, so whatever you do in
either place (create a task, link to a task, dismiss) shows up in both. It's never handled twice.

## Acceptance criteria

### One shared id
- [ ] When `proposeCommitmentsFromAnalysis` creates a commitment from action item *i*, it
      writes the commitment id back onto that item (`commitmentId` in `action_items_json`). From
      then on the link is by id. `acceptCommitmentsForActionItem` (exact-text match) is removed.
- [ ] Items that get no commitment (no resolvable person) stay meeting-only, as today.
- [ ] Re-analysis (re-run button) keeps the ids. An item whose text still matches an existing
      linked commitment keeps its `commitmentId` and `taskId`. Orphaned commitments are left as
      they are; cleanup is out of scope.

### Both directions stay in sync (one service, every write path goes through it)
- [ ] New `services/action-item-link.ts`:
      - `linkAnalysisItems` pairs items with commitments and reconciles both ways;
      - `syncItemFromCommitment` (commitment → meeting);
      - `acceptCommitmentForItem` (meeting → commitment).
- [ ] Routed through it:
      - `meetings.createTasksFromAnalysis` and `meetings.linkActionItemTasks` (meeting side);
      - `commitments.accept`, `commitments.linkTask` and `commitments.dismiss` when
        `source in (meeting_analysis, voice)`;
      - the mobile equivalents (same tRPC).
- [ ] Result: create the task on the meeting → the commitment is `accepted` with that `taskId`.
      Create it from התחייבויות → the meeting item shows "✓ נוצר" with the same task. Dismiss
      it → the meeting item shows "נסגר" and "צור הכל" skips it.

### Shown in both places, always in sync (decision B, 2026-11-25)
- [ ] Meeting items keep appearing under התחייבויות (with the meeting as the source), and
      their state there always matches the meeting page.

### Backfill
- [ ] Lazy instead of a migration: `meetings.getAnalysis` runs `linkAnalysisItems` on every
      view of a completed analysis. Older meetings get paired (by the stored normalized text,
      then by order) and pick up any task or dismissal from the other side. It's idempotent
      and only writes when something changed, so no script or Postgres migration is needed.

## Data model
No schema change. `action_items_json` items gain optional `commitmentId` and `dismissed`.

## tRPC API
No new procedures. Existing ones change behavior through the shared service:
- `meetings.createTasksFromAnalysis`
- `meetings.linkActionItemTasks`
- `commitments.accept`
- `commitments.linkTask`
- `commitments.dismiss`

`meetings.getAnalysis` returns `commitmentId` and `dismissed` per item.

Vitest coverage:
- Each of the five paths updates both sides.
- Re-analysis keeps the links.
- The on-view healing of older analyses.

## UI surface
- Meeting action item: "משימה נוצרה" / "נסגר" reflect actions taken in התחייבויות too.
- Web only. Mobile lists items without task actions, so it's unchanged.

## Out of scope (separate follow-up if wanted)
- Cross-channel dedupe: a Slack/WhatsApp commitment that already became a task, then comes
  up again in a meeting. Designed in v2 of this spec (giving the analyzer the open ids) and
  can be picked up later.

## Decision
B — shown in both places, kept in sync by the shared id (Alpir, 2026-11-25).
