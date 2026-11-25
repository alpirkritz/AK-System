# Review — commitment-task-linking

**Verdict: APPROVED WITH NITS**
**Date:** 2026-11-25 · Spec: `docs/specs/commitment-task-linking.md` (v3, decision B)

## What changed
- `packages/api/src/services/action-item-link.ts` (new) — one place that keeps a meeting
  action item and its commitment in sync by id:
  - `linkAnalysisItems` pairs items with commitments and reconciles both directions;
  - `syncItemFromCommitment` (commitment → meeting);
  - `acceptCommitmentForItem` (meeting → commitment).
- `services/commitments.ts`
  - `proposeCommitmentsFromAnalysis` links items right after proposing.
  - The text-only `acceptCommitmentsForActionItem` is removed.
- `routers/commitments.ts`
  - `accept` (both paths), `linkTask` and `dismiss` now update the meeting item.
- `routers/meetings.ts`
  - `createTasksFromAnalysis` and `linkActionItemTasks` accept by id.
  - "צור הכל" without indices skips dismissed items.
  - `getAnalysis` heals older analyses on view, so no migration is needed.
- Web: `ConversationAnalysis.tsx` shows "נסגר" (struck-through) for items closed under
  התחייבויות. `BatchTaskModal.tsx` skips them.
- No schema change.

## Verification
- New `routers/commitment-task-linking.test.ts`: 8 tests covering each write path in both
  directions, the TaskModal fast path, an id link that survives a text edit, dismiss plus
  "צור הכל", re-analysis, and on-view healing.
- API suite: 1561 tests. The 3 that failed after the change were exact-equality checks on
  `action_items_json` in the voice tests, now updated to ignore `commitmentId`. Re-run passes.
- `pnpm -r run lint` clean. `pnpm --filter @ak-system/web build` passes.
- Playwright (meeting / commitment specs): 12 passed, 7 failed. The failures are selector
  misses (`ניתוח שיחה עמוק` text, `משימה חדשה` dialog/heading, `getByRole('heading')`
  strict mode), including the "no analysis exists" case this change doesn't touch. They look
  stale against the current UI and don't come from this change, but they weren't run against
  a clean baseline.

## Nits
1. `waiting.complete` closes a task-less commitment without syncing. The item picks up "נסגר"
   the next time the meeting is viewed, which is fine but lazy.
2. A commitment closed because the other person delivered (`waiting.complete`) also shows
   "נסגר" (neutral wording chosen on purpose, not "נדחה").
3. The stale e2e selectors in `meeting-conversation-analysis.spec.ts` and
   `calendar-link-and-commitment-task-modal.spec.ts` should be refreshed separately.
