# Workflow: Release Notes Listener

> **Executing Agent:** `11_release_notes_listener`
> **Spec:** `docs/specs/notion-release-notes-listener.md`

```
[Trigger: cron every 5 min, only if agent enabled]
        │
        ▼
QUERY NOTION DB → DIFF vs notion_release_seen → COMPOSE → SEND (group "טכני") → MARK
```

1. **Query** — כל דפי הטבלה (עם pagination).
2. **Baseline** — בהרצה הראשונה כל הרשומות הקיימות מסומנות `seen` בלי שליחה.
3. **Diff** — רשומה שאינה ב-`notion_release_seen`, או `pending` עם פחות מ-5 ניסיונות.
4. **Compose** — כותרת, תאריך, שירותים, שינויי סכמה, Commit, Run, גוף הדף. תוכן ריק מדולג.
5. **Deliver** — ערוץ וואטסאפ כבוי → `drafted` (באפליקציה בלבד). דלוק → `sent`; כישלון → `pending` וניסיון חוזר, אחרי 5 → `failed`.

**Error handling:** כשל בשליפה מ-Notion → ריצה מסומנת `error` בעמוד הניהול, בלי שינוי מצב.
