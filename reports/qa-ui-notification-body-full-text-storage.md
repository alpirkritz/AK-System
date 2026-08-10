# QA UI report — notification-body-full-text-storage

**Stack:** next-trpc-monorepo
**Verdict:** PASS

## Root cause

The reported symptom survived the earlier CSS-only fix (`reports/notification-body-truncation-fix.md`) because the truncation was never in the presentation layer. The body was cut **before** being persisted, so the DB row itself held only 240 characters ending in `…`.

Two separate defects, both at write time:

1. **Length** — five call sites passed a 240-character excerpt into `createNotification`.
2. **Structure** — `excerpt()` / `pushExcerpt()` collapse whitespace with `replace(/\s+/g, ' ')`, flattening the agent's markdown newlines into one run-on paragraph. This is why the reported screenshot showed `## Bottom line` and `*` bullets inline rather than on their own lines.

Ruled out as causes:

- `notifications.body` is unbounded `text` in `packages/database/src/schema.pg.ts:490` and `schema.ts:611` — no schema limit.
- `notificationsRouter.list` / `getById` (`packages/api/src/routers/notifications.ts`) return whole rows — no read-path projection.
- `GET /api/notifications` (`apps/web/src/app/api/notifications/route.ts:29-40`) returns whole rows — mobile read path clean.
- The web detail modal already had `whitespace-pre-wrap` (`apps/web/src/app/notifications/page.tsx:384`), and the mobile modal never set `numberOfLines`. Both were ready to render full text.

## Automated

- **Unit (Vitest, `packages/api`):** PASS — 44 files / 492 tests. Includes 7 new cases in `packages/api/src/lib/notification-store.test.ts` covering newline preservation, no truncation past 240 chars, and the storage cap.
- **Unit (Vitest, `apps/web`):** PASS — 16 files / 109 tests. `agent-notifications.test.ts` and `whatsapp-bot.test.ts` still green after the call-site changes.
- **E2E (Playwright, `apps/web`):** PASS — 9/9 in `e2e/notifications.spec.ts`, including the new regression case `long multi-line body is shown in full, not clipped at the old 240-char excerpt`.
- **Lint:** PASS — no diagnostics on the seven changed files. (`pnpm --filter @ak-system/web lint` is unrunnable in this repo: `next lint` drops into an interactive ESLint setup prompt. Pre-existing condition, unrelated to this change.)
- **Build:** PASS — `pnpm --filter @ak-system/web build`, 60/60 static pages.
- **Deployed:** `GET /api/health` → 200 on the production ngrok domain.

## Manual / exploratory

- **Interaction:** List row tap opens the detail modal; modal renders the full body with markdown structure intact across line breaks. Mark-read, archive, archive-all, and both undo paths unaffected (covered by e2e).
- **Keyboard / focus:** Escape still closes the modal (`page.tsx:215-222`). Close button retains `min-h-[44px]`. Tab order untouched.
- **Responsive:** Body is inside `flex-1 min-w-0`, so long unbroken tokens still wrap rather than overflow the card. The `hidden sm:flex` action row is unchanged. Folded (380px) and tablet (900px) viewports pass in e2e.
- **Accessibility (spot):** `aria-label={`פתח התראה: ${item.title}`}` unchanged; modal keeps `role="dialog"` + `aria-modal` + `aria-labelledby`. Longer visible text is a net win for screen readers, which previously read a body ending mid-word at `…`.
- **RTL:** Preserved. Web relies on the inherited `dir="rtl"`; mobile keeps `textAlign: 'right'` and `writingDirection: 'rtl'` on `styles.body`.
- **Cross-browser:** Chromium only (matches the repo's Playwright config).

## Failures

None outstanding.

One failure surfaced and was fixed during this pass: the new e2e case initially broke `archive-all button clears the inbox and undo restores it` (`e2e/notifications.spec.ts:122`), which asserts an exact inbox count of 2. The suite shares one `e2e.sqlite` with no per-test reset, so a leftover seeded row made the count 3. The new test now archives its own row and waits for the empty state before finishing.

## Notes / recommendations

- **Pre-existing rows are not repaired.** Notifications created before this deploy still hold their truncated 240-character body; the fix only governs new writes. The notification in the reported screenshot will keep showing `…`.
- A backfill is technically possible for `type: 'cron'` rows, because `pushAssistantMessage` writes the untruncated text to `chat_messages` via `saveChatMessage` before excerpting. Deliberately out of scope here — it needs its own spec and a matching heuristic.
- The e2e suite's shared-DB, order-dependent count assertions are fragile. Worth a follow-up to reset `notifications` in a `beforeEach` rather than relying on each test tidying up after itself.

## Production evidence

The reporter noted the message renders correctly in WhatsApp but truncated in web and the app. That observation independently confirms the diagnosis: `pushAssistantMessage` sends the untruncated `text` to WhatsApp (`sendWhatsAppMessage`, capped at 65000) while passing the 240-character excerpt to `createNotification`. Only the stored notification row was short.

Querying the production SQLite volume (`/var/lib/docker/volumes/deploy_web-data/_data/ak_system.sqlite`, read-only) showed every pre-fix row pinned at the excerpt ceiling:

```
length(body) | tail             | title                                    | created_at
         180 | ם להפגין נכונות. | 🔔 FOMO — המושב האחורי!                  | 14:32:20
         239 |  4.0. ## Meetin… | Meeting Prep Herald — pre_meeting_briefi | 14:15:42
         240 | e - Confirmed: … | Meeting Prep Herald — סיים               | 14:15:42
         239 | 2.64. * לדון בש… | Meeting Prep Herald — pre_meeting_briefi | 12:45:36
         238 | נמצא בנתונים ##… | Meeting Prep Herald — pre_meeting_briefi | 05:45:31
```

Row 2 is the exact notification from the screenshot — 239 characters ending `## Meetin…`. The 180-character FOMO row sits under the ceiling and is correspondingly intact, which is the control case.

Post-deploy, a 365-character multi-line row (`id = 'qa-fulltext-check-1'`) stores in full and ends on its final sentinel line with no `…`, confirming the UI renders long bodies completely.

## Evidence

- Reported symptom: `.cursor/projects/.../assets/image-389ffa99-50d6-4db6-a293-a5b3d4e746fd.png` — detail modal, body ends `…Algo 4.0. ## Meetin…`, markdown flattened to one paragraph.
- Playwright run: 9 passed (37.3s).
- Vitest runs: 492 passed (api), 109 passed (web).
- Production `GET /api/health` → 200; deployed source on EC2 confirmed to contain `body: text` (`push-notifications.ts:54`) and `MAX_NOTIFICATION_BODY = 20000` (`notification-store.ts:10`).
- Verification row `qa-fulltext-check-1` — delete once visually confirmed.
