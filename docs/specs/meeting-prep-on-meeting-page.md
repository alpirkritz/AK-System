# Meeting prep planted on the meeting page

## Goal

ההכנה לפגישה שהרלד מייצר רבע שעה לפני נעלמת: היא נדחפת כהתראה ונכתבת ל-`chat_messages`, אבל לא נשמרת בשום מקום שקשור לפגישה. כשנכנסים לעמוד הפגישה — בדיוק הרגע שבו צריך את ההקשר — הוא לא שם. המטרה: לשמור את ההכנה כרשומה שמקושרת לפגישה, ולהציג אותה בעמוד שלה.

## Current behaviour (אומת בקוד)

הקרון `apps/web/src/app/api/cron/pre-meeting-briefing/route.ts` רץ על אירועים שמתחילים בעוד 14–16 דקות, בונה הקשר ומעביר לאחד משני מסלולים: האייג׳נט `04_meeting_prep_herald` דרך `runEventAgentIfRouted`, או תבנית `formatPreMeetingBrief` כגיבוי. בשני המסלולים התוצאה היא מחרוזת שנשלחת ל-`pushAssistantMessage`, שכותבת ל-`chat_messages` ול-`notifications` — **אף אחד מהם לא נושא `meetingId`**. בטבלת `meetings` אין עמודה לתוכן מיוצר: יש `notes` ידני ו-`meeting_notes` שמגיע מ-Notion, שניהם אחרי הפגישה.

## User stories

1. כשאני נכנס לעמוד פגישה שהרלד הכין עליה, אני רואה את ההכנה בראש העמוד.
2. ההכנה לא דורסת את ההערות הידניות שלי — היא בלוק נפרד שברור שהוא מיוצר.
3. אני רואה מתי ההכנה נוצרה, כדי לדעת אם היא עדיין רלוונטית.
4. פגישה שלא הוכנה לא מציגה בלוק ריק.

## Acceptance criteria

- [ ] טבלה חדשה `meeting_preps` שומרת את טקסט ההכנה עם `meetingId`, מי ייצר אותה ומתי.
- [ ] שני מסלולי הקרון (אייג׳נט ותבנית) כותבים את ההכנה כשזוהתה פגישת CRM מקושרת.
- [ ] כשאין פגישת CRM מקושרת, ההתנהגות לא משתנה — דחיפה בלבד, בלי כתיבה ובלי שגיאה.
- [ ] ריצה חוזרת על אותה פגישה מעדכנת את ההכנה הקיימת ולא מייצרת כפילות.
- [ ] עמוד הפגישה מציג כרטיס הכנה כשיש אחת, ולא מציג כלום כשאין.
- [ ] הכרטיס מסומן בבירור כתוצר אייג׳נט ומראה חותמת זמן.
- [ ] כתיבת ההכנה לא יכולה להכשיל את הדחיפה — כשל בכתיבה נרשם ביומן וההתראה נשלחת בכל מקרה.

## Data model changes

`packages/database/src/schema.pg.ts` (מקור האמת) ומראה ב-`schema.ts`, בתוספת בלוק bootstrap ב-`packages/database/src/index.ts` ל-SQLite:

```
meeting_preps
  id            text primary key
  meeting_id    text not null        -- FK → meetings.id
  agent_id      text                 -- null כשזו תבנית הגיבוי
  source        text not null        -- 'agent' | 'template'
  body_text     text not null
  created_at    text not null
  updated_at    text not null
  unique (meeting_id)
```

`unique (meeting_id)` נותן upsert טבעי ומונע את הכפילות שהקריטריון דורש. ייצוא הטבלה והטיפוסים מ-`index.ts`.

## tRPC API

```ts
meetings.getPrep: protectedProcedure
  .input(z.object({ meetingId: z.string().min(1) }))
  .query() // → { bodyText, agentId, source, createdAt, updatedAt } | null
```

הכתיבה אינה procedure — היא קורית בתוך הקרון דרך שירות חדש `packages/api/src/services/meeting-preps.ts` עם `saveMeetingPrep` ו-`getMeetingPrep`. אין מוטציה חשופה ללקוח: אין משתמש שכותב הכנה ביד.

## UI surface

`apps/web/src/app/meetings/[id]/page.tsx` — כרטיס `.card` חדש בטור השמאלי, **מעל** `MeetingAttendees`, באותה תבנית של הכרטיסים הקיימים: תווית מקטע `text-xs font-semibold text-[#5a688c] uppercase tracking-wider` ומעליה הגוף ב-`.card`. כותרת "הכנה לפגישה" עם ציון שהיא מאייג׳נט וחותמת זמן. אין רכיב חדש ואין טוקן עיצובי חדש.

## Out of scope

- שינוי מה הרלד כותב או מתי הוא רץ.
- עריכת ההכנה בממשק.
- הצגת ההכנה באפליקציה — הווב קודם.
- קישור רטרואקטיבי של הכנות עבר מתוך `chat_messages`.

## Open questions

אין.
