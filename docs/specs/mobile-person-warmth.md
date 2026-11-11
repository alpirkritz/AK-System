# Mobile person insights

## Goal

Show relationship flags on the people list (web and ARO) so a warming or cooling person is visible without opening their card. On the ARO person screen, show the sentiment graph on the −1…+1 scale with the averages that produce the trend.

## User stories

- As Alpir, I want the sentiment graph for a person on the phone, so I can see the relationship moving between +1 and −1 without opening the website.
- As Alpir, I want the recent and older averages and the trend (מתחמם / מתקרר / יציב) next to that graph.
- As Alpir, I want the sections that sit around the graph on the website — recommendation, open loops, commitments to confirm, private-chat summary, WhatsApp since the last meeting, older WhatsApp, Notion meetings, email, recordings, circles — on the same screen.
- As Alpir, I want a meeting row and an open loop to open that meeting, and an email row to open Gmail.

## Acceptance criteria

- Given a person with analysed meetings in the last 180 days, when the person screen loads, then a bar graph plots each meeting's sentiment. Positive bars rise above a zero line, negative bars fall below it. Time runs from older to newer.
- Given the same data, when the card renders, then each point is also a row: date, title, analysis score out of 10 when present, and sentiment as `+0.80`, `-0.40`, or `0.00`. Pressing the row opens `/meeting/[id]`.
- Given both window averages, when the card renders, then it shows ממוצע אחרון (90 days) and ממוצע קודם (days 91–180).
- Given at least 4 analysed meetings, when the recent average is at least 0.2 above the older one, then the label is מתחמם; the reverse is מתקרר; a smaller gap is יציב. Under 4 meetings the graph and rows still show, with a line that there are not enough analysed conversations for a trend.
- Given any person context, when the screen loads, then the recommendation is shown (the server text, or "אין עדיין פגישות מתועדות או הודעות · שווה לתעד את השיחה הבאה").
- Given open loops, commitments, a private-chat summary, WhatsApp snippets, Notion meetings, email threads, recordings, or circles, when the screen loads, then each non-empty group is listed in that order. WhatsApp since the last meeting shows five rows and a control for the rest. Older WhatsApp starts collapsed.
- Given an email with a Gmail URL, when the row is pressed, then Gmail opens. Given a recording with a completed meeting, when the row is pressed, then that meeting opens.
- Given no analysed meetings, when the screen loads, then the graph is absent and the other sections still render.
- Given the website person card, when this ships, then its warmth badge and timeline are unchanged.
- Given confirmed people with a warming or cooling trend, when `/people` or the ARO people screen loads, then a "דגלים" block lists מתקררים and מתחממים with the recent and older averages. Pressing a name opens that person. People under 4 analysed meetings, and stable trends, are absent.
- Given nobody is warming or cooling, when the list loads, then the block says there is no such relationship right now.
- Given at least one warming or cooling person, when the web dashboard or the ARO home screen loads, then the same flags appear under the greeting. Pressing a name opens that person. When there are no flags, the dashboard shows nothing in that spot.

## Data model

No schema change. `insights.personContext` already returns the graph and the surrounding sections.

## tRPC API

No new procedure. `apps/mobile/lib/data.ts` stops dropping fields. It keeps `warmth` (trend, averages, count, timeline), `openLoopsForPerson`, `proposedCommitments`, `latestDmSummary`, `whatsappSinceMeeting`, `olderWhatsapp`, `recentMeetingNotes`, `emailThreads`, `voiceRecordings`, `circles`, `cadence`, `lastContactAt`, `meetingCount`, `sharedProjects`, plus the capture flags the screen already uses.

## UI surface

`apps/mobile/app/person/[id].tsx` and a presentational component next to it. Web is unchanged.

- One "הקשר" card.
- Graph: fixed height, zero line, one bar per meeting, green above zero and yellow below. Axis hints +1, 0, −1.
- Trend chip and the two averages under the graph.
- Sections use the existing card type, RTL, and muted 12px headings.
- The old one-line "↑ מתחמם / ↓ מתקרר" and the WhatsApp count line are removed, because the graph and the snippet list replace them.
- Capture toggle stays on the screen, under the card.

## Out of scope

- Pinning a WhatsApp message.
- Linking a WhatsApp sender or editing the person's phone (separate from this card).
- People-list badges and the circle card on a meeting.
- A server deploy. A new APK is required for the phone.

## Open questions

None.
