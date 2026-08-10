# QA UI report — whatsapp-message-time-queries

**Stack:** next-trpc-monorepo
**Verdict:** PASS

## Automated

- Playwright (`apps/web/e2e/whatsapp-insights.spec.ts`): PASS — 3/3, including the new window-picker test that asserts option order (`6 שעות`, `24 שעות`, `היום`, `אתמול`, `7 ימים`), default value `24h`, and that selecting `היום` / `אתמול` sticks on both selects.
- Both selects are now reachable by accessible name (`getByLabel('טווח זמן לתדריך')`, `getByLabel('טווח זמן לתובנות הקבוצה')`) instead of positional selectors.

## Manual / exploratory

- Interaction: choosing a new per-group window clears the previously rendered insight, so the visible text can never describe a range other than the selected one. The digest keeps its result until "רענן תובנות" is pressed again, matching the existing explicit-refresh model of that card.
- Copy (Hebrew, RTL): `היום` / `אתמול` sit between the rolling options in chronological order, so the list reads from narrow to wide. Result heading now ends with the covered range (`📋 סיכום קבוצה — צוות · היום`), and the per-group caption reads `N הודעות בטווח שנבחר`.
- Accessibility: both selects gained `aria-label`; native `<select>` keeps keyboard operation and focus ring. No new custom widgets, no new focus traps.
- Layout: options are short Hebrew strings inside the existing `flex-wrap` control rows; the widest new option (`אתמול`) is narrower than `30 יום`, so no reflow at mobile width.
- Design system: unchanged `.card`, `.btn`, and the existing dark select styling (`bg-[#111b30]`, `border-[#29395d]`). No new colors, no cards added.
- Empty state: `insights.digest` with `today` now says `אין פעילות חדשה בקבוצות שאתה עוקב אחריהן בטווח הזה (היום).` — the range is named instead of implied.

## Failures

None.

## Evidence

- `apps/web/e2e/whatsapp-insights.spec.ts:20` — window-picker spec
- `apps/web/src/app/settings/whatsapp/page.tsx` — insights tab selects and result captions
- Full-suite context and pre-existing unrelated e2e failures: `reports/qa-whatsapp-message-time-queries.md`
