# Review — bridge-config-outside-auth-state

**Verdict: APPROVED**

Spec: `docs/specs/bridge-config-outside-auth-state.md`

## Context

ה-spec נכתב אחרי תקרית אמיתית באותו יום: איפוס `/data/auth/*` כדי לאלץ QR חדש מחק גם את שלוש רשימות הלכידה, והקליטה נראתה שבורה גם אחרי קישור מחדש מוצלח. ה-spec הזה מסיר את המלכודת.

## Changes

| קובץ | שינוי |
|---|---|
| `apps/whatsapp-bridge/src/config.ts` | `config.configPath` מ-`BRIDGE_CONFIG_PATH`, ברירת מחדל אחות של `authStatePath` |
| `apps/whatsapp-bridge/src/config-store.ts` | חדש — `configFilePath` ו-`resolveConfigFileForRead` עם מיגרציה חד-פעמית |
| `apps/whatsapp-bridge/src/dm-capture.ts` | `dm-config.json` ו-`dm-lid-map.json` דרך ה-store; רשימה ריקה נרשמת כאזהרה |
| `apps/whatsapp-bridge/src/group-config.ts` | `group-config.json` דרך ה-store; אפס קבוצות פעילות נרשם כאזהרה |
| `apps/whatsapp-bridge/src/index.ts` | מדפיס את נתיב התצורה ומזהיר בעלייה על רשימה ריקה |
| `apps/whatsapp-bridge/src/whatsapp-client.ts` | `/status` מחזיר `dmAllowlist` ו-`watchedGroups` |
| `deploy/docker-compose.production.yml` | ויולום `bridge-config` חדש ב-`/data/config`, `BRIDGE_CONFIG_PATH` ב-`environment` |
| `Dockerfile`, `.env.example`, `deploy/whatsapp-bridge.env.example`, `README.md` | חיווט ותיעוד |
| `config-store.test.ts` (חדש), `config.test.ts` | 12 בדיקות |

## Review notes

- **ההחלטה לא למפות מחדש את `bridge-auth`** נכונה ומתועדת בקומפוז. מיפוי `bridge-auth` ל-`/data` היה מנטרל את האישורים הקיימים ומאלץ קישור מחדש — בדיוק הכאב שהרגע עברנו.
- **ויולום נפרד ולא רק נתיב נפרד.** `BRIDGE_CONFIG_PATH=/data/config` בלי ויולום היה מניח את רשימות הלכידה על השכבה הזמנית של הקונטיינר, כלומר אובדן בכל `docker compose up` ולא רק באיפוס סשן — גרוע מהמצב הנוכחי. הוויולום מהותי, לא קוסמטי.
- **קדימות סביבה אומתה:** השירות טוען גם `env_file: whatsapp-bridge.env` (שבו יש `AUTH_STATE_PATH=/data/auth` ואין `BRIDGE_CONFIG_PATH`) וגם `environment:`. ב-docker compose `environment:` גובר, ולכן `/data/config` ינצח בפרודקשן. נבדק מול הקובץ שעל השרת.
- **המיגרציה בטוחה:** `resolveConfigFileForRead` מעתיק רק כשהיעד חסר והמקור קיים, ובכשל נופל לקריאה מהנתיב הישן במקום לאבד תצורה (`config-store.ts:20-29`). התנהגות המיגרציה נראתה בפועל בלוג של ריצת הבדיקות.
- `dm-lid-map.json` נשאר עם `catch` שקט בטעינה. זה מקובל — מפה חסרה היא המצב הנורמלי בהתקנה חדשה, בשונה מרשימת לכידה ריקה שהיא תקלה.

## Verification

- `pnpm exec vitest run ../../apps/whatsapp-bridge` מתוך `packages/api` — 6 קבצים, 34 בדיקות, הכל עובר (הורץ גם בידי המבצע וגם בבדיקה חוזרת שלי).
- `pnpm -r run lint` — exit 0.
- `tsc --noEmit` בחבילת הגשר — נקי.
- טרם אומת בפרודקשן; יאומת אחרי הדיפלוי שבו תיבדק הופעת `dmAllowlist` ו-`watchedGroups` ב-`/status` ושרידות התצורה.
