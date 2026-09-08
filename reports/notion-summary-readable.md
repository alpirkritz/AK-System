# Review — notion-summary-readable

> **Date:** 2026-09-08
> **Spec:** `docs/specs/notion-summary-readable.md`
> **Verdict:** APPROVED

## Static checks

- Vitest parser: pass
- Playwright meeting AI notes: 3 passed
- No schema / tRPC / new dependencies

## Spec conformance

- Structured headings + `Label: body` fields rendered as distinct blocks
- Markdown bullets/headings still parsed
- Expand/collapse copy: קרא עוד › / ‹ צמצם
- `סיכום AI (Notion)` and `מדף הפגישה ב-Notion` preserved
- Notion title still opens in a new tab when there is no internal `titleHref`

## UI Review

**Verdict:** APPROVED

### Checklist
- [x] Uses `.card` utilities (not a new framework)
- [x] Dark theme colors match palette (`#eef3fb`, `#97a4c2`, `#2dd4bf`, `#8b5cf6`)
- [x] RTL layout preserved
- [x] Mobile: card stacks in existing one-column grid
- [x] Focus-visible via global `:focus-visible`; expand is a real button with `aria-expanded`
- [x] Empty notes: card is not shown (parent still gates on `meetingNotes.length`)
- [x] No new CSS frameworks
- [x] Reuses notification-style block rendering patterns

### Findings
- Must-fix: none
- Nits: person/project reuse is slightly richer than the old compact one-liners; compact preview is 4 blocks which is acceptable.

## Files

- `apps/web/src/lib/notion-summary-format.ts`
- `apps/web/src/lib/notion-summary-format.test.ts`
- `apps/web/src/app/meetings/components/NotionSummaryCard.tsx`
- `apps/web/src/app/meetings/[id]/page.tsx`
- `apps/web/src/app/projects/[id]/page.tsx`
- `apps/web/src/components/people/PersonDetailDrawer.tsx`
- `apps/web/e2e/meeting-ai-notes.spec.ts`
