# WhatsApp daily digest heading and emoji

> **Slug:** `whatsapp-digest-heading-and-emoji`
> **Status:** Approved
> **Last Updated:** 2026-10-04

## Goal

The evening all-groups WhatsApp digest currently names itself `צריך אותך` in the action block and in the push title. Rename that surface to a clear digest name (`סיכום וואטסאפ יומי`) and add a few emojis at fixed points (title, action block, story beats) so the message reads as a daily briefing, not an alarm.

## User Stories

- As the owner, I want the daily group briefing titled `סיכום וואטסאפ יומי`, so a WhatsApp push does not look like a panic ping named `צריך אותך`.
- As the owner, I want a couple of emojis on the title, the to-do block, and each story beat, so the message is easy to scan without becoming a sticker dump.

## Acceptance Criteria

- [ ] Date header (plain and markdown `#`) is `💬 סיכום וואטסאפ יומי — {dateLabel}`. It is not `מה היה היום — {dateLabel}`.
- [ ] Push / notification title from `digestTitle` is always `💬 סיכום וואטסאפ יומי`, with or without actions. It is never `צריך אותך` or `מה היה היום`.
- [ ] When there is at least one grounded action, the action heading is `📌 לטפל` (markdown `## 📌 לטפל`). The string `צריך אותך` does not appear in plain, markdown, or title.
- [ ] Quiet-day body is still `היום לא קרה כלום.` after the new date header. No action heading.
- [ ] `digestPushBody` still starts at the action heading when present, otherwise from the start of the plain text.
- [ ] `DEFAULT_DAILY_DIGEST_PROMPT` still uses the friend-on-coffee tone, and adds one line: one emoji at the start of each group/event beat (examples 🏫 👨‍👩‍👧 💼 📅 ✅ ⚠️ 🎉); no emoji chains; not on every sentence.
- [ ] `DIGEST_JSON_CONTRACT` still forbids bullets and label headings. It allows a single emoji at the start of a group/event beat in `narrative`.
- [ ] A saved custom prompt is unchanged. Only the code default (and reset) picks up the emoji instruction.
- [ ] No schema, tRPC, or settings-page chrome changes. The existing prompt editor at `/settings/whatsapp` shows the new default when the stored column is null.
- [ ] Formatter tests in `packages/api/src/services/whatsapp-daily-digest.test.ts` cover: new header, action heading, title, quiet day, absence of `צריך אותך` / `מה היה היום`. Default prompt still matches `/חבר שמספר/` for the existing Playwright check.

## Data Model

None. `user_settings.whatsapp_daily_digest_prompt` stays as today.

## tRPC API

None. Existing `whatsapp.digest.run` / `whatsapp.digest.prompt.*` keep their shapes. Rendered `text`, `title`, and `markdown` strings change as above.

## UI Surface

No new controls. `/settings/whatsapp` Groups tab still has **ניסוח הסיכום היומי**. The textarea default text gains the emoji sentence when the user has not saved a custom prompt.

WhatsApp self-chat and in-app notification use the new header / action heading / title.

## Out of Scope

- Per-group `summarizeGroupMessages` and cluster summaries.
- Insights-tab digest.
- Changing digest time, channels, `צריך אותך` removal of the action *block* (only the label changes).
- Migrating an already-saved custom prompt in production.
- Mobile settings UI.

## Open Questions

- None. Action bullets stay `•` / `-`. The digest name lives on the date header and push title; the remaining to-do block is `📌 לטפל`.
