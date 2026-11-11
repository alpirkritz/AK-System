# dashboard-shift-and-meeting-people

## UI/UX Review

**Verdict:** APPROVED
**Detected stack:** next-trpc-monorepo
**Mode:** pre-implementation, against `docs/specs/dashboard-shift-and-meeting-people.md`

### Design System Checklist
- [x] Matches project tokens/classes (per stack above) — `.card` link on the dashboard; `.input` / chip colors already used in `MeetingModal`; no new framework
- [x] RTL layout preserved — combobox and chips stay in the existing RTL dialog
- [x] Mobile layout works — ARO home uses the same omission rule; the web picker targets are 44px and the result list scrolls inside the dialog
- [x] No unapproved UI frameworks introduced
- [x] Reuses existing components where possible — `AttentionBanner` stays; picker follows the combobox already in `PersonSelect` and the in-flow list in `AddPersonControl`

### UX Quality Checklist
- [x] Clear visual hierarchy — one primary action in the dialog remains "שמור"; the dashboard card is absent unless a relationship actually moved
- [x] Cognitive load minimized — directory is not painted; empty query offers at most six recent people (recognition) instead of the full book
- [x] All feedback states handled (loading / empty / error / success) — attention slot stays empty until data, and a failed phone fetch does not take down the home screen; people field has "עדיין אין משתתפים", "הקלידו לפחות אות אחת", "אין אנשי קשר תואמים", and "{name} כבר בפגישה"
- [x] Destructive actions require confirmation — removing a chip only drops the selection, so no confirm; the person record is untouched
- [x] Microcopy: clear Hebrew, verb-first buttons, human errors — "קשר שזז", "הסר את {name}", "חפש לפי שם, חברה או תפקיד"; verbs stay "מתקרר" / "מתחמם" to match the relationships pills
- [x] Touch targets ≥ 44px; focus-visible; keyboard navigable — combobox keys specified; list is in flow so modal overflow does not clip it

### Findings
- Must-fix: none. The current banner fails aesthetic-and-minimalist design: `AttentionBanner` sorts every board card and treats a non-cooling trend as "מתחמם", so a stable name occupies the first slot forever. The spec limits the slot to `warming` and `cooling` and adds `dataReason`, which is the missing "why".
- Nits: none.

### Checklist Before Handoff
- [x] Every finding references file, line, or component — `apps/web/src/components/relationship/AttentionBanner.tsx`, `apps/mobile/app/(tabs)/index.tsx` `topShift`, `apps/web/src/components/Modals/MeetingModal.tsx` participants block
- [x] UX issues cite violated principle — Nielsen heuristic 8 (every element earns its place); Apple deference (chrome must not compete with the day)
- [x] Microcopy suggestions include exact Hebrew replacement text — captured in the spec acceptance criteria
- [x] Verdict is APPROVED, APPROVED WITH NITS, or CHANGES REQUESTED

## UI/UX Review — post-implementation

**Verdict:** APPROVED
**Detected stack:** next-trpc-monorepo

Walked `AttentionBanner.tsx`, `MeetingPeoplePicker.tsx`, `MeetingModal.tsx`, and the ARO home card. The banner is absent until `pickAttentionShift` returns a warming or cooling card, then shows «קשר שזז», the verb, «ועוד {n}» for other movers only, and `dataReason` clamped to two lines. The meeting field shows selected chips with «הסר את {name}», an in-flow list, and «שמור» remains the only primary button. Playwright confirmed the empty dashboard hides the card, and that adding a participant searches instead of listing the directory.

### Findings
- Must-fix: none.
- Nits: none.

