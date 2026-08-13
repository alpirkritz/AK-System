# QA — feed-ai-tldr-digest

> **Slug:** `feed-ai-tldr-digest`
> **Date:** 2026-08-13
> **Detected stack:** next-trpc-monorepo

## Spec

`docs/specs/feed-ai-tldr-digest.md`

## Verdict

PASS — unit, targeted e2e, and web build are green.

## Commands

| Check | Result |
|---|---|
| `pnpm test` | PASS — API 675, web 172 |
| `pnpm --filter @ak-system/web run test:e2e -- e2e/updates.spec.ts` | PASS — 2/2 |
| `pnpm -r run lint` | SKIP — `next lint` interactive (pre-existing) |
| `pnpm --filter @ak-system/web build` | PASS |

## Coverage

- Vitest: `feed-digest.test.ts` — JSON parse, fences, invalid indexes, prompt numbering
- Vitest: `feed.test.ts` — getDigest null, generateDigest persist, empty-feed rejection
- Playwright: `/updates` shows **תמצית הפיד** and `#feed-digest` empty CTA

## Notes

- Live Gemini was not called in tests (`generateFeedDigest` mocked). Needs `GEMINI_API_KEY` in `.env.local` to work in the app.
- Full Playwright suite not re-run.
