# Review — people-domain-hierarchy

**Date:** 2026-10-20
**Spec:** `docs/specs/people-domain-hierarchy.md`
**QA:** `reports/qa-people-domain-hierarchy.md`

## Verdict: APPROVED WITH NITS

## UI/UX Review — APPROVED WITH NITS

- **RTL / dark theme / design system:** new surfaces use `.card`, `.input`, `.btn`, `.filter-chip`, `.pill`, and the existing palette (`#2dd4bf` accent, `#141f36` panels). Hebrew microcopy is short and action-led ("שייך לעולם", "שמור שיוך", "פרטים מגוגל").
- **Z Fold 7, folded (~390px):** cards by default below 768px; workspace chips scroll horizontally; the people toolbar wraps; the drawer is full-width (`globals.css` media query, `100dvh`). The Playwright check confirms there is no horizontal overflow at 390px.
- **Z Fold 7, unfolded (~768px):** chips wrap; table view; badges sit under the name instead of in a new column, which keeps the table narrow.
- **Touch targets:** drawer actions are at least 36px, form buttons at least 40px, chips at least 32px.
- **Feedback states:** empty affiliation state explains why it matters; server validation errors show inline in Hebrew; profile fill has loading, empty, error, and success states and never writes before confirmation.
- Nit: the affiliation editor is inline in the drawer rather than the bottom sheet described in the spec. On a folded phone the drawer is already full-screen, so this is intentional (logged in the spec's decision log).
- Nit: the "בחר" checkbox in the profile dialog uses `role="checkbox"`. The older phone-fill dialog still has the `aria-checked`-on-button lint warning.

## Spec conformance

| Area | Status |
|---|---|
| Many-to-many `person_workspaces`, free-text relationship, per-workspace reports-to | ✅ `packages/database/src/schema*.ts`, `services/person-workspaces.ts` |
| `workspaces.kind` + `description`, default kinds seeded | ✅ also accepted on `create` |
| `people.linkToWorkspace / unlinkFromWorkspace / listByWorkspace` (+ `affiliations`, `listPaginated.workspaceId`) | ✅ `routers/people.ts` |
| Merge / delete keep affiliations consistent | ✅ `repointPersonWorkspaces`, `clearPersonWorkspaces` |
| Harness person nodes carry domain, relationship, manager | ✅ `services/harness-context.ts` |
| Google enrichment (company, job title, notes), additive only, reviewed | ✅ `services/google-profile-fill.ts`, `GoogleProfileFillModal.tsx` |
| Responsive for Fold 7 | ✅ see UI review |

## Production (EC2) schema path — verified

Production is SQLite on the EC2 Docker volume. Its start-time `db:push` always fails and rolls back (pre-existing drizzle-kit duplicate-index bug, tolerated by `scripts/production-start.sh`), so the schema actually lands through the `getDb()` bootstrap. Verified on a schema-only replica of production:

- The bootstrap adds `kind` and `description`, seeds the 4 default kinds, and creates `person_workspaces` with its 3 indexes.
- All other 87 schema tables already exist in production.
- `person_workspaces` bootstrap DDL is in drizzle-kit's format, so `db:push` reports "No changes detected". Before this fix, it made local `pnpm test`/`pnpm e2e` crash.

No manual migration step is needed for deploy.

## Static checks

- `pnpm -r run lint`: pass (warnings only, none new except the fixed one).
- `pnpm --filter @ak-system/web build`: pass.

## Tests

- New: 19 Vitest + 3 Playwright, all green.
- Full API: 1352/1357. The only failures are in `voice-chunked-transcription.test.ts` (uncommitted voice work, `fs` spy error).
- Full e2e: 104 passed, 34 failed. All failing specs are in untouched areas: the create-person modal's "תפקיד" field (unchanged since Aug), `/settings` links and recurring (other uncommitted work), Slack, meeting analysis, trading, and task-assignee "me" label. None exercise this feature's code paths.

## Follow-ups (not blocking)

1. Bugfix spec: production `db:push` has failed on every deploy. Any future table defined only in `schema.ts` (without a bootstrap block) will never reach production.
2. Set a kind for the two non-default production workspaces (`DAZ - Engineering Tasks`, `Design Tasks`) in `/settings/workspaces`. Prefer linking DAZ people to `DAZ - Management board` (`ws_daz`), because the engineering workspace is a task source rather than a separate life domain.
3. The default-kind seed only fills `NULL`, so clearing the kind of a default workspace to "לא הוגדר" is re-seeded on next boot. This is acceptable for now.
