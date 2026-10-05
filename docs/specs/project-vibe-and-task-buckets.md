# Project meeting vibe on mobile, and task buckets

> **Slug:** `project-vibe-and-task-buckets`
> **Status:** Implemented
> **Last Updated:** 2026-09-26

## Goal

On a project in the mobile app, show the same meeting-vibe glance the web project page already shows. On task lists in both mobile and web, put open work in two visible groups: overdue first, then open tasks whose due day has not passed, with high priority first inside each group. Completed work stays below those groups.

## User Stories

- As Alpir, I want a project in the app to show the atmosphere, the people, and the meeting-quality line I already see on the web, so I can judge the project without opening the browser.
- As Alpir, I want to read and refresh the project brief from that same screen.
- As Alpir, I want overdue open tasks above open tasks that are not yet due, on the phone and on the web, so late work is the first thing I see.
- As Alpir, I want high-priority tasks above lower-priority ones inside each of those groups.

## Acceptance Criteria

### Project vibe (mobile)

- Given a project with analysed meetings, when its screen opens in the app, then a card titled "איפה זה עומד" appears above the name field and shows three lines: אווירה (`warmth.dataReason`), אנשים (the same headline rule as the web), and ציון (`warmth.scoreText`). Cooling text is coral, warming text is teal.
- Given fewer than two scored meetings, when the card renders, then the quality line is omitted and the three lines still show. Empty copy matches the web: "עוד אין תמונת אווירה.", "עוד אין אנשים משויכים.", "עוד אין ציון."
- Given at least two scores, when the card renders, then a line runs from older on the left to newer on the right. Each dot is teal when that meeting's mood and subtext read warm, coral when they read cold, and gray otherwise. Caption: "הקו: איכות השיחה. הנקודה: אווירה, חמה או קרה. משמאל ישן, מימין אחרון."
- Given the card, when "פירוט" is tapped, then it expands to the stored brief, the people lines, and three panels: תובנות, אווירה, ציון. A second tap collapses it. Meeting titles in the panels open that meeting in the app.
- Given no brief, when the detail is open, then the line is "עוד אין תמצית." and the button is "כתוב תמצית". A stored brief shows in full, with "נותח לאחרונה" in Asia/Jerusalem, and the button is "נתח שוב". While the write runs, the button reads "כותב תמצית…" and is disabled. A newer analysis shows "יש שיחות חדשות מאז התמצית." A failed write keeps the previous brief and shows the Hebrew error from the API.
- Given the project has no analyses, when the screen opens, then the card still renders with the empty lines and does not block editing the name, description, or tasks.

### Task buckets (mobile and web)

- Given a mixed list, when it renders, then non-empty groups appear in this order: "באיחור", then "לא באיחור", then "הושלמו", then "בוטלו". A group with no tasks is omitted.
- "באיחור" is an open task whose due day is strictly before today, using the existing `isOverdueOpenTask` rule (done and cancelled are never overdue; a missing or unparseable due day is not overdue).
- "לא באיחור" is every other open task: due today, due later, or no due day.
- Inside "באיחור" and "לא באיחור", order is high, then medium, then low. Unknown priority ranks as medium. Same priority sorts by due day ascending. A missing due day sorts after dated tasks in "לא באיחור".
- "הושלמו" and "בוטלו" keep the list's existing within-list sort and sit below the open groups. They appear only when the current filter includes those rows.
- Given the mobile tasks filter is already "באיחור", "הושלמו", or "בוטלו", when the list renders, then there is no extra group header. Given the filter is "פתוחות" or "הכל", when both open groups have tasks, then both headers show.
- Given the web tasks page or the dashboard has a saved sort, when a group renders, then that sort orders rows inside the group. The groups themselves stay in the order above. Priority group headers on `/tasks` are replaced by these due-state headers.
- Given the web project page and the person drawer, when their task lists render, then they use the same groups and the same within-group order (priority, then due). There is no separate sort control on those lists.
- Given the mobile home task window, the mobile tasks tab, and a mobile project, when those lists render, then they use the same groups.

## Data Model

No schema change in `packages/database/src/schema.ts` or `schema.pg.ts`.

## tRPC API

No new procedure. Auth stays `protectedProcedure`.

Mobile reads the existing `projects.getRelated` query. It already returns `warmth` (`dataReason`, `scoreText`, `people`, `timeline`) and `standing` (`brief`, `briefAt`, `stale`). Refreshing the brief calls the existing `projects.writeStanding` mutation with `{ id }`.

Task order is computed on the client. `tasks.list` may keep its current `orderBy`.

## UI Surface

Mobile:

- `apps/mobile/lib/data.ts` — `fetchProjectRelated` and `writeProjectStanding`, wrapping `projects.getRelated` and `projects.writeStanding`.
- `apps/mobile/app/project/[id].tsx` — vibe card above the name field. Editing, saving, deleting, and the task list stay.
- `apps/mobile/lib/sort-tasks.ts` — replace the priority-then-due-only order with `groupTasksByDueState`. Keep priority-then-due as the order inside the two open groups.
- `apps/mobile/app/(tabs)/tasks.tsx`, `apps/mobile/app/(tabs)/index.tsx`, and the project task list use that grouping.
- People headline and mood-dot color follow the same rules as `apps/web/src/components/relationship/InsightStrands.tsx` (`peopleHeadline`, `moodTone`). Copy them into a small mobile helper; do not import the web component.

Web:

- `apps/web/src/lib/sort-tasks.ts` — shared `groupTasksByDueState`.
- `apps/web/src/app/tasks/page.tsx` — due-state sections. The sort control orders rows inside a section.
- `apps/web/src/app/page.tsx` — the open-task list uses the two open sections. The dashboard sort control orders rows inside a section.
- `apps/web/src/app/projects/[id]/page.tsx` and `apps/web/src/components/people/PersonDetailDrawer.tsx` — same sections, fixed within-group order.

Hebrew labels: "באיחור", "לא באיחור", "הושלמו", "בוטלו". Due today is "לא באיחור".

## Out of Scope

- A new warmth model, a new score, or a Gemini call on screen open. The brief still runs only when "כתוב תמצית" or "נתח שוב" is tapped.
- Meeting-page action items ("פעולות שהוחלטו").
- Sort controls on mobile.
- Changing filters, Notion sync, or the tasks API order.
- Building a new APK.

## Open Questions

None. Within each open group, high priority comes before a nearer due date.
