# Reorderable layout — dashboard, person page, meetings

> **Slug:** `layout-reorder`
> **Status:** Approved — implemented (see reports/layout-reorder.md)
> **Last Updated:** 2026-11-02

## Goal

The owner wants to arrange the blocks of his main screens in the order that fits him (for example "המשימות שלי" before "חייבים לי"), and have that order saved. Web first. Three screens: the dashboard, the person page, and the meetings page.

## User Stories

- As the owner, I want to drag the dashboard blocks into my own order, so what I need first is first.
- As the owner, I want the sections of a person's page in my own order (tasks first stays the default), so every person opens the way I work.
- As the owner, I want to reorder the meetings page sections, so for example "השבוע" can sit above "מחר".
- As the owner, I want the order saved on the server, so it follows me across devices and survives a cleared browser.
- As the owner, I want to hide a block I never use and bring it back, and to reset to the default.

## Acceptance Criteria

**Common**
- [ ] A button "סדר מחדש" on each of the three screens turns on edit mode. Only in edit mode are blocks draggable; a handle appears on each block, and "סיום" leaves the mode.
- [ ] Dragging works with mouse, touch and keyboard (focus a handle, Space to lift, arrows to move, Space to drop), and in RTL.
- [ ] The new order is saved as soon as a block is dropped. Reloading, or opening another device, shows the same order.
- [ ] In edit mode each block has "הסתר". Hidden blocks are listed in a tray "בלוקים מוסתרים" with "החזר".
- [ ] "חזרה לברירת מחדל" resets that screen's order and hidden blocks after confirmation.
- [ ] A block that ships later and is not in the saved order appears at the end. A saved block that no longer exists is ignored.
- [ ] The default order equals today's order, so nobody sees a change until they edit.

**Dashboard blocks** (order and hide): התראות חשובות, פעולות מהירות (bar), סיכום מהיר (KPI strip), פעולות מהירות (list), התנגשויות ביומן, חייבים לי היום, תובנות, פגישות קרובות, המשימות שלי, פיד. "פגישות קרובות" and "המשימות שלי" are two separate blocks, so they can be stacked or placed side by side in the order given.

**Person page blocks** (inside the person drawer): משימות, פרטים, שמות נוספים, שיוכים, תדירות קשר, הקשר, זהויות חיצוניות, פרויקטים, סיכומי ישיבות, פגישות. The header (name, actions) is fixed.

**Meetings page blocks**: each timeline section is a block — היום, מחר, השבוע, שבוע הבא, מאוחר יותר (upcoming), and אתמול, השבוע, החודש, מוקדם יותר (past), and "לא משויכות". Search and filters stay fixed at the top. Collapsed or expanded state of a section is also remembered.

## Data Model

New column on `user_settings`, in both `schema.pg.ts` and `schema.ts`, with the SQLite bootstrap `ALTER TABLE` in `packages/database/src/index.ts`:

```
layout_prefs  text   -- JSON: { [screenId]: { order: string[], hidden: string[], collapsed?: string[] } }
```

`screenId` is one of `dashboard`, `person`, `meetings`. Block ids are stable strings defined in code, not display labels.

## tRPC API

- `settings.layout.get()` returns the whole object (defaults filled in for screens with nothing saved).
- `settings.layout.set({ screen, order, hidden, collapsed? })` replaces one screen's entry. The server validates `screen` and keeps only string ids, capped in length.
- `settings.layout.reset({ screen })` removes the entry.
- A pure helper `applyLayout(defaultIds, saved)` returns the final visible order (saved order first, unknown new ids appended, unknown saved ids dropped). Shared by the three screens and unit tested.

## UI Surface

- New `apps/web/src/components/layout/` with a `ReorderableBlocks` wrapper (drag handles, edit mode, hidden tray) built on `@dnd-kit/core` and `@dnd-kit/sortable`, plus a `useLayout(screen)` hook (React Query, optimistic update).
- `apps/web/src/app/page.tsx`: render the dashboard blocks through the wrapper.
- `apps/web/src/components/people/PersonDetailDrawer.tsx`: render the person sections through the wrapper.
- `apps/web/src/app/meetings/page.tsx`: render the timeline sections through the wrapper.
- Design system classes only; drag handle visible on hover and always in edit mode; RTL and dark theme checked.

## Out of scope

- Mobile reordering (the saved layout lives in the same place, so mobile can read it later).
- The people list itself (table or cards); filters and toolbars on /people.
- Resizing blocks, or multiple named layouts.
- Moving a block from one screen to another.

## Open questions

- **Dashboard side-by-side pair:** today "פגישות קרובות" and "המשימות שלי" sit in two columns on wide screens. Proposed: keep a two-column grid for those two blocks only when they are adjacent; otherwise each takes full width. Alternative: every block full width, simpler. Which do you prefer?
- **Meetings chronology:** reordering "היום", "מחר", "השבוע" breaks the top-to-bottom time order. Proposed: allow it anyway, since you asked for control; the default stays chronological.
