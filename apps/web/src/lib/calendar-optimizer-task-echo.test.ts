import { describe, expect, it } from 'vitest'
import { stripCalendarTaskEcho } from './calendar-optimizer-task-echo'

const PREVIOUS = `**סיכום יומן יומי — יום רביעי**

*   **סיכום מהיר**
    *   קונפליקטים: אין.
    *   משימות: 5 משימות לתאריך יעד היום, 7 משימות בפיגור.

*   **הפגישות להיום**
    *   13:00–14:00 — פגישה בשגרירות

**תזכורות**

**משימות לתאריך יעד היום**
*   [High] לסגור ביטוח (Personal/Personal To-do, סטטוס: Not started)

**משימות בפיגור**
*   [Medium] רשימת משקיעים (DAZ/DAZ Tasks, תאריך יעד: 2026-09-10)

**המלצות**
*   נצל את חלונות הפוקוס.
`

describe('stripCalendarTaskEcho', () => {
  it('keeps meetings and drops the task dump from a previous brief', () => {
    const text = stripCalendarTaskEcho(PREVIOUS)
    expect(text).toContain('פגישה בשגרירות')
    expect(text).toContain('קונפליקטים: אין')
    expect(text).toContain('**המלצות**')
    expect(text).toContain('חלונות הפוקוס')
    expect(text).not.toContain('משימות לתאריך יעד היום')
    expect(text).not.toContain('משימות בפיגור')
    expect(text).not.toContain('Personal To-do')
    expect(text).not.toContain('תזכורות')
    expect(text).not.toContain('לסגור ביטוח')
  })
})
