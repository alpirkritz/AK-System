# Sharp Hugo briefs

## Goal

Rewrite the morning brief and meeting-prep agent output formats so they deliver the bottom line and actionable detail in a single screen, optimized for a manager with many meetings who needs to walk in prepared without reading long reports.

## User stories

- As a manager with a heavy meeting day, I want the morning message to tell me which meetings need a decision and which are updates, so I know where I need a point of view without reading a full agenda for every one.
- As a meeting participant, I want the 15-minute prep to lead with the outcome of the meeting and up to three talk points that each carry the fact and the move, so I walk in ready to get that outcome.
- As a WhatsApp user reading briefs on my phone, I want each section capped at 1–3 lines with grounding intact, so I can scan in 30 seconds and not miss what matters.
- As the system owner, I want grounding rules to stay enforced (no invented attendees, no backlog dump, no pasted calendar invites), so the brief remains trustworthy.
- As a brief reader, I want empty sections omitted and gaps marked with one Hebrew line only when it changes how I prepare, so I am not reading filler or diagnostic markers.

## Acceptance criteria

- [ ] Given the morning brief runs, when today has multiple meetings, then the `שורה תחתונה` names the one meeting that needs me sharpest, and `הפגישות` lists every timed event in one line with its point (decision or update).
- [ ] Given the morning brief runs, when tasks are due before a meeting, then `לעשות לפני` lists at most 3 actions that change a meeting today, verb first, source in parentheses.
- [ ] Given the morning brief runs, when yesterday's important items were missed, then `אתמול` lists at most 2 lines; otherwise the section is omitted.
- [ ] Given the meeting prep runs 15 minutes before a meeting, when notes and tasks exist, then `שורה תחתונה` states the outcome of the meeting in one sentence, and `על מה לדבר` lists at most 3 items ordered by what must be settled.
- [ ] Given a talk point in `על מה לדבר`, when it is grounded in notes or tasks, then the line carries the topic, the grounded fact (number, commitment, blocker, owner), and what to do with it in the room (החלטה / עדכון / שאלה).
- [ ] Given related tasks exist for a meeting, when the prep includes them, then `פתוח` lists at most 2 and only those that belong in the room; otherwise the section is omitted.
- [ ] Given prior meeting notes exist, when the prep runs, then `מאז הפעם הקודמת` lists one or two lines of what was committed to and whether it moved; if no note exists, one line reads `אין סיכום מהפגישה הקודמת`.
- [ ] Given grounding rules, when a datum is missing (no meeting note, no linked person, no related task), then the brief omits the section or writes one short Hebrew marker, never a plausible guess, never the full open-task backlog.
- [ ] Given the brief is delivered to WhatsApp, Telegram, cron, or the web agent panel, when the format is rendered, then no Markdown tables appear, no H2/H3 headers, no participant essays, no pasted calendar-invite fluff.
- [ ] Given the Vitest suite runs, when the new overrides are asserted, then `getMorningBriefOverride` injection is tested, `getMeetingPrepNotionParityOverride` asserts "at most 3" talk topics and the new section names, and backlog/invite-paste bans remain.

## Data model

No schema changes. This is prompt-text only.

## tRPC API

No new procedures. Existing agent tools and context remain unchanged.

## UI surface

No UI changes. The briefs are delivered as chat replies (WhatsApp / Telegram / push / web agent panel) — same rendering path, new text format.

## Out of scope

- A second Hugo pass after specialist runs (adds latency and drift; change the specialist contract instead).
- Changing grounding rules (no invented attendees, no backlog dump, no pasted invites — these stay).
- Modifying the cron schedule or trigger path for morning brief or meeting prep.
- Calendar Optimizer brief format (separate agent, not in scope).
- Changing the tool set or injected context shape.

## Open questions

None.

## Implementation notes

Prompt and instruction text only:

1. `A_Agents/03_morning_briefing.md` and `S_Skills/wf_morning_brief.md` — replace the output template (TL;DR / 🏆 Today's Priorities / 👀 Things I Missed Yesterday) with the new day-map sections (`שורה תחתונה` / `הפגישות` / `לעשות לפני` / `אתמול`) and line caps.

2. `A_Agents/04_meeting_prep_herald.md` and `S_Skills/wf_meeting_prep.md` — replace the output format (👥 / 🚨 / 💭 / 🎯 Next pushes / ❓ Questions / per-line `המלצה — לא מהנתונים`) with the new walk-in card (`שורה תחתונה` / `על מה לדבר` 1–3 / `פתוח` 0–2 / `מאז הפעם הקודמת`). Drop the separate stance section; the bottom line is the stance.

3. `apps/web/src/lib/gemini-agent-engine.ts`:
   - Add `getMorningBriefOverride()` function returning the new day-map instructions (injected for `03_morning_briefing` on every channel).
   - Rewrite `getMeetingPrepNotionParityOverride()` to the new walk-in card format with "at most 3" talk cap, and inject it on **web as well as** WhatsApp/Telegram/cron (currently web skips it).
   - Keep `getMeetingPrepRelatedTasksOverride()` unchanged (no backlog dump rule).

4. `apps/web/src/lib/gemini-agent-engine.calendar-brief.test.ts` — update assertions to match the new section names (`שורה תחתונה`, `על מה לדבר`, `הפגישות`, `לעשות לפני`), the "at most 3" talk cap, morning override injection, and that invite-paste / backlog bans remain.

## Grounding rules that stay

- Every fact comes from a tool result or injected context in this run — never invent.
- `get_notion_tasks` and `get_notion_meeting_notes` are mandatory every meeting-prep run.
- Related tasks only — never dump the full open backlog.
- Never paste, quote, or lightly paraphrase calendar event descriptions / Outlook invite metadata / Teams fluff.
- Missing data → omit the section or write one short Hebrew marker (`אין סיכום מהפגישה הקודמת`), not `לא נמצא בנתונים` on every missing field unless the gap blocks preparation.
- If the notes only support one real topic, write one in `על מה לדבר` — do not pad to three.

## Example outputs

**Morning brief**:

```
☀️ שלישי 22.9
שורה תחתונה: שלוש פגישות שדורשות עמדה. העיקרית: שני ב-10:00, לצאת עם מחיר.

הפגישות
• 09:00 סטנדאפ DT — עדכון, אין החלטה
• 10:00 שני — לסגור מחיר
• 14:00 צוות מוצר — לאשר scope לשבוע
• 16:00 רופא

לעשות לפני
• טיוטת הצעה לשני לפני 10:00 (DT)

אתמול
• לא ענית למייל של דני על החוזה
```

**Meeting prep (15 min before)**:

```
שני · 10:00
שורה תחתונה: לצאת עם מספר. בלי מספר הפגישה נכשלה.

על מה לדבר
1. מחיר החבילה — ביוני סוכם 40k, היא ביקשה 32k. להביא החלטה, לא טווח.
2. תאריך התחלה — משפטי חוסם עד אישור. לשאול אם מחכים או מתחילים בלי.
3. מי סוגר — אין בעלים על הטיוטה מאז הפעם הקודמת.

פתוח
• טיוטת הצעה באיחור (DT) — זו הנקודה להביא לחדר

מאז הפעם הקודמת
• סוכם שאתה בודק מול הכספים. אין עדכון בפתק.
```
