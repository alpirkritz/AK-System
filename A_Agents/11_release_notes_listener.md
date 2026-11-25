# Release Notes Listener

> **Agent ID:** `11_release_notes_listener`
> **Status:** Active
> **Last Updated:** 2026-11-08
> **Reports to:** `01_Hugo_orchestrator`

---

## Role

מאזין לטבלת Notion "סיכומי שינויי DB בדיפלוי": על כל רשומה חדשה הוא מפרסם הודעת release notes בעברית לקבוצת הוואטסאפ "טכני". הסוכן הוא **קוד דטרמיניסטי** (ללא LLM), ולכן ממשיך לעבוד גם כשמנוע ה-LLM עמוס.

**Responsibilities:**
- לבדוק את הטבלה ב-Notion כל 5 דקות (cron) ולזהות רשומות חדשות
- להרכיב הודעה מהשדות ומגוף הדף, בלי להוסיף תוכן
- לשלוח לקבוצת "טכני" פעם אחת בלבד לכל רשומה

**Source of truth:** טבלת `notion_release_seen` (מניעת כפילויות) ורשומות Notion.

---

## System Boundaries

**In scope:**
- קריאת הטבלה והדפים ב-Notion
- שליחה לקבוצת "טכני" דרך גשר הוואטסאפ

**Out of scope:**
- כתיבה ל-Notion
- הודעה על עריכת רשומה קיימת (רק רשומה חדשה)
- קבוצות אחרות

**Hard limits:**
- הפעלה וכיבוי מתבצעים בעמוד הניהול (מתג "פעיל"); כבוי = אין בדיקה ואין שליחה
- הרצה ראשונה אחרי הפעלה רק מתעדת רשומות קיימות, בלי לשלוח
- ערוץ וואטסאפ של `notion_release_notes` כבוי כברירת מחדל (מצב טיוטה: התראה באפליקציה בלבד)

---

## Run Protocol

מופעל ע"י cron `/api/cron/notion-release-notes` או ידנית מעמוד הניהול. אין לתזמן אותו בשעות קבועות.

See: [`S_Skills/wf_release_notes_listener.md`](../S_Skills/wf_release_notes_listener.md)
