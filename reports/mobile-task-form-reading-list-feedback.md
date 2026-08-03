## UI/UX Review

**Verdict:** APPROVED WITH NITS
**Detected stack:** next-trpc-monorepo
**Review mode:** pre-implementation (spec review of `docs/specs/mobile-task-form-reading-list-feedback.md`)

### Design System Checklist

- [x] Matches project tokens/classes — web reading-list page specified to use `.card`/`.input`/`.btn`/`.btn-primary`/`.btn-danger` from `apps/web/src/app/globals.css`.
- [x] RTL layout preserved — all specified copy is Hebrew; no LTR-only assumptions.
- [x] Mobile layout works — new screen uses a header-icon entry point (not a 6th tab), keeping the existing 5-tab bar intact.
- [x] No unapproved UI frameworks introduced — `@react-native-community/datetimepicker` is a native module addition (justified, no cross-platform UI library), not a design-system violation.
- [x] Reuses existing components/patterns — `KeyboardAvoidingView` mirrors `chat.tsx`'s existing pattern; stack-screen registration mirrors `notifications`/`settings`; API router mirrors `feedRouter` conventions.

### UX Quality Checklist

- [x] Clear visual hierarchy / one primary action per view — reading-list screen: one primary CTA ("הוסף קישור" from empty state); task form: date field has one clear affordance.
- [x] Cognitive load minimized — reading-list add form is 2 required fields + 1 optional; task date picker replaces a manual-format text field with a picker, reducing input error.
- [~] All feedback states handled — loading (list fetch), empty state, validation error, save failure, and destructive-delete confirmation are all specified. **Missing:** an explicit success confirmation for a successful add/delete (spec only implies success via the item appearing/disappearing in the list) — acceptable for a simple list, but flag for dev-agent to add a brief toast/inline confirmation if the item transition alone isn't visually obvious enough on slower networks.
- [x] Destructive actions require confirmation — delete flow explicitly specifies "למחוק את הפריט הזה? לא ניתן לשחזר." with מחק/ביטול.
- [x] Microcopy: clear Hebrew, verb-first buttons, human errors — "שמור לרשימה", "הוסף קישור", "כתובת לא תקינה — ודא שהיא מתחילה ב-http:// או https://", "שמירה נכשלה — נסה שוב". No raw error codes or English leaking into user-facing copy.
- [ ] Touch targets ≥ 44px; focus-visible; keyboard navigable — not addressed in the spec (implementation-level, not spec-level). Flag for dev-agent: ensure the mark-read toggle and delete action on mobile rows meet the 44×44px minimum, and the web page has visible `:focus-visible` states consistent with the rest of the app.

### Findings

- **Must-fix:** none — spec is implementable as-is.
- **Nits:**
  1. Add explicit success feedback copy for "item saved" / "item deleted" in the reading list (dev-agent to add during implementation; e.g. a brief inline toast, consistent with how other list mutations in the app confirm success).
  2. No duplicate-URL handling specified (saving the same URL twice creates two rows) — acceptable for MVP per the confirmed "personal bookmarks" scope, but worth a one-line mention in a future iteration rather than silently allowing duplicates forever.
  3. Touch-target sizing (≥44px) and focus-visible states aren't called out in the spec — standard app-wide convention should be followed; confirm during dev-agent implementation and post-implementation UI review rather than blocking the spec on it.
  4. The chat tool's confirmation copy ("נרשם לטיפול ב-X — ייבדק ידנית...") is LLM-generated, not a fixed string — recommend the system-prompt instruction pin the exact Hebrew phrasing pattern so wording stays consistent across turns, rather than leaving full latitude to the model.

Spec is aligned with `pm-agent`'s output contract (all required + stack-specific sections present, no code blocks over 25 lines, no `TODO`/`TBD` markers, new `readingList` top-level area justified in one line) and is approved to proceed to Dev once the user confirms the plan.

---

## UI/UX Review (post-implementation)

**Verdict:** APPROVED
**Review mode:** post-implementation (shipped code)

### Nits from the pre-implementation review

1. **Success feedback for save/delete — resolved.** Mobile shows a transient `notice` line
   ("נשמר לרשימה" / "הפריט נמחק") that clears after 2s (`apps/mobile/app/reading-list.tsx`);
   web shows the same copy as a green pill via `flash()` (`apps/web/src/app/reading-list/page.tsx`).
2. **Duplicate URLs — deferred as agreed.** Saving the same URL twice still creates two rows;
   unchanged MVP scope, no silent failure.
3. **Touch targets + focus-visible — resolved.** Mobile: row actions are `minHeight: 44`
   (`reading-list.tsx:393`), clear-date is `minHeight: 48` (`task/[id].tsx:438`), and the new
   header icon got `minHeight: 44` — which also fixed the pre-existing bell icon, previously
   padding-only. Web: the page uses `.btn`/`.input`/`.card`, which inherit
   `.btn:focus-visible`, `.input:focus`, and the global `:focus-visible` outline from
   `globals.css:57`; inputs are label-associated via `htmlFor`/`id` for keyboard and screen-reader use.
4. **Pinned chat confirmation phrasing — resolved.** The system prompt now fixes the exact shape:
   `נרשם לטיפול ב-<agentId>, ייבדק ידנית` (`conversation-engine.ts:1067`), with the tool result
   explicitly instructing the model not to claim the behavior already changed.

### Additional UX observations

- **Date picker reads as a date, not a format.** The stored value stays `YYYY-MM-DD` for the
  backend, but the field renders Hebrew long form via `toLocaleDateString('he-IL', …)`, so the
  old `(YYYY-MM-DD)` hint in the label was dropped as redundant.
- **Timezone correctness is user-visible.** `toDateInput` (`task/[id].tsx:37`) formats from local
  date parts rather than `toISOString()`, which would have shifted the chosen day backwards for
  users east of UTC — i.e. every Israel-based selection before 03:00.
- **Read state is conveyed twice, not by color alone** — strikethrough plus reduced opacity, so it
  survives grayscale and color-blind viewing.
- **Delete confirmation differs by platform, correctly** — native `Alert` on mobile, inline
  confirm-in-place on web, avoiding a modal for a single-row action.
- **Keyboard handling is platform-split deliberately** — `behavior="padding"` on iOS only
  (`task/[id].tsx:212`); Android relies on the existing `softwareKeyboardLayoutMode: 'resize'`
  in `app.config.ts`, since stacking both double-adjusts inside a `formSheet`.

---

## Code Review

**Verdict:** APPROVED
**Detected stack:** next-trpc-monorepo
**QA report:** `reports/qa-mobile-task-form-reading-list-feedback.md`

### Spec conformance

| Spec item | Status |
|---|---|
| Mobile date picker replacing free-text due date | Implemented — `@react-native-community/datetimepicker@9.1.0`, Expo SDK 56-supported, registered in `app.config.ts` plugins |
| Mobile keyboard avoidance in task form | Implemented — iOS `KeyboardAvoidingView`, Android via existing resize mode |
| Web date picker / keyboard | No change needed, as specified — both web task modals already use `<input type="date">`; the modal already scrolls |
| `reading_list_items` table (both dialects) | Implemented in `schema.pg.ts` + `schema.ts`, with SQLite auto-create statements in `packages/database/src/index.ts` following the repo's existing `CREATE TABLE IF NOT EXISTS` bootstrap pattern |
| `readingList` router: list/create/markRead/delete | Implemented, mounted at `readingList` in `packages/api/src/index.ts` |
| Mobile reading-list screen + entry point | Implemented — stack screen + header icon (5-tab bar untouched) |
| Web reading-list page + nav link | Implemented — sidebar "מידע" section and mobile "more" menu |
| `log_agent_feedback` chat tool | Implemented — declaration, dispatch, and append-only `M_Memory` writer |

### Findings

- **Must-fix:** none.
- **Nits:**
  1. `packages/database` has no drizzle migration files at all (`out: './drizzle'` is empty); the
     repo bootstraps SQLite via `CREATE TABLE IF NOT EXISTS` in `getDb()` and pushes with
     `drizzle-kit push`. This change follows that existing pattern rather than introducing the
     repo's first migration directory, but **Postgres deployments need `drizzle-kit push` (or an
     equivalent manual `CREATE TABLE`) before `readingList` works there** — the SQLite
     auto-create path does not cover PG. Worth confirming before the next EC2 deploy.
  2. `packages/api/src/routers/feed.ts:87` has the same validate-then-trim URL ordering that was
     just fixed in `readingList.ts`, so `feed.createSource` still rejects pasted URLs with
     surrounding whitespace. Left untouched as out of scope.
  3. `readingList.list` filters by status in application code after fetching all rows (mirroring
     `memory.memories.list`) rather than in SQL. Fine at personal-bookmark scale; the
     `idx_reading_list_items_status` index is in place if it ever needs pushing down.

### Governance

- `.cursorrules` Rule 3 respected: `log_agent_feedback` only ever appends to
  `M_Memory/agents_daily_sync.md`, and a test asserts the target `A_Agents/*.md` file is left
  byte-identical. `agentId` is `path.basename`-guarded against traversal, with a test.
- No secrets added; no PII introduced by the new table (user-supplied URLs and titles only).
