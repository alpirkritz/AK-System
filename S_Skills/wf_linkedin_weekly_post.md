# Workflow: LinkedIn Weekly Post

> **Executing Agent:** `12_linkedin_post_writer`
> **Execution Mode:** On demand (manual run or optional weekly schedule)

```
[Trigger: manual run or chat request]
        │
        ▼
PRE-FLIGHT → GATHER (last 7 days) → PICK ONE MOMENT → DRAFT HE → DRAFT EN → SELF-CHECK → DELIVER
```

## Stage 1: Pre-flight
1. לקרוא את `C_Core/brand_dna_and_compliance.md` ולוודא יישור.

## Stage 2: Gather
1. אם המשתמש ציין פגישה, אדם או תמלול, זה העוגן. דלגו לשלב 3.
2. אחרת: למשוך מה-7 הימים האחרונים 1-3 פגישות משמעותיות (`get_notion_meeting_notes`, `get_notion_meetings`), לקרוא תמלול מלא ולא רק סיכום, ובנוסף משימות שנסגרו או נתקעו (`get_notion_tasks`).
3. אם השבוע דל, לעבור לעוגנים בכרטיס הסוכן ולציין זאת.
4. נושאים שכבר פורסמו: לא לחזור על נושא או פתיח. אם אין גישה לארכיון הפוסטים, לשאול את אלפיר על מה כתב לאחרונה.

## Stage 3: Pick one moment
1. לבחור רגע אחד ועמוד תווך אחד, ולהחליף בין שלושת העמודים משבוע לשבוע.
2. מבחן: "מה עמית בטק, מוצר או תפעול ייקח מזה?" אם כלום, לבחור רגע אחר.

## Stage 4: Draft
1. עברית קודם, 120-250 מילים, לפי Writing Rules בכרטיס הסוכן.
2. אנגלית כניסוח עצמאי, לא תרגום.

## Stage 5: Self-check
- אין פתיח מלוטש, אין שאלת סיום, אין סימני צ'אטבוט
- אין מידע פנימי, אין שמות אנשים בלי אישור, אין צליל של מכירת שירותים
- לא מדובר על השיחה שהתחילה את ההרגל

## Stage 6: Deliver
מבנה התשובה לפי "Output Format" בכרטיס. לא לפרסם; אלפיר מפרסם בעצמו.

**Error handling:** אין גישה לנתונים, או אין עוגן אמיתי → לא להמציא סיפור; לבקש מאלפיר פגישה או תמלול.
