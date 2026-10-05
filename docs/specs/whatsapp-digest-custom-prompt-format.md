# Custom WhatsApp digest prompt owns the output

> **Slug:** `whatsapp-digest-custom-prompt-format`
> **Status:** Approved
> **Last Updated:** 2026-10-04

## Goal

A saved daily-digest prompt is ignored in practice. `buildDailyDigestPrompt` always appends a JSON contract that forbids bullets and headings, `generateDailyDigestModel` throws away non-JSON replies, and `arrangeDailyDigest` rebuilds a friend-story template and clips the body to 900 characters. The owner saved a structured executive briefing (Action Items, labels, bullets) and the sent message did not match it. When a custom prompt is stored, that text is the output contract: the server still supplies today’s messages and omits empty groups, but it must not rewrite the briefing into JSON or the old template.

## User Stories

- As the owner, I want a saved digest prompt (bullets, `##` sections, label grouping) to appear in the WhatsApp message from **סכם עכשיו את כל הקבוצות במעקב** and from the evening cron, so editing **ניסוח הסיכום היומי** actually changes the briefing.
- As the owner, I want the built-in default prompt to keep today’s JSON + spoken-story renderer, so reset still yields the friend-style digest.

## Acceptance Criteria

- [ ] Given `user_settings.whatsapp_daily_digest_prompt` is null, when the digest runs, then the model still receives `DIGEST_JSON_CONTRACT` (JSON `actions` + `narrative`, no bullets), and the renderer still uses the date header, optional `📌 לטפל` block, and a 900-character narrative clip.
- [ ] Given a saved (customized) prompt, when `buildDailyDigestPrompt` runs, then the prompt starts with the saved text, includes today’s non-empty group blocks, and does **not** contain `Respond in JSON only`, `No bullets`, or `no label headings`.
- [ ] Given a customized prompt, when the model returns markdown (e.g. `## ⚡ Action Items` and `-` bullets), then `runFollowedDailyDigest` / `renderDailyDigestPlain` send that markdown (plus the existing date header line). It does not prepend `📌 לטפל`, does not flatten into spoken prose, and does not replace the body with `לא הצלחתי לנסח את הסיכום. נסה שוב.` merely because the reply was not JSON.
- [ ] Given a customized prompt, the body is not clipped at 900 characters. The WhatsApp cap of 4000 characters (with the existing overflow note) still applies.
- [ ] Empty followed groups are still omitted from the model input. An all-quiet day is still `היום לא קרה כלום.` after the date header.
- [ ] If the freeform model returns empty or whitespace, use `DIGEST_NARRATIVE_FALLBACK`. If the freeform reply happens to be JSON with a `narrative` string, unwrap that string.
- [ ] `whatsapp.digest.prompt.save` / `get` / `reset` shapes are unchanged. tRPC `digest.run` return shape is unchanged.
- [ ] Settings hint under **איך לספר את היום** states that a saved prompt sets the message structure (headings and bullets), not only tone.
- [ ] Unit tests cover: default prompt still includes the JSON contract; customized `buildDailyDigestPrompt` does not; passthrough render keeps `## ⚡ Action Items` and bullets; 900-char clip is skipped on passthrough; quiet day unchanged.

## Data Model

None.

## tRPC API

None. `whatsapp.digest.run` and `whatsapp.digest.prompt.*` stay as they are. `generateDailyDigestModel(groups, instructions, options?: { contract: 'json' | 'freeform' })` — `runFollowedDailyDigest` passes `freeform` when `getDailyDigestPrompt().customized` is true.

## UI Surface

`apps/web/src/app/settings/whatsapp/page.tsx` — hint under the prompt textarea. Replace “כאן קובעים רק את הסגנון” with: `ההודעות של היום מתווספות אוטומטית. הניסוח ששמרת קובע את מבנה ההודעה, כולל כותרות ובולטים.` Same `.label` / muted hint pattern. No new controls.

## Out of Scope

- Per-group `summarizeGroupMessages` and cluster summaries (those still ignore this editor).
- Changing the default friend-style JSON digest.
- A live preview that calls Gemini from the editor.
- Migrating or rewriting the owner’s already-saved prompt text.

## Open Questions

- None. Custom prompt = freeform body. Default prompt = existing JSON renderer.
