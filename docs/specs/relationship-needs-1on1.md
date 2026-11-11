# Relationship: who needs a 1:1

Supersedes the person part of `relationships-attention.md` (the 90/90 cooling/warming split). Circles, the owner's note and the page itself stay.

## Goal

One signal per person: **is this person in good shape, or do I need to sit with them 1:1 and push them forward?** It reads every way I talk to them, not only analysed meetings. It reacts to new evidence within days, and it goes quiet once I've seen it, until something new happens.

A good group meeting does not mean the person is fine. The thing I act on is a 1:1, so the signal is built around that.

## Why the current signal fails

- It only counts meetings with a scored analysis (a Notion summary). WhatsApp DMs, email, and calendar meetings without a summary are invisible. So "last contact 22.10" for Jordan is wrong while we talk every week.
- Fixed 90-day vs previous-90-day windows. One bad meeting keeps a person "cooling" for up to three months (Nevo).
- Seeing it changes nothing. The same flag shows every day.
- Group meetings and 1:1s weigh the same.

## User stories

- As Alpir, I want one "צריך 1:1" list of people who seem off, ranked by how off, so I know whom to book.
- As Alpir, I want "last contact" to be the real last contact, from any channel, so the list is trustworthy.
- As Alpir, I want to see the evidence on each flag (which meetings, which scores, last 1:1, last message), so I can judge it in two seconds.
- As Alpir, I want to mark a flag "ראיתי" or "קבעתי 1:1", so it disappears until there is new evidence.
- As Alpir, I want a person who already has a 1:1 on the calendar in the next 7 days not to be flagged.

## The signal (one status per person)

Computed on read in `packages/api/src/services/warmth.ts`. No LLM.

**Interactions**, last 180 days, `date <= today`, the owner excluded:

| Source | Kind | Has tone |
| --- | --- | --- |
| `meetings` via `meeting_people`, analysed or not | `one_on_one` when the only non-owner attendee is this person, else `group` | when `meeting_analyses.score` exists |
| `whatsapp_dm_messages` (either direction), one interaction per day | `direct` | no |
| `person_email_threads`, one per thread date | `direct` | no |
| `people.last_contact` (manual) | `direct` | no |

**Tone** is the decayed weighted mean of `analysisSentiment` over analysed meetings, with weight `0.5^(ageDays / 30) × (1 for one_on_one, 0.5 for group)`. **Baseline** is the plain mean over all analysed meetings in the 180 days. With fewer than 3 analysed meetings there is no tone, and only quiet can raise a flag.

**Quiet** is the number of days since the last `one_on_one` or `direct` interaction. Group meetings don't reset it. The **expected gap** is `people.contact_frequency_days` when set; otherwise the median gap between direct/1:1 interactions over 180 days (needs ≥ 3), else 21 days. Minimum 7 days.

**Status:**

- `needs_1on1` when any of these hold:
  - tone ≤ baseline − 0.2, unless the latest 1:1 scored ≥ 8 (a strong 1:1 since the drop answers it; the decayed average would otherwise lag a few weeks)
  - the latest 1:1 score ≤ 5/10
  - quiet > 2 × expected gap
- `good` when tone ≥ baseline + 0.2, or the latest 1:1 score ≥ 8 and quiet ≤ expected gap.
- `steady` otherwise.

Each `needs_1on1` carries `reasons[]` (one or more of `tone_drop`, `low_1on1`, `quiet`) and a `severity` used for ranking: `max(baseline − tone, 0) / 0.2 + max(quiet / expectedGap − 1, 0)`, plus 1 when the reason is `low_1on1`.

**Eligible people:** confirmed and not the owner, with ≥ 4 interactions of any kind in 180 days, or with `contact_frequency_days` set. Everyone else has no status. That keeps the silence rule from flagging every contact.

**Suppression:**

- **A 1:1 already on the calendar.** A future `one_on_one` meeting within 7 days → no flag. The card reads "1:1 קבוע ל-{date}".
- **Acknowledged.** `people.attention_ack_at` is set and no new **meeting** has `date > ack` → no flag. A chat message alone doesn't reopen it, so daily WhatsApp doesn't undo "ראיתי" the next day. After 30 days the ack expires anyway.
- **The morning brief** ignores the "scheduled" suppression for today's meetings. A 1:1 today with someone flagged is the moment to act, so the brief still marks them.

## Acceptance criteria

- Given a person whose last WhatsApp DM was yesterday and whose last analysed meeting was 22.10, when the drawer, the board or the brief shows last contact, then it shows yesterday and names the channel ("וואטסאפ").
- Given a person with tone ≥ 0.2 below their baseline, when `/relationships` loads, then they are under "צריך 1:1" with reason "הטון ירד" and the meetings behind it (date, title, score, 1:1 or group).
- Given good group meetings but no 1:1 or direct contact for more than 2 × the expected gap, when the page loads, then they are under "צריך 1:1" with reason "אין שיחה אישית מאז {date}".
- Given a 1:1 with this person on the calendar in the next 7 days, when the page loads, then they are not flagged, and their card shows "1:1 קבוע ל-{date}".
- Given a flagged person, when I press "ראיתי", then they move to "בטיפול". They come back only after a new meeting that still evaluates to `needs_1on1`, or after 30 days. "החזר לרשימה" undoes it.
- Given a person flagged only for tone, when a new good analysed 1:1 arrives, then within the same day the decayed tone recovers and the flag clears. There is no 90-day lag.
- Given the dashboard and the ARO home, when someone has severity ≥ 2 (equivalent to the old drastic drop) and isn't suppressed, then one card reads "{name} — כדאי לקבוע 1:1" with "ועוד {n}" and links to `/relationships`. Otherwise there is no card. The morning-brief flags and the harness `cooling_with_open_loop` card use the same status.
- Given the people list on web and ARO, when it loads, then a flagged person shows the pill "צריך 1:1". The "מתקרר/מתחמם" pills are gone.

## Data model

Additive, last column on `people`, in both `schema.pg.ts` and `schema.ts`, plus the SQLite `ALTER` at the end of the bootstrap list in `packages/database/src/index.ts`:

- `attentionAckAt` text, nullable — ISO time I acknowledged the flag.

No stored status. Everything else is computed on read.

## tRPC API (`packages/api/src/routers/insights.ts`)

- `relationshipBoard` — person cards change shape to `{ id, name, status: 'needs_1on1' | 'steady' | 'good' | null, reasons, severity, tone, baseline, quietDays, expectedGapDays, lastContact: { date, channel }, last1on1Date, next1on1Date, acknowledgedAt, evidence: { date, title, kind, score }[], note, noteUpdatedAt }`. Circles are unchanged.
- `relationshipFlags` → returns `{ needs1on1: Flag[] }` for the pills and the home card.
- `acknowledgeAttention` (mutation) — `{ personId, ack: boolean }` sets or clears `attentionAckAt`.
- `personContext.lastContactAt` uses the same `lastContact` (all channels) and adds `lastContactChannel`.

The `isDrasticCooling` / `pickAttentionShift` callers (`person-context.ts`, `harness-reasoner.ts`, web + mobile `attention-shift.ts`, `AttentionBanner.tsx`) move to `status === 'needs_1on1' && severity >= 2`.

## UI surface

`/relationships` (web + ARO): the people section becomes one list, "צריך 1:1", ranked by severity. Each card has the reasons as short chips, the evidence list (1:1 vs group visible), "קשר אחרון: {date} · {channel}", "1:1 אחרון: {date}", the owner's note, and buttons `.btn-primary` "קבע 1:1" (opens a Google Calendar new-event link with the person as guest), plus `.btn-ghost` "ראיתי". Below that, a collapsed "במצב טוב / יציב" section. Circles are unchanged.

The person drawer shows the same status line and reasons. RTL, dark theme, existing `.card`/`.btn` classes.

## Tests

Vitest: the status rules (tone drop, low 1:1, quiet, calendar suppression, ack and re-trigger on new evidence, decay recovery), last-contact across channels, eligibility. Update `attention-shift.test.ts`. Playwright: the acknowledge flow on `/relationships`.

## Out of scope

- An LLM reading of WhatsApp or email tone. Those channels count as contact only.
- Slack/Teams. There is no data source yet (see open questions).
- Booking the 1:1 automatically.
- Circles.

## Open questions

1. **Dragontail (cross-org).** Do 1:1s with Jordan reach `meetings` through the Outlook→Google bridge with Jordan linked in `meeting_people`, and do our Teams/Outlook chats exist anywhere in the DB? If not, last contact for work people stays partial until a Teams/Outlook source exists.
2. Are the thresholds right as starting values (180-day window, 30-day half-life, ×2 expected gap, 5/10 for a low 1:1, 30-day ack expiry)?
