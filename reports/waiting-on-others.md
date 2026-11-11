# waiting-on-others — status

**Verdict: APPROVED WITH NITS (web, mobile and API complete; not yet viewed in a browser or simulator; e2e outstanding). No Reviewer-agent pass yet.**

## Done
- `services/waiting.ts` + `routers/waiting.ts`: `waiting.list({ personId? })` (open tasks assigned to someone else, plus accepted `owner=them` commitments with no task; bucketed overdue / today / thisWeek / later / noDate in the owner's timezone) and `waiting.complete` (tasks close through `tasks.update`, so Notion write-back still runs).
- Web: `/waiting` page ("חייבים לי", nav entry) with views היום / לפי אדם / לפי זמן and a person filter; dashboard card "חייבים לי היום"; person drawer opens with a tasks section first ("חייב/ת לי" block, then related tasks without repeats); `/tasks` chip "ממתין לאחרים" links to the page.
- Morning briefing: "חייבים לי היום:" lines, what first, late items marked.
- Open question answered: an `owner=them` commitment turned into a task already gets that person as `assigneeId` (`commitments.accept`, `taskPrefill`).
- `pnpm test`: api 1416/1416, web 311/311. Lint: no errors. Web build compiles, `/waiting` built.

## Deviations
- `/tasks` chip is a link to `/waiting` rather than a third filter mode on the same list.
- `waiting.list` has no `view` parameter; the client shapes the buckets.
- Completing a task-less commitment sets its status to `dismissed` (no separate "closed" status exists).
- Proposed (unconfirmed) `owner=them` commitments are not shown, per the spec.

- Mobile: `חייבים לי` screen (More menu entry, same three views and person filter), home card "חייבים לי היום", person screen shows "חייב/ת לי" at the top of its tasks card without repeats. `pnpm lint` (tsc) clean; `lib/waiting.test.ts` passes.

## Not done
- Playwright e2e; UI Designer (RTL/dark) pass; visual check in a browser and the simulator; Reviewer pass.
