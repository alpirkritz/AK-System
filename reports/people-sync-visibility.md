# Review — People Page Sync Visibility & Default WhatsApp Capture

> **Slug:** `people-sync-visibility`
> **Spec:** `docs/specs/people-sync-visibility.md`
> **Date:** 2026-09-30
> **Verdict:** APPROVED WITH NITS

## Scope reviewed

Two small, independent additions on top of already-implemented systems: (1) a manual "סנכרן מ-Notion" trigger on `/people`, reusing the existing `tasks.syncFromNotion` mutation (which already syncs people as a side effect) instead of forcing a trip to `/tasks`; (2) auto-enabling WhatsApp 1:1 capture (`captureWhatsapp` + `captureWhatsappSince`) when a person is created via the People page **with a phone number**, using the existing `setCaptureWhatsapp`/`pushDmAllowlist` helpers so it behaves identically to toggling capture on manually.

## Changes

| Area | File | Notes |
|---|---|---|
| Backend | `packages/api/src/routers/people.ts` | `create` now calls `setCaptureWhatsapp(ctx.db, id, true)` + `pushDmAllowlist(ctx.db)` when `input.phone` is set; no-op (unchanged behavior) when phone is absent |
| UI | `apps/web/src/app/people/page.tsx` | Added `tasks.notionConfigured` query + `tasks.syncFromNotion` mutation, mirroring `/tasks`; new button (`data-testid="people-notion-sync"`) in the tabs row, gated on `notionConfigured`; result banner surfaces `peopleCreated`/`peopleUpdated`/errors; `onSuccess` invalidates the whole `people.*` query cache (`utils.people.invalidate()`) so `listPaginated`, `reviewQueue`, `findDuplicates` etc. all refresh |
| Tests | `packages/api/src/routers/people.test.ts` | 2 new cases: create-with-phone auto-enables capture (`captureWhatsapp`, `captureWhatsappSince` set); create-without-phone leaves capture off |

No schema changes (reused existing `people.phone` / `captureWhatsapp` / `captureWhatsappSince` columns and existing `whatsapp-dm.ts` helpers). No new tRPC procedures — both features reuse `tasks.syncFromNotion` / `tasks.notionConfigured` and `people.create`.

## Spec conformance

- [x] Button hidden when Notion isn't configured, shown when it is (same `notionConfigured` gate as `/tasks`).
- [x] Pending/disabled state while syncing, matching `/tasks` copy (`מסנכרן…`).
- [x] Result banner surfaces `peopleCreated`/`peopleUpdated`/errors (previously computed by the sync but never surfaced anywhere — `/tasks` only reads its own task counts).
- [x] `people.*` queries invalidated on success.
- [x] Error toast on mutation failure, no crash.
- [x] Create-with-phone sets `captureWhatsapp=true` + `captureWhatsappSince`; create-without-phone leaves both off.
- [x] Reuses `pushDmAllowlist` so the bridge allowlist is pushed the same way `people.update` already does it.
- [x] `people.update` semantics untouched (spec explicitly scoped the default to `create` only).
- [x] Out of scope honored: no changes to Notion sync's people-scan cadence/window, no phone-capture added to Notion/Google-contacts/calendar-attendee person-creation paths, no retroactive backfill.

## Nits (non-blocking)

- The auto-enable is silent (no inline confirmation toast on the "add person" flow) — this was flagged as an open question in the spec and left as the proposed default; revisit if users are surprised capture turned on.
- No Playwright coverage was added for the new People sync button. Checked: the existing, structurally identical button on `/tasks` also has no e2e coverage, because Notion isn't configured in the e2e environment (`NOTION_*` env vars aren't set for Playwright), so the button never renders there either. Adding one only for `/people` would be inconsistent with the existing pattern and wouldn't exercise real Notion behavior; flagging as a pre-existing gap rather than a regression introduced here.
- Unrelated to this change: `packages/database/package.json` doesn't declare `pg` as a dependency even though `packages/database/src/index.ts` statically imports it (`import { Pool } from 'pg'`). It resolves today only because `pg` happens to be present as `drizzle-orm`'s optional peer dependency in the lockfile. This didn't block anything in the real dev environment but did surface when running the suite in a from-scratch Linux install for QA. Recommend declaring it explicitly in `packages/database/package.json` as a follow-up — did not fix it here since it's out of scope for this spec.
- Also unrelated: `packages/api/src/services/voice-diarization.test.ts`'s "never throws... when the audio file does not exist" test has a pre-existing bug — its own `insertRecording` helper calls `fs.statSync(audioPath).size` on the nonexistent path before the function under test ever runs, so it fails before exercising the thing it's meant to test. Confirmed unrelated to this change; flagging for a separate fix.

## QA

Because this sandbox runs Linux while the project's `node_modules` on disk are macOS-built (native `esbuild`/`better-sqlite3` binaries), verification was done from a clean, from-scratch `pnpm install` of the touched workspaces (`packages/api`, `packages/database`, `packages/types`, `apps/web`) in an isolated scratch copy — no changes were made to the real project's installed dependencies.

- `vitest run` (packages/api, full suite): **898 → 907 passed**, 9 failed, all 9 unrelated to this change — 8 were an artifact of the scratch copy missing the `A_Agents/` directory (confirmed: all 15 `agents.test.ts` cases pass once that directory is present) and 1 is the pre-existing `voice-diarization.test.ts` bug noted above. **Zero failures in `people.test.ts` or anywhere touched by this diff.**
- `next lint` (apps/web): clean — only pre-existing warnings in untouched files; no warnings in `people/page.tsx`.
- `pnpm -r run lint`: ran cleanly for `apps/web`; `apps/mobile`/`apps/whatsapp-bridge` type-check steps didn't run meaningfully in the scratch copy since their full source wasn't copied in (untouched by this diff, so not expected to be affected — worth a real `pnpm -r run lint` on the actual machine as a final sanity check).
- `pnpm --filter @ak-system/web build`: **succeeded**, `/people` route compiles (17.9 kB) alongside all other routes.
- Manual verification of the new People page button UI (placement, loading/disabled state, banner) was done by code review against the existing, shipped `/tasks` implementation it mirrors; no visual screenshot pass was done since the sandbox has no way to authenticate into a running dev server with real Notion credentials.
