# Review — person-context-hierarchy

**Date:** 2026-09-24
**Spec:** `docs/specs/person-context-hierarchy.md`
**QA:** `reports/qa-person-context-hierarchy.md`
**Verdict:** APPROVED WITH NITS

## What shipped

1. **Participants are read from the calendar, not typed.** `packages/api/src/lib/calendar-participants.ts` reads Google attendees, or the Dragontail description block `משתתפים: Name <email>, …` when the Outlook bridge writes `attendees: []`. It drops the owner (connected account emails and `NOTION_USER_NAME`), bots and rooms. `meetings.syncFromCalendar` stores the result per occurrence in `meetings.calendar_participants`.
2. **Recurring meetings without a recurring id become a series.** Dragontail events repeat as separate events. Sync now groups events with the same normalized title on the same calendar, when there are two or more with participants, under `meeting_series.title_key`.
3. **Circles.** A series roster (`series_roster`) is saved once with "שמור חוג מהיומן". Later calendar changes show as "N חדשים ביומן · N כבר לא מוזמנים", with the actions "עדכן מהיומן" and "השאר כך". Per-occurrence exceptions (`meeting_roster_exceptions`) cover "חסר היום" and "אורח היום". "עקוב" promotes one roster row to a confirmed CRM person. Once a series has a saved roster, calendar sync stops creating unconfirmed people for its attendees, so large recurring meetings no longer flood the review queue. New `circles` router.
4. **Person card.** `insights.personContext` now returns, in the spec order: recommendation → open loops assigned to the person → WhatsApp since the last Notion meeting → Notion meetings → older WhatsApp → circles, plus warmth. WhatsApp senders match by phone on `@s.whatsapp.net` JIDs, or through a manual link (`whatsapp_person_links`, needed for LID JIDs).
5. **Warmth.** Sentiment per analysed meeting in [-1, 1] (70% score, 30% mood/subtext wording). People: last 90 days vs 91–180, at least 4 analysed interactions. Series: last 8 vs previous 8, at least 6 analysed instances. A shift of 0.2 or more counts as warming or cooling.
6. **Duplicates.** `people.findDuplicates` / `compareDuplicates` / `markNotDuplicate` feed the `/people/duplicates` page, with a "N כפילויות חשודות" chip on `/people`. `people.merge` now also moves roster rows and WhatsApp links, and fills fields that were empty on the kept person (email, phone, company…).
7. **Meeting prep.** `insights.meetingPrepContext` feeds the pre-meeting cron. For a rostered circle, the brief shows "חוג X · N משתתפים" plus the circle recommendation, loops, absences and guests instead of listing every participant. For other meetings it adds one line per followed person, including the cooling warning. Raw WhatsApp text is never included.
8. **Mobile (ARO).** The person screen shows a compact context card (recommendation, warmth, loops, WhatsApp count, circles).

## Production (EC2)

EC2 runs SQLite at `/data/ak_system.sqlite`. The new tables and columns are in `PERSON_CONTEXT_TABLES` in `packages/database/src/index.ts` and are applied on the first `getDb()` after `pnpm deploy:ec2`. All changes are additive. **Back up the SQLite file on the `web-data` volume before deploying.** After deploy, run a calendar sync so existing meetings get their participant snapshot and title-based series.

## Deviations from the spec

| Spec | Shipped | Why |
|---|---|---|
| `interaction_sentiments` table + nightly `warmth-trends` cron + stored `warmthTrend` columns | Warmth computed when read from `meeting_analyses` (`services/warmth.ts`) | Same numbers without a new table or cron. Only meetings carry sentiment today, since WhatsApp and email capture are later specs. The cron can be added when those sources arrive. |
| Duplicate detection cron + notification | Count chip on `/people`, plus nightly `/api/cron/people-duplicates` that sends one notification per newly found pair (announced pairs stored in `user_settings.duplicates_notified_pairs`) | Matches the spec. |
| LLM-phrased Hebrew recommendation | Deterministic Hebrew templates in the card; the meeting-prep agent already phrases them in its own words | A model call on every drawer open adds cost and delay for little gain. Kept as a follow-up. |
| Sentiment timeline in a modal | Expands inline under the badge | Fewer layers in a drawer that is already a panel. |
| Separate `/meetings/series/[id]` page | Circle card on each occurrence's meeting page | You land on the occurrence from the calendar, and exceptions are per occurrence. |
| Morning-brief flag for cooling people | Each meeting line in the morning brief gets `(↓ names)` or `(↓ הפגישה מתקררת)` via `insights.coolingForDate` | Matches the spec. |

## Follow-up pass (step 1 gaps)

- Morning brief cooling flags, `insights.coolingForDate`.
- Rejecting a phone-matched WhatsApp sender ("זה לא הוא") stores a `blocked` link so the phone match stops; the sender returns to the picker.
- Circle card on mobile meeting screen (`apps/mobile/components/CircleSection.tsx`): count, warmth, recommendation, calendar diff, follow, absent.
- Circle × buttons visible on touch devices.
- Nightly duplicates cron + notification. **EC2 crontab must be reinstalled** (`scripts/install-server-cron-remote.sh`) to pick up the `people-duplicates` line.
- Verified: API 860/860, web lib tests pass, `pnpm -r run lint` clean, web build passes.

## UI/UX review

**Verdict:** APPROVED WITH NITS

- RTL: logical properties (`borderInlineStart`, `text-start`), and Hebrew copy throughout. Mobile uses `row-reverse` and `writingDirection: 'rtl'`.
- Design system: `.card`, `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-ghost`, `.input`, `.pill`, `.filter-chip`, and the existing dark palette. The recommendation reuses the gold accent bar.
- Proportion: a 20-person circle is a count ("12 בחוג", "11 צפויים היום"). The roster previews 8 rows and expands on request.
- Destructive actions: a merge takes two steps (pick the card to keep, then "מזג" with a sentence explaining what moves). Removing someone from a circle only retires the row, and the calendar diff can bring them back.
- Empty states: an unsaved circle explains what saving does, and the button is disabled when the calendar has no participants. Duplicates has an explicit "none" state.
- Nit: the remove-from-circle × appears on hover and focus only, which makes it hard to find on touch devices. The mobile app has no roster editing yet, so this is web-only for now.
- Nit: the warmth badge colors are inline hex values, not tokens, which matches existing drawer code.

## Code review notes

- tRPC client only. No inline `fetch`.
- Schema is mirrored in `schema.ts` and `schema.pg.ts`, types are exported from `index.ts`, and `resetDb` clears the new tables.
- Nit: `people.findDuplicates` compares every pair (O(n²)). That's fine for hundreds of contacts; add blocking by email/phone/name prefix if contacts reach many thousands.
- Nit: unlinking a phone-matched WhatsApp sender has no effect, because phone matching is automatic. The UI only offers × on manual links, which is correct, but there is no way to suppress a wrong phone match.
- Nit: in sync, update paths still overwrite `seriesId` with the calendar-derived value, same as before. A manually assigned series on a calendar meeting is replaced on the next sync.
