# Review — whatsapp-history-ingestion

**Verdict: APPROVED WITH NITS**

Spec: `docs/specs/whatsapp-history-ingestion.md`

## Changes

| קובץ | שינוי |
|---|---|
| `apps/whatsapp-bridge/src/message-fields.ts` | חדש — `extractText`, `messageTimestampMs`, `senderNameFor` משותפים לשני המסלולים |
| `apps/whatsapp-bridge/src/history-sync.ts` | חדש — `HISTORY_WINDOW_MS` (3 יום), יומן מזהים לדה-דופליקציה, `ingestHistoryMessages` עם מוני written/duplicate/out-of-window/ignored |
| `apps/whatsapp-bridge/src/whatsapp-client.ts` | מאזין `messaging-history.set` שמכניס לתורי ההתמדה; הודעות חיות נרשמות ביומן המזהים |
| `apps/whatsapp-bridge/src/dm-capture.ts`, `group-buffer.ts` | דגל `historySync` אופציונלי על ההודעה בתור |
| `apps/web/src/app/api/whatsapp/messages/ingest/route.ts`, `dm/ingest/route.ts` | מקבלים ומתעדים `historySync` |
| `history-sync.test.ts`, `whatsapp-client.history.test.ts` (חדשים) | חלון, דה-דופליקציה, רשימות לכידה, ואימות שאין `fetch`, אין `sendMessage` ואין נגיעה ב-buffer של ה-FOMO |

## Review notes

- **הקריטריון החשוב ביותר מתקיים במבנה, לא רק בבדיקה.** ההיסטוריה נכנסת ל-`enqueuePersistMessage` ול-`enqueueDmMessage` בלבד (`whatsapp-client.ts:477-486`), ולא ל-`bufferGroupMessage` ולא ל-`onGroupMessage` — שני אלה הם הנתיבים לתשובות ולהתראות. אין דרך שהיסטוריה תפעיל תשובה.
- **הדגל על ההודעה ולא על הקריאה — שינוי נכון מה-spec.** ה-spec תיאר דגל ברמת ה-webhook; בפועל היסטוריה והודעות חיות חולקות תור ונשטפות באותה אצווה, ולכן אצווה יכולה בלגיטימיות לערב את השניים. התיקון נכון וההחלטה דווחה במקום להיקבר.
- **שני מאזינים על אותו אירוע** (`messaging-history.set` בשורה 97 לאנשי קשר, ובשורה 477 להודעות) — תקין ב-EventEmitter ומפריד תחומים בבירור.
- **מצאתי ותוקן באג שנוצר ברפקטור עצמו:** שורת הלוג `'Buffered group message'` הפנתה למשתנה `senderName` שחילוץ ההלפרים הסיר, מה שהיה מפיל `ReferenceError` בכל הודעת קבוצה מנוטרת. עכשיו `groupMessage.senderName` (שורה 408). הבדיקה החדשה היא שתפסה אותו — בלי בדיקת החיווט זה היה מגיע לפרודקשן ומשתיק את קליטת הקבוצות לגמרי.

## Nits

1. ~~האינדקס הייחודי על `wa_message_id` לא נוסף.~~ **נסגר בסקירה: האינדקסים כבר היו קיימים.** `uq_whatsapp_messages_group_msg` על `(group_jid, wa_message_id)` ו-`uq_whatsapp_dm_messages_msg` על `(wa_message_id, whatsapp_jid)` מוגדרים ב-`schema.pg.ts:878,1162`, ממורארים ב-`schema.ts:1029,1337`, קיימים ב-bootstrap (`database/src/index.ts:174,969`), ואומתו בפרודקשן דרך `pragma_index_list` על שתי הטבלאות. הקריטניון של ה-spec התקיים כל הזמן; ה-spec ביקש "לוודא שקיים", וזו הייתה התשובה.
2. חלון של 3 יום הוא החלטת המשתמש ומכוסה בבדיקה, אבל כדאי לזכור שניתוק ארוך מ-3 יום עדיין ייצור חור. זה מודע ומתועד ב-Out of scope.

## Verification

- 34 בדיקות בחבילת הגשר עוברות, כולל בדיקת החיווט שמאמתת היעדר תשובות והתראות.
- `pnpm -r run lint` — exit 0.
- `pnpm test` במאגר כולו הורץ בזמן שסוכן אחר ערך את `packages/api` במקביל והניב 5 כשלים ב-`harness-context.test.ts` ו-`people.duplicates.test.ts`. אלה אינם נובעים מהשינוי הזה: בדיקות ה-API חולקות קובץ SQLite מוזרע אחד תחת `fileParallelism: false`, ושתי ריצות vitest במקביל מתנגשות עליו. יאומת מחדש בריצה נקייה.
- טרם אומת בפרודקשן.
