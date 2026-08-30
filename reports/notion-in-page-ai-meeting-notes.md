# Code Review: Notion in-page AI Meeting Notes

> **Slug:** `notion-in-page-ai-meeting-notes`
> **Verdict:** APPROVED WITH NITS
> **Date:** 2026-08-30

## Spec Conformance

In-page AI Meeting Notes are ingested from the Meetings DB page (`transcription` block + nested children), stored on `meeting_notes` with `sourceKind: meeting_page`, linked to the local meeting’s people/project, and exposed through `insights.meetingNotes`, `get_notion_meeting_notes`, meeting/person/project UI, Settings copy, and ABC agent cards. Matches the spec.

## Static Checks

| Check | Result |
|---|---|
| `pnpm test` | PASS (726 api + 176 web) |
| `e2e/meeting-ai-notes.spec.ts` | PASS |
| `pnpm --filter @ak-system/web build` | PASS |
| `pnpm -r run lint` | SKIP — pre-existing `next lint` interactive prompt |

## Findings

### Must-fix

- None.

### Should-fix

- None blocking. After deploy, `/meetings` has **סנכרן סיכומי Notion** (`scope: meetings`, 7 days). Agents auto-refresh 3-day meeting notes when local bodies are empty. Do not send users to Projects for meeting notes.

### Nits

- `apps/web` still has no ESLint config (`next lint` interactive). Pre-existing.
- Next.js build still skips TypeScript validation. Pre-existing.
- Person drawer uses a one-letter `AI` badge; meeting page copy is clearer (`מדף הפגישה ב-Notion`).

## Out of Scope Creep

None. Separate `meeting_notes` databases still sync. No audio/RAG. Notion-Version bump is isolated to the notes block fetch with fallback.

## Security

No secrets logged. Probe used the local integration token in-process and reported block types only. `protectedProcedure` on insights/sync unchanged.

## UI Review

**Verdict:** APPROVED

### Checklist

- [x] Uses `.btn` / `.input` / `.card` utilities (not raw unstyled elements)
- [x] Dark theme colors match palette
- [x] RTL layout preserved
- [x] Mobile layout works (existing meeting/person/project shells)
- [x] Focus-visible states present on interactive elements (existing links)
- [x] Loading / error / empty states handled (block hidden when no notes)
- [x] No new CSS frameworks introduced
- [x] Reuses existing components where possible

### Findings

- Reused the existing סיכומי Notion `.card` on `meetings/[id]`; heading is now סיכום AI (Notion).
- Settings Notion card documents that AI notes come from the meeting page when a `meetings` DB is connected.

## Verdict

APPROVED WITH NITS — ship after the next Notion graph sync so live meetings pick up `transcription` bodies.
