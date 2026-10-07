# Review — commitment-source-context

**Verdict:** APPROVED
**Spec:** `docs/specs/commitment-source-context.md`
**Detected stack:** `next-trpc-monorepo`

## Root causes addressed

1. `commitments` stored only `created_at` (scan time), so a noon message scanned at 20:40 read as 20:40.
2. `scanGroupCommitments` wrote the classifier's reason sentence into `source_snippet`, so a group commitment never carried the actual message.
3. `commitmentSourceUrl` returns `null` for WhatsApp and the chat name was only used in the push notification, never stored — nothing on `/commitments` identified the conversation.
4. `scripts/local-cron.mjs:63` fires the scan on container boot, so a redeploy pushed everything accumulated since the last run as if it were fresh.

## Changes

| File | Change |
|---|---|
| `packages/database/src/schema.pg.ts`, `schema.ts` | `commitments` gains `source_ts`, `source_chat_jid`, `source_chat_name`, `source_reason` (all nullable) and index `idx_commitments_source_ts`. |
| `packages/database/src/index.ts` | `COMMITMENT_SOURCE_COLUMNS` bootstrap block, applied **after** `relaxCommitmentsPersonId` so a table rebuild cannot drop the new columns. |
| `packages/api/src/services/whatsapp-dm.ts` | `ProposedCommitment` carries `sourceTs` / `sourceChatJid` / `sourceChatName`; `proposeCommitments` persists them and routes `because` to `source_reason`. Group scan stores `clip(m.text, 160)` as the snippet. DM scan stores the message text and the person's name. Classifier prompt tightened. |
| `packages/api/src/services/commitments.ts` | `COMMITMENT_FRESH_HOURS = 6` and `freshCommitments()`. |
| `apps/web/src/app/api/cron/whatsapp-{dm,group}-commitments/route.ts` | Notify only on `freshCommitments(result.proposed)`; everything still gets inserted. |
| `packages/api/src/routers/commitments.ts` | New `sourceContext` query (`windowAround`, 5 before / 2 after); list projections gain `sourceTs`, `sourceChatName`, `sourceReason`. |
| `apps/web/src/app/commitments/page.tsx` | Row shows chat name, relative source time, `למה:` reason, and a `הצג הקשר` disclosure. |
| `apps/mobile/app/(tabs)/commitments.tsx`, `lib/data.ts` | Chat name, relative source time and reason on each row. |

## Spec conformance

- All four columns nullable; the UI falls back to `createdAt` and hides the chat line when absent, so pre-existing rows keep rendering. ✅
- Notification policy per the user's choice: push on every new commitment, suppressed only when the source message is older than 6h. Items with no `sourceTs` count as fresh. ✅
- `sourceContext` returns `{ chatName: null, messages: [] }` for non-message sources and `[expired]` text renders as stored. ✅

### Deviation from spec

The spec left the classifier unchanged ("Out of scope: changing how the classifier picks commitments"). After reviewing 25 real production rows with the user — roughly 5 of which were genuine tasks — the user asked to tighten the prompt. Six rules were added to `classifyMessagesWithModel`: return empty by default, drop settled items, drop personal/social logistics and RSVPs, drop opinions and small talk, require a concrete undone action, and never echo the message text back as `content`. No hard-coded rejection rules were added; the user explicitly chose prompt-only.

## UI/UX Review

**Verdict:** APPROVED

### Design System Checklist
- [x] Matches project tokens/classes — `.card`, `.pill`, `.btn-ghost`, existing palette (`#97a4c2`, `#5a688c`, `#b8c4dc`, `#223052`, `#131c33`)
- [x] RTL preserved — quote block already used logical `borderInlineStart` / `paddingInlineStart`
- [x] Mobile layout works — metadata line wraps via `flex-wrap`; mobile app mirrors the metadata
- [x] No unapproved UI frameworks
- [x] Reuses `CommitmentSourceBadge`

### UX Quality Checklist
- [x] Clear hierarchy — context is collapsed by default and only fetched on demand (`enabled: open`), so the list stays scannable
- [x] Cognitive load — the relative time (`לפני 45 דק׳`) answers "is this still relevant?" at a glance, which was the user's actual complaint
- [x] Feedback states — `טוען הקשר…` while loading, `ההודעות המקוריות כבר לא נשמרות.` when retention cleared the messages
- [x] Destructive actions — none added
- [x] Microcopy — `הצג הקשר` / `הסתר הקשר`, `למה: …`
- [x] `aria-expanded` on the toggle; `title` carries the full timestamp for the relative label

### Findings
- Must-fix: none.
- Nits:
  - `sourceTimeLabel` renders the absolute date during SSR and switches to relative after `useEffect`, to avoid a hydration mismatch. A brief flip on first paint is the tradeoff.
  - DM commitments store `source_chat_name` but not `source_chat_jid`; `sourceContext` resolves DMs through `person_id` instead, which is sufficient and avoids a second lookup.

## QA

- `pnpm --filter @ak-system/api test` — 1128 passed, 14 skipped. Same 3 pre-existing failures as before this change (ffmpeg missing, incomplete Gemini file-manager mock).
- New Vitest coverage: 4 `freshCommitments` cases; group scan stores text + ts + chat; `commitments.sourceContext` returns the window with `isSource` on the right message.
- Updated assertions that encoded the old behaviour: `whatsapp-dm.test.ts` (snippet is now the message, reason is separate) and `whatsapp-group-commitments.test.ts`.
- `npx playwright test email-voice-commitments` — 6 passed, including the new "names its chat, when it was said, and opens the original messages".
- `pnpm -r run lint` — clean. `pnpm --filter @ak-system/web build` — succeeds. `tsc --noEmit` in `apps/mobile` — clean.

## Not done

- Backfilling `source_ts` for the 134 existing rows. They fall back to `created_at`, which for recent rows is close enough and for old ones is all that was ever recorded.
- The boot-time cron fire in `scripts/local-cron.mjs` is unchanged; the 6-hour freshness filter neutralises its effect on notifications.
