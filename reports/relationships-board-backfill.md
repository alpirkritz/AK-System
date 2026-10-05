# Review — relationships-board-backfill

**Verdict: APPROVED WITH NITS**

Spec: `docs/specs/relationships-board-backfill.md`

## What changed

- `packages/api/src/services/analysis-backlog.ts` (new): `listAnalysisBacklog`, `runAnalysisBacklog`, `analysisBacklogSummary`. Injectable analyzer for tests. Source `backfill`, no notifications, no commitments.
- `packages/api/src/services/warmth.ts`: `splitPersonWindows` (90/90 with newest-half fallback), used by `personWarmth`, `relationshipFlags` and the board. Board returns every confirmed person with analysed data plus `trend: stable | null`, `avgScore`, `lastDate`, `latestMood`, `latestInsight`, `minForTrend`, and a `summary`. Circles no longer require `rosterSavedAt`; shown from 2 analysed instances, trend from 6.
- `packages/api/src/routers/insights.ts`: `relationshipBoard` adds `summary.pendingBacklog`; new `analysisBacklog` query and `runAnalysisBacklog` mutation (1–5).
- `apps/web/src/app/api/cron/transcript-analysis/route.ts`: backlog pass after the recent pass, `ANALYSIS_BACKFILL_PER_RUN` (default 3); response gains `backfilled`, `backfillFailed`, `backlogRemaining`. The early return on "no recent meetings" is gone so the backlog drains on every run.
- `apps/web/src/app/relationships/page.tsx`, `components/relationship/RelationshipCard.tsx`: summary strip with "נתח עכשיו", four person sections and four circle sections, richer card (score, last meeting, mood, insight), explanatory empty states.
- Docs: `deploy/production.env.example`, `docs/deploy/cron-setup.md`, `M_Memory/agents_daily_sync.md`.

## Checks

- Vitest `packages/api`: `analysis-backlog.test.ts` 2/2, `insights.person-context.test.ts` 13/13. Full suite: 1041 passed, 3 failed in `voice-large-file.test.ts` / `voice-diarization.test.ts` — pre-existing, untouched by this change (Gemini file-manager mock returns undefined for `deleteFile`).
- `tsc` on the touched API files and the two React files: clean. `next build` has `ignoreBuildErrors: true` in this repo, so type errors would not block a deploy anyway; run `pnpm --filter @ak-system/web build` from the Mac before `pnpm deploy:ec2` as usual.
- ESLint (web config) on the three touched web files: clean.
- Run in a Linux sandbox with a fresh `pnpm install`; `pnpm e2e` was not run here (needs the Mac toolchain). No e2e spec covers `/relationships`.

## Nits

- Mobile still lists movers only (spec: out of scope). Stable / no-trend cards and the summary strip are web-only for now.
- `relationshipFlags` and the board compute the same buckets twice per dashboard load; fine at this data size.
- Backfill uses the Notion page *summary* (2–4k chars), not a full transcript. Scores will be coarser than for live-transcribed meetings; the card's mood/insight lines make that visible.

## Production notes

- After deploy, the first cron run analyses 3 notes; ~300 notes in the window means about a day at the default rate. Set `ANALYSIS_BACKFILL_PER_RUN=10` on the box to drain in a few hours, or press "נתח עכשיו" a few times.
- No schema change; nothing to migrate.
