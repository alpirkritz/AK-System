# QA UI report — mobile-sheet-scroll

**Stack:** next-trpc-monorepo (Expo/React Native client)
**Verdict:** FAIL (before fix) → PASS (after fix, pending device verification)

## Defect 1 — ScrollView could not scroll, content clipped

**Severity:** blocker

**Symptom.** On `meeting/[id]` the screen renders past the bottom edge of the
display and the user cannot scroll to reach it. Reported across three separate
APK builds.

**Root cause.** `apps/mobile/app/_layout.tsx` defined one shared sheet config:

```
const formSheet = {
  presentation: 'formSheet',
  sheetAllowedDetents: 'fitToContents',
  ...
}
```

`fitToContents` asks the native sheet to size itself to its content. Every one
of the five screens spreading this config (`meeting/[id]`, `task/[id]`,
`person/[id]`, `project/[id]`, `agent/[id]`) puts a `ScrollView` in the sheet
body. The sheet measures the scroll content, grows until it hits the screen
ceiling, and the scroll viewport ends up equal to the content height. With zero
overflow the scroll gesture is inert and everything past the ceiling is clipped.

**Why the earlier attempts failed.** Three prior commits raised
`contentContainerStyle.paddingBottom` (40 → 120 → 300 → 500) and added
`nestedScrollEnabled` / `scrollEventThrottle`. None of these can help: they add
content to a container that is already sized to its content, so the sheet just
tries to grow further and clips at the same place. The 500px value actively made
the dead space worse.

**Fix.** Split the config. Short forms keep `fitToContents`; the five scrollable
screens get a bounded `sheetAllowedDetents: [0.92]`, which caps the sheet height
so the ScrollView has real overflow to scroll. `paddingBottom` reverted to
`32 + insets.bottom` (safe-area aware) rather than a magic constant.

## Defect 2 — text truncation in analysis + action items

**Severity:** major

**Root cause.** Text inside `flexDirection: 'row'` containers had no shrink
behaviour, so the trailing element (button/badge) claimed its natural width and
squeezed the text column.

A prior commit added `flexWrap: 'wrap'` to `Text` styles. That is a **no-op** in
React Native — `flexWrap` governs how a flex *container* wraps its children and
has no effect on text layout. `Text` already wraps by default; it is only
clipped when it cannot shrink inside a row.

**Fix.**
- `title`, `hatBadge` — `flexShrink: 1` so a long hat name ("McKinsey + Tech
  Innovation") shrinks instead of pushing the title out.
- `actionContent` — `minWidth: 0` so the flex child may shrink below its
  intrinsic content width (required for wrapping inside a flex row).
- `createTaskButton`, `createdBadge` — `flexShrink: 0` so the trailing control
  keeps its size and the text column takes the remaining width.
- Removed the no-op `flexWrap` from `Text` styles.

## Defect 3 — cumulative dead space

`ConversationAnalysis` `card` carried `marginBottom: 32` on top of the parent's
`gap: 16`. With six cards that is ~190px of extra scroll length. Removed; the
container gap already handles spacing.

## Performance

`useCallback` wrappers from the prior commit are retained and correct. One
latent bug fixed: the mount effect listed `[meetingId, token]` while calling the
memoised `loadAnalysis`, so the effect and the callback could disagree about
when to refetch. Dependency corrected to `[loadAnalysis]`.

No other performance regressions: the fix removes work (less padding, fewer
layout passes from the oversized container), it does not add any.

## Automated
- `tsc --noEmit` (apps/mobile): PASS — also confirms `sheetAllowedDetents:
  [0.92]` typechecks against react-native-screens 4.25.
- `pnpm -r run lint`: PASS
- Vitest (api + web): 666/666 PASS (unchanged — no shared code touched)

## Device verification still required

The sheet-detent behaviour is native and cannot be exercised by Playwright or
Vitest. On the new APK, confirm on `meeting/[id]`:

- [ ] Scroll indicator appears on the right edge while dragging
- [ ] Content scrolls to the delete button at the very bottom
- [ ] Sheet occupies ~92% of screen height with the grabber visible
- [ ] Long analysis topic wraps to multiple lines, not clipped
- [ ] Action item text wraps beside "צור משימה" without shrinking the button
- [ ] Same checks on `task/[id]`, `person/[id]`, `project/[id]`, `agent/[id]`

## Note on "no data in the app"

Separate from the layout defects. In the latest screenshot the analysis renders
correctly (topic, mood, hat badge all populated), so the mobile client is
reaching the same API as web. The earlier "Transcript not available" message was
a different meeting that genuinely had no transcript — correct behaviour, not a
bug.
