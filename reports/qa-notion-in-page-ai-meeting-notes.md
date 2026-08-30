# QA — notion-in-page-ai-meeting-notes

> **Slug:** `notion-in-page-ai-meeting-notes`
> **Date:** 2026-08-30
> **Stack:** `next-trpc-monorepo`

## Result

PASS (unit + targeted e2e + web build). Full `pnpm e2e` suite not re-run; new spec `e2e/meeting-ai-notes.spec.ts` passed.

## Notion API probe

Page `3cce7d50-cb8e-809c-8f7c-da639bce5478` (Meetings DB page):

| Layer | Types |
|---|---|
| Top-level | `paragraph`, `heading_1`, `bulleted_list_item`, `transcription+`, `heading_1`, `child_database`, `unsupported`, `paragraph` |
| Hash block `fb2e7d50-…` | type `transcription`, `has_children: true` |
| Transcription children | 3 `paragraph+` |
| Nested (depth 2) | summary headings/bullets/todos, then transcript paragraphs |

`unsupported` is a button (`Block type button is not supported via the API`). Readable AI notes text **is** available via the `transcription` tree. Notion-Version `2022-06-28` and `2025-09-03` returned the same shape.

## Tests

| Suite | Result |
|---|---|
| `pnpm test` (api 726 + web 176) | PASS |
| `playwright e2e/meeting-ai-notes.spec.ts` | PASS (1) |
| `pnpm --filter @ak-system/web build` | PASS (Next skips type validation in this project) |
| `pnpm -r run lint` | SKIP — `next lint` interactive (pre-existing, no ESLint config) |

## Notes

- Empty-body re-fetch is gated on `body_synced_at` vs page `last_edited_time` so failed/empty API pulls do not hammer Notion every cron.
- On-demand `notionUrl` fetch only runs when local `body_text` is missing.
