# Review — identify-unknown-speakers

**Verdict: APPROVED WITH NITS**

Spec: `docs/specs/identify-unknown-speakers.md`

## Changes

| קובץ | שינוי |
|---|---|
| `packages/database/src/schema.pg.ts` + `schema.ts` + `index.ts` | `voiceTranscriptSegments`, `VOICE_SPEAKER_STATES` + `voiceSpeakerIdentities`, `voiceRecordings.speakerPromptSentAt`, bootstrap וייצוא |
| `packages/api/src/services/voice.ts` | `TRANSCRIBE_PROMPT` חדש (JSON עם זמנים), `parseTranscription`, `saveTranscriptSegments`, שמירת מקטעים ו-`notifyUnknownSpeakers` בצינור |
| `packages/api/src/services/voice-diarization.ts` | `matchSelfVoice` מחזיר `matchedRanges`; `resolveSelfSpeakerLabel`, `upsertSpeakerIdentity`, `listRecordingSpeakers`, `identifySpeaker`, `notifyUnknownSpeakers` |
| `packages/api/src/routers/voice.ts` | `voice.speakers` ו-`voice.identifySpeaker` |
| `apps/web/src/app/voice/page.tsx` | `SpeakerPrompt` — "מי מדבר?" עם השמעת דגימה, ציטוט, `PeoplePicker` ו-"לא מזהה" |
| `packages/api/src/services/voice-speakers.test.ts` | חדש — 17 בדיקות (15 מקוריות + 2 שהוספתי) |

## The risk in this change, stated plainly

זה השינוי המסוכן מבין ארבעת הפיצ׳רים, כי הוא מחליף את **חוזה התמלול מול Gemini** עבור כל ההקלטות — לא רק עבור זיהוי דוברים. הפרומפט הישן ביקש טקסט חופשי; החדש דורש מערך JSON. אם המודל לא מציית, הנתיב מתדרדר לטקסט רגיל במקום להיכשל, וזה נכון.

**רגרסיה שמצאתי בסקירה ותיקנתי.** בגרסה שהוגשה, תור שהמודל תייג נכון אבל תיזמן גרוע (למשל `end == start`) נזרק **במלואו**, ואם כל התורים היו כאלה הקוד החזיר `text: raw` — כלומר **בלוק ה-JSON הגולמי נשמר כתמלול**. זה מה שהמשתמש קורא ומה שצעד הניתוח צורך במורד הזרם, ולכן זו לא תקלה קוסמטית.

התיקון מפריד בין שני תפקידים שהיו מעורבבים: זמנים נחוצים **רק** לדגימת הקול, ולכן תור עם דובר וטקסט תקפים תורם את המילים שלו לתמלול גם כשהתיזמון פסול, ורק מקטעים מתוזמנים היטב נשמרים לדגימה (`voice.ts:234-277`). הוספתי שתי בדיקות שמקבעות את זה, ועדכנתי בדיקה קיימת שקיבעה דווקא את ההתנהגות השגויה.

## Review notes

- **המבצע בנה חלק שה-spec הניח שקיים.** ה-spec דרש שדובר שזוהה אוטומטית כ"אני" יישמר כ-`auto`, אבל `runSelfVoiceDetection` ידע לענות רק "האם הקול הזה נכח", לא "איזו תווית הוא". `resolveSelfSpeakerLabel` מצליב את טווחי ההתאמה מול תורי התמלול ובוחר תווית רק כשדיבור מזוהה מכסה לפחות מחצית מזמן הדיבור שלה; אחרת מחזיר null ונשאלים על כולם. כשל בטוח, והפער דווח במקום להיקבר.
- `'unknown'` מוחזר מ-`voice.speakers` לדובר בלי רשומה, אבל לא נשמר בעמודה — ה-enum במסד נשאר `identified|skipped|auto` כמו ב-spec. הפרדה נכונה בין תצוגה לאחסון.
- ההתראה נשלחת בשלב התמלול ולא בסוף העיבוד, כך שהשאלה מגיעה גם אם שלב הניתוח נכשל. שיפור על ה-spec.
- ההשמעה אכן בצד הלקוח בקפיצה לזמן, בלי ffmpeg ובלי קבצים נגזרים, כפי שה-spec קבע.

## Nits

1. **הזמנים הם דיווח עצמי של Gemini, לא יישור כפוי.** הם עלולים לסטות בשנייה-שתיים בהקלטות ארוכות. מקובל לשאלה "של מי הקול הזה", לא מתאים לסנכרון כתוביות. לא נבדק מול אודיו אמיתי — כל הבדיקות מזינות פלט מודל סינתטי.
2. **סיכון פורמט שקט.** אם המודל יתעלם מהוראת ה-JSON, התמלול ימשיך לעבוד אבל זיהוי הדוברים פשוט לא יופיע, בלי שגיאה. שווה לנטר את שיעור ההקלטות שמגיעות עם אפס מקטעים לאחר שתצטבר תנועה אמיתית.

## Verification

- `pnpm test` — 1242 בדיקות ב-API ו-292 בווב, הכל עובר בריצה נקייה אחרי התיקון שלי.
- `pnpm -r run lint` ו-`pnpm --filter @ak-system/web build` — עוברים.
- **פרודקשן על EC2:** `voice_transcript_segments: OK`, `voice_speaker_identities: OK | indexes: uq_voice_speaker_identities_speaker`, `voice_recordings.speaker_prompt_sent_at: OK`.
- אימות מקצה לקצה מול אודיו אמיתי טרם בוצע וייתכן רק בהקלטה אמיתית הבאה.
