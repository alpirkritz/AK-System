# Identify unknown speakers with a voice sample

## Goal

כשהמערכת מתמללת הקלטה היא מסמנת דוברים כ"דובר 1", "דובר 2" ולא יודעת מי הם. המטרה: שהמערכת תשאל אותי מי הדובר, ותשמיע לי דגימה מהקלטה עצמה כדי שאוכל לזהות — ושהזיהוי יישמר ויקשר את ההקלטה לאדם הנכון.

## Current behaviour (אומת בקוד) — ומה חסר

| מה יש | איפה | מה חסר |
|---|---|---|
| תמלול טקסט חופשי עם תוויות `דובר 1` / `דובר 2` | `packages/api/src/services/voice.ts:197-201` — `TRANSCRIBE_PROMPT` | **אין חותמות זמן בכלל**. בלי זמנים אין מאיפה לחתוך דגימה |
| זיהוי קול עצמי בלבד (Alpir), VAD + דמיון קוסינוס | `voice-diarization.ts:106-168` | מזהה דובר אחד מתוך voiceprint יחיד. לא כותב תוויות ולא מטפל בשאר הדוברים |
| קישור משתתפים ברמת ההקלטה | `voice_recording_people`, `voice.attachToPeople` | אין קישור בין **תווית דובר** לאדם |
| אודיו שלם על דיסק + הזרמה | `voice_recordings.audio_path`, `GET /api/voice/[id]/audio` | אין חיתוך ואין Range — רק הקובץ המלא |

כלומר התשתית לדגימת קול לא קיימת: אין זמנים, אין טבלת מקטעים, ואין מיפוי תווית→אדם. ה-spec הזה בונה את שלושתם.

## Approach decision

**הדגימה מתנגנת מתוך הקובץ המלא בצד הלקוח**, בקפיצה ל-`startMs` ועצירה ב-`endMs`. זה נבחר במקום חיתוך בשרת כדי לא להוסיף תלות ב-ffmpeg לנתיב הזה ולא לייצר קבצים נגזרים. ה-endpoint הקיים מספיק.

## User stories

1. כשהקלטה מסתיימת ויש בה דובר שלא זוהה, אני מקבל התראה שמבקשת ממני לזהות אותו.
2. בעמוד ההקלטה אני רואה כל דובר לא מזוהה, שומע דגימה שלו, ובוחר מי זה.
3. אחרי שזיהיתי, ההקלטה מקושרת לאותו אדם.
4. דובר שהמערכת כבר זיהתה לבד (הקול שלי) לא נשאל שוב.
5. אני יכול לדלג על דובר שאני לא מזהה, והוא לא ימשיך להטריד אותי.

## Acceptance criteria

- [ ] התמלול מחזיר מקטעים עם תווית דובר, זמן התחלה וזמן סיום, והם נשמרים.
- [ ] התמלול הטקסטואלי הקיים (`transcript_text`) נשמר ללא שינוי פורמט — אין רגרסיה בכל מה שקורא אותו.
- [ ] כשהמודל לא מחזיר זמנים, ההקלטה מסתיימת בהצלחה בלי מקטעים, ולא נשאלת שאלה.
- [ ] לכל דובר לא מזוהה מוצגת דגימה מתנגנת מתוך ההקלטה, מהמקטע הארוך ביותר שלו.
- [ ] בחירת אדם לדובר נשמרת, ומקשרת את ההקלטה לאותו אדם ב-`voice_recording_people`.
- [ ] דובר שזוהה אוטומטית כ"אני" מסומן כמזוהה ולא נשאל.
- [ ] דילוג על דובר נשמר, והוא לא נשאל שוב על אותה הקלטה.
- [ ] התראה נשלחת פעם אחת בלבד לכל הקלטה שיש בה דוברים לא מזוהים.

## Data model changes

ב-`schema.pg.ts` (מקור אמת), מראה ב-`schema.ts`, bootstrap ב-`database/src/index.ts`:

```
voice_transcript_segments
  id             text primary key
  recording_id   text not null
  speaker_label  text not null      -- 'דובר 1' כפי שהמודל החזיר
  start_ms       integer not null
  end_ms         integer not null
  text           text not null
  created_at     text not null
  index (recording_id)

voice_speaker_identities
  id             text primary key
  recording_id   text not null
  speaker_label  text not null
  person_id      text               -- null כשדילגתי
  state          text not null      -- 'identified' | 'skipped' | 'auto'
  created_at     text not null
  unique (recording_id, speaker_label)
```

`state` מבדיל בין "זיהיתי", "דילגתי" ו"המערכת זיהתה לבד", וזה מה שמונע לשאול פעמיים. `unique` מבטיח שתשובה אחת לכל דובר בכל הקלטה.

בנוסף ל-`voice_recordings`: `speakerPromptSentAt text` — כדי שההתראה תישלח פעם אחת.

## tRPC API

```ts
voice.speakers: protectedProcedure
  .input(z.object({ recordingId: z.string().min(1) }))
  .query() // → Array<{ speakerLabel, state, personId, sampleStartMs, sampleEndMs, sampleText, segmentCount }>

voice.identifySpeaker: protectedProcedure
  .input(z.object({
    recordingId: z.string().min(1),
    speakerLabel: z.string().min(1),
    personId: z.string().min(1).nullable(), // null = דילוג
  }))
  .mutation() // → { state: 'identified' | 'skipped' }
```

`voice.speakers` מחזיר את המקטע הארוך ביותר לכל דובר כדגימה — זו הבחירה שמחזירה את הסיכוי הטוב ביותר לזהות קול. `identifySpeaker` עם `personId` גם מוסיף קישור ל-`voice_recording_people` אם אינו קיים.

## UI surface

`apps/web/src/app/voice/page.tsx` — מקטע "מי מדבר?" בתוצאת ההקלטה, מוצג רק כשיש דוברים לא מזוהים. לכל דובר: שם התווית, כפתור `.btn-ghost` להשמעת הדגימה (קופץ ל-`sampleStartMs` ועוצר ב-`sampleEndMs` על `<audio>` מוסתר), ציטוט הטקסט של המקטע, `PeoplePicker` קיים לבחירת אדם, וכפתור "לא מזהה" לדילוג. נעשה שימוש ב-`.card`, `.label`, `.btn`, `.btn-ghost`, `.pill` הקיימים ובצ׳יפ `voice-person-chip` שכבר קיים בעמוד.

ההתראה: `createNotification` עם קישור לעמוד ההקלטה, מסוג קיים, פעם אחת לכל הקלטה.

## Out of scope

- זיהוי אוטומטי של דוברים שאינם "אני" (voiceprints לאנשים נוספים) — ה-spec הזה מבקש מהמשתמש לזהות, לא מנסה לנחש.
- חיתוך אודיו בשרת ותמיכת Range.
- זיהוי דוברים באפליקציה — הווב קודם.
- כתיבת התוויות המזוהות חזרה לתוך `transcript_text`.
- שימוש בזיהוי של הקלטה אחת כדי לזהות את אותו קול בהקלטה אחרת.

## Open questions

אין. ההחלטה על אופן ההשמעה והחלטת "המקטע הארוך ביותר כדגימה" מתועדות למעלה.
