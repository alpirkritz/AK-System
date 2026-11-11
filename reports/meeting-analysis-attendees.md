# meeting-analysis-attendees

## UI/UX Review

**Verdict:** APPROVED WITH NITS
**Detected stack:** next-trpc-monorepo

### Design System Checklist
- [x] Matches project tokens/classes (`.btn`, `.btn-primary`, `.btn-ghost`, `.input`, `.card`)
- [x] RTL layout preserved (`dir="rtl"` on the app shell; rows use normal flex)
- [x] Mobile layout works (actions wrap; targets are at least 44px tall)
- [x] No unapproved UI frameworks introduced
- [x] Reuses the attendees card and the analysis section instead of a new page

### UX Quality Checklist
- [x] Clear visual hierarchy — add is the primary action; remove is secondary and confirmed when the person is already on the meeting
- [x] Cognitive load minimized — one row per suggested name, with the next step on the row
- [x] Feedback states: pending disables actions; success line (`נוסף לפגישה` / `נוסף לפגישה ולאנשי הקשר`); Hebrew error from the server
- [x] Removal confirms: `להסיר את {name} מהפגישה? איש הקשר יישאר באנשים.`
- [x] Microcopy is verb-first Hebrew: `הוסף לפגישה`, `צור והוסף`, `הסר`, `ביטול`
- [x] Touch targets ≥ 44px; buttons are real `<button>` elements with `aria-label` where the visible label is short

### Findings
- Must-fix: none
- Nits:
  - `+ הוסף אדם` appears both on the attendees card and under the analysis suggestions (`MeetingAttendees.tsx`, `ConversationAnalysis.tsx`). Same action, two nearby places, so a missed name can be added without leaving the analysis. Acceptable; do not add a third entry point.
  - Dismissing a suggestion that was never added does not ask for confirmation. That is intentional: nothing was saved yet. Removal from the meeting always confirms.

### Interaction
Suggested names are rows under `משתתפים מומלצים`, full width under the analysis summary.

- No matching contact: `צור והוסף` creates a confirmed person and links them to this meeting.
- One matching contact: `הוסף לפגישה` reuses that person. `קשר לאחר` picks someone else.
- Several people with the same name: `בחר איש קשר`.
- Already on the meeting: label `בפגישה`, and `הסר` takes them off the meeting and off the suggestion list. The contact stays in אנשים.
- The attendees card is the event list: add by search or new name, remove with the same confirm copy.
