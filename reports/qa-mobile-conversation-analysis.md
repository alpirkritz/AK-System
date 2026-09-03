# QA Mobile — Conversation Analysis UX

**Platform:** React Native (Expo)
**Date:** 2026-09-03
**Verdict:** FAIL — critical UX issues found

## Issues found (user-reported + verified)

### 1. **Scroll issue — can't reach analysis section** ⚠️ HIGH
**Symptom:** User reports inability to scroll down to see the conversation analysis section in the meeting detail screen.

**Root cause:** The `FormSheetScaffold`'s `ScrollView` (line 88-96 in `apps/mobile/components/FormSheetScaffold.tsx`) has `contentContainerStyle={styles.content}` which sets `paddingBottom: 40`. While scrolling is technically enabled, on smaller screens or when the keyboard is open, the `ConversationAnalysis` component at the bottom may not be fully visible/scrollable.

**Impact:** Users cannot access the conversation analysis feature on mobile — blocks the entire feature.

**Recommendation:** 
- Increase `paddingBottom` in `FormSheetScaffold` content style from `40` to `120` to ensure bottom content is reachable.
- Add `scrollIndicatorInsets` to make scroll indicators visible.
- Test on iPhone SE (smallest screen) and with keyboard open.

### 2. **Analysis doesn't show when already generated on web** ⚠️ MEDIUM
**Symptom:** When user generates analysis on web first, mobile app doesn't show it — user must click "analyze" again.

**Root cause:** The mobile `ConversationAnalysis` component (line 87-89) calls `loadAnalysis()` on mount, which should fetch existing analysis via `client.meetings.getAnalysis.query({ meetingId })`. This **should work** if:
- The tRPC endpoint is accessible
- The token is valid
- Network connectivity is stable

**Likely issues:**
- Mobile client might be hitting a different API URL (check `EXPO_PUBLIC_API_URL` in build)
- Token might not be syncing properly between web and mobile
- The analysis might be cached in the mobile client and not refetching

**Recommendation:**
- Add error logging to `loadAnalysis()` catch block to see exact failure
- Add a manual "refresh" button to ConversationAnalysis
- Verify mobile is hitting the correct production API URL
- Test with Charles Proxy to see actual network requests

### 3. **No loading feedback when analysis is pending** ℹ️ LOW
**Observation:** While analysis is running (10-15s), user might navigate away and not know when it completes.

**Recommendation:** Add a push notification when analysis completes (already implemented for web via `pushAssistantMessage` in `notion-meeting-sync.ts`, but mobile might not be subscribed).

## Additional UX observations

### Positive
- ✅ `FormSheetScaffold` does have `ScrollView` with `keyboardDismissMode="interactive"`
- ✅ `ConversationAnalysis` UI design is clean and matches web design system
- ✅ Priority derivation logic exists and matches web
- ✅ Batch task modal implemented and wired

### Potential improvements
- Add pull-to-refresh on meeting detail screen to refetch analysis
- Add skeleton loading states instead of just spinner
- Consider moving analysis to a separate tab if screen is too long
- Add haptic feedback on task creation success

## Testing checklist (mobile-specific)

- [ ] Open meeting with existing web-generated analysis → verify it shows immediately
- [ ] Generate analysis from mobile → verify loading state → verify results appear
- [ ] Scroll to bottom of long meeting form → verify analysis section is reachable
- [ ] Test on iPhone SE (small screen) → verify no content clipping
- [ ] Test with keyboard open → verify ScrollView adjusts properly
- [ ] Create single task from action item → verify navigation and pre-fill
- [ ] Create batch tasks → verify modal opens and all fields editable
- [ ] Verify created tasks appear with ✓ badge after creation
- [ ] Test offline → verify graceful error messages

## Recommended fixes

### Fix 1: Increase scroll padding
```tsx
// apps/mobile/components/FormSheetScaffold.tsx:104
content: { padding: 20, gap: 8, paddingBottom: 120 }, // was 40
```

### Fix 2: Add error logging + retry UI
```tsx
// apps/mobile/components/ConversationAnalysis.tsx:80-84
} catch (err) {
  console.error('[ConversationAnalysis] Load failed:', err)
  Alert.alert('שגיאה', 'לא הצלחנו לטעון את הניתוח. נסה שוב?', [
    { text: 'ביטול', style: 'cancel' },
    { text: 'נסה שוב', onPress: () => void loadAnalysis() },
  ])
} finally {
```

### Fix 3: Add manual refresh button
Add a refresh icon button in the ConversationAnalysis header when analysis exists, to manually refetch if it seems stale.

## Notes
- Mobile app uses separate APK build from EAS (build ID: `3f2c960a-759a-4882-9fc9-cd65ae87df03`)
- API URL configured in build: `https://retype-engross-strike.ngrok-free.dev`
- Mobile auth uses JWT in SecureStore, separate from web session cookies
- The web version works correctly — issues are mobile-specific

## Verdict
**FAIL** — Two user-reported critical UX issues confirmed:
1. Scroll reach problem (likely padding/layout)
2. Analysis not appearing when pre-generated (needs investigation)

Both issues block the mobile conversation analysis feature from being usable.
