# Review — waiting-commitment-open

**Spec:** `docs/specs/waiting-commitment-open.md`
**Date:** 2026-11-10
**Verdict:** APPROVED WITH NITS

## What changed

- `packages/api/src/routers/commitments.ts`: new `linkTask` mutation. It accepts only an accepted, `owner=them` commitment with no task yet, checks that the task exists, and makes a guarded update (`task_id IS NULL`).
- `apps/web/src/components/commitments/CommitmentTaskModal.tsx` (new): TaskModal wrapper fed by `commitments.taskPrefill`. It opens only after the prefill loads, and keeps `initialValues` memoized because TaskModal resets the form whenever that object changes identity.
- `apps/web/src/components/commitments/CommitmentContext.tsx` (new): moved out of `/commitments` as is, plus a `compact` variant.
- `apps/web/src/components/waiting/useCommitmentEditor.tsx` (new): opens the modal, runs `linkTask` and invalidates `waiting.list`, `tasks.list` and `commitments`. A link failure shows as an alert above the list.
- `apps/web/src/components/waiting/WaitingList.tsx`: new `onOpenCommitment` prop, threaded the same way as `onOpenTask`. Commitment titles become buttons, and WhatsApp commitments get the context toggle.
- Wired into `/waiting`, `WaitingTodayCard` and `PersonDetailDrawer`.
- `/commitments` now uses the two extracted components, with no behavior change.

## Checks

| Check | Result |
|---|---|
| `pnpm test` | pass: api 1533/1533, web 330/330 |
| New Vitest `routers/waiting-commitment-open.test.ts` | 6/6 pass |
| New Playwright `e2e/waiting-commitment-open.spec.ts` | 2/2 pass |
| `pnpm -r run lint` | pass |
| `pnpm --filter @ak-system/web build` | pass |
| Full `pnpm e2e` | not run; ran only the new spec and `calendar-link-and-commitment-task-modal.spec.ts` |

`calendar-link-and-commitment-task-modal.spec.ts` has 2 failures that predate this change and are unrelated to it:
- It looks for `getByRole('heading', { name: 'משימה חדשה' })`, but TaskModal renders that title as a `<div>` (`TaskModal.tsx:267`).
- It checks for the "attach to calendar" button on a calendar meeting page.

## UI review (RTL / dark / design system)

- Commitment title buttons reuse the task-row classes (`text-right hover:text-white`). The context toggle uses the existing muted tokens (`#5a688c` → `#97a4c2`). The error line uses the existing danger colour `#e57373`.
- All copy is Hebrew: "פתח לעריכה", "הצג הקשר", "המשימה נוצרה אבל לא קושרה להתחייבות".

## Deviations from spec (spec updated)

1. The `linkTask` error shows above the list instead of inside the modal, because TaskModal closes itself right after the create succeeds.
2. The context toggle appears only on WhatsApp commitments. `sourceContext` returns messages only for those sources, so on a voice commitment the toggle would always say the messages are gone.

## Nits

- TaskModal's form-reset effect depends on `initialValues` identity. `/commitments` used to pass a new object on every render; the shared wrapper fixes this for both pages, but other TaskModal callers that pass inline objects still carry the risk.
