# Editable friend-style WhatsApp daily digest

> **Slug:** `whatsapp-digest-story-prompt`
> **Status:** Approved
> **Last Updated:** 2026-09-24

## Goal

The evening briefing of every followed WhatsApp group is a short outline (one line and one detail per group, then a `שקט היום` list). That outline drops what was actually said. Replace the outline with one spoken Hebrew story, in the same friend tone as a single-group summary, and let that storytelling instruction be edited on the WhatsApp settings screen so the next tone change does not require a code edit. Groups with no messages today are omitted.

This replaces the section-bullet and quiet-line acceptance criteria in `docs/specs/whatsapp-daily-digest.md`. Schedule, channels, once-per-day skip of per-group bubbles, and the `צריך אותך` block stay as that spec defines them.

## User Stories

- As the owner, I want the all-groups evening message told like a friend recounting the day, so details from the chats are not collapsed into one line.
- As the owner, I want a followed group that had no messages today left out of that message, so I do not read a list of chats where nothing happened.
- As the owner, I want concrete things I still need to do listed above the story, so the asks stay separate from the narrative.
- As the owner, I want to edit how the all-groups summary is told from WhatsApp settings, so I can change tone or emphasis without a deploy.
- As the owner, I want to put the wording back to the built-in default, so an experiment is reversible.
- As the owner, I want a single-group summary (such as רום or עומרי) to keep its current friend wording, so the tone I already like there does not change.

## Acceptance Criteria

- [ ] Given followed groups where some have messages today and some have none, when the digest is rendered, then names of the empty groups do not appear, and the string `שקט היום` does not appear.
- [ ] Given every followed group has zero messages today, when the digest runs, then the body after the date header is exactly `היום לא קרה כלום.` and `צריך אותך` does not appear.
- [ ] Given at least one followed group has messages, when the digest is rendered, then the order is: date header `מה היה היום — {date}`, then `צריך אותך` and its bullets only when at least one grounded action exists, then the narrative. Nothing sits above `צריך אותך` except the date header.
- [ ] The narrative is prose. It is not rebuilt into label headings, `• {group}: {one line}` points, or a 280-character clip per section. A fact may take more than one sentence. The whole story stays concise (a sentence or two per active group, more only when something actually happened) and the server clips it to 900 characters at the last sentence boundary.
- [ ] Given two groups share a label and the same event, the default instruction tells the model to state that event once. The server does not also append a per-group bullet for it.
- [ ] Action bullets stay capped at 5, ordered by source priority then Hebrew name, each ending with ` — {source}`. A source must be the name of a group that has messages today, or the label name of such a group. A decision with nothing left to do is not an action.
- [ ] Groups with zero messages are not included in the text sent to the model.
- [ ] Given `user_settings.whatsapp_daily_digest_prompt` is null, when a digest runs, then the model receives `DEFAULT_DAILY_DIGEST_PROMPT` from `packages/api/src/services/whatsapp-daily-digest.ts`.
- [ ] Given a saved prompt, when a digest runs (cron or `whatsapp.digest.run`), then that saved text is the storytelling instruction. The server still appends the JSON contract and today's message blocks after it. The user cannot edit the JSON contract.
- [ ] Given the saved prompt is cleared by reset, the column is set back to null and the next digest uses the code default.
- [ ] `whatsapp.digest.prompt.save` rejects a trimmed string shorter than 40 characters or longer than 4000. The previous value stays.
- [ ] In-app notification markdown is `#` for the date line, `##` plus `-` bullets for `צריך אותך` when present, then the narrative as plain lines (parsed as paragraphs by `parseNotificationBody`). WhatsApp and `chat_messages` get the plain-text twin, still capped at 4000 characters with the existing overflow note.
- [ ] Push title stays `צריך אותך` when there is an action, otherwise `מה היה היום`.
- [ ] `summarizeGroupMessages` and `generateClusterSummary` are unchanged, including their friend-style prompts.
- [ ] Formatter tests in `packages/api/src/services/whatsapp-daily-digest.test.ts` cover: story present and quiet name absent; actions omitted when empty; all-quiet body; saved prompt preferred over the default; save rejects a too-short string; reset returns the default. No live Gemini call.

## Data Model

Additive column on the existing single row `user_settings` (`id = 'default'`):

| Column | SQLite (`schema.ts`) | Postgres (`schema.pg.ts`) |
|---|---|---|
| `whatsapp_daily_digest_prompt` | `text('whatsapp_daily_digest_prompt')` nullable | `text('whatsapp_daily_digest_prompt')` nullable |

Null means "use the code default". No new table.

SQLite bootstrap: add `'ALTER TABLE user_settings ADD COLUMN whatsapp_daily_digest_prompt TEXT'` to the existing `ALTER TABLE user_settings` list in `packages/database/src/index.ts`. Postgres: apply the same `ALTER TABLE` manually on deploy (this repo has no drizzle migration for prod).

`DailyDigestModel` in `packages/api/src/services/whatsapp-insights.ts` becomes `{ actions: { text: string; source: string }[]; narrative: string }`. Drop `groups` and `shared` from that type. `ArrangedDigest` drops `sections` and `quiet`; it gains `narrative: string`. `DigestRunResult.sectionCount` is `1` when `narrative` is non-empty and the day is not empty, else `0`. `quietCount` stays on the return object and is always `0`.

## tRPC API

Router: existing `digest` sub-router in `packages/api/src/routers/whatsapp.ts`. Auth: `protectedProcedure`.

| Procedure | Kind | Input | Return |
|---|---|---|---|
| `whatsapp.digest.prompt.get` | query | none | `{ prompt: string, customized: boolean }` |
| `whatsapp.digest.prompt.save` | mutation | `{ prompt: string }` trimmed, length 40–4000 | `{ prompt: string, customized: true }` |
| `whatsapp.digest.prompt.reset` | mutation | none | `{ prompt: string, customized: false }` where `prompt` is the code default |

`get` returns the saved text, or the default when the column is null. `customized` is true only when a non-null value is stored. `save` writes the trimmed string and `updated_at`. `reset` sets the column to null.

`whatsapp.digest.run` is unchanged in shape. It loads the effective prompt and passes it into `generateDailyDigestModel`.

`generateDailyDigestModel(groups, instructions)` sends only groups with messages. Fixed suffix after `instructions` (not stored, not editable):

```json
{"actions":[{"text":"...","source":"..."}],"narrative":"..."}
```

Respond in JSON only. `narrative` is the story. `actions` follow the same grounding rules as today. If JSON parse fails or `narrative` is empty while messages exist, use `לא הצלחתי לנסח את הסיכום. נסה שוב.` and drop actions. Do not fall back to the old one-line sections.

Default instruction (`DEFAULT_DAILY_DIGEST_PROMPT`), used when the column is null and shown in the editor until the user saves:

```text
אתה חבר שמספר מה היה היום בקבוצות הוואטסאפ שבמעקב.
כתוב עברית מדוברת, כמו שיחה על כוס קפה — לא דוח, בלי בולטים ובלי תוויות כמו "נושא:".
ספר רק על קבוצות שיש בהן הודעות. אל תזכיר קבוצה שלא קרה בה כלום.
לכל קבוצה פעילה: כמה משפטים קצרים על מה דיברו, מה עלה, ואם הוחלט משהו. תהיה תמציתי — משפט או שניים כשזה מספיק, יותר רק אם באמת קרה משהו. כל הסיפור עד 900 תווים.
אם אותו אירוע עלה בכמה קבוצות של אותה תווית — ספר אותו פעם אחת. ציין שם קבוצה רק כשהפרט שייך לה לבד.
אל תמציא עובדות ואל תצטט הודעות ארוכות.
ב-actions שים רק משהו שהמשתמש צריך לעשות: בקשה, שאלה פתוחה, דדליין, או דבר להביא, לאשר, לשלם או לענות. החלטה שכבר התקבלה בלי משימה פתוחה אינה action.
```

Plain render:

```text
מה היה היום — {date}

צריך אותך
• {text} — {source}

{narrative}
```

The `צריך אותך` block is omitted entirely when there are no actions. Narrative paragraphs stay separated by a blank line.

## UI Surface

`apps/web/src/app/settings/whatsapp/page.tsx`, Groups tab, directly under the existing toolbar (the row that contains **סכם עכשיו את כל הקבוצות במעקב**). No new route. No mobile screen.

Closed by default. One line on a `.card`:

- Title: `ניסוח הסיכום היומי`
- Secondary text: `הסיכום של כל הקבוצות במעקב. קבוצה בלי הודעות לא מופיעה.`
- Button: `ערוך ניסוח` (`.btn-ghost`)

Opened:

- Label above the field: `איך לספר את היום`
- Hint under the label: `ההודעות של היום מתווספות אוטומטית. כאן קובעים רק את הסגנון.`
- `<textarea>` using `.input`, `dir="rtl"`, at least 8 rows, `aria-label="איך לספר את היום"`. Prefilled from `whatsapp.digest.prompt.get`.
- `שמור` (`.btn-primary`) disabled until the text differs from the loaded value, and while the mutation is pending. Pending label: `שומר…`.
- `אפס לברירת מחדל` (`.btn-ghost`) visible only when `customized` is true or the field differs from the default. Opens `.overlay` + `.modal`. Title: `לאפס את הניסוח?` Body: `הניסוח ששמרת יימחק, והסיכום יחזור לברירת המחדל.` Buttons: `אפס` (`.btn-danger`), `ביטול` (`.btn-ghost`). Escape and the overlay click close without resetting.
- Success banner, same component as the existing page message: `הניסוח נשמר. הסיכום הבא ישתמש בו.` After reset: `הניסוח חזר לברירת המחדל.`
- Too-short client check, before the request, under the field in `text-red-400`: `כתוב לפחות כמה משפטים, או אפס לברירת המחדל.`
- Save/reset failure: `לא הצלחתי לשמור. נסה שוב.`

Loading: while the query is pending, the card shows `טוען ניסוח…` and the edit button is disabled. Query error: `לא הצלחתי לטעון את הניסוח.` plus `נסה שוב`.

`data-testid`: `whatsapp-digest-prompt-edit`, `whatsapp-digest-prompt-text`, `whatsapp-digest-prompt-save`, `whatsapp-digest-prompt-reset`.

## Out of Scope

- A new file under `A_Agents/` or an editor on `/agents/manage`. This digest is not a chat agent.
- Editing `summarizeGroupMessages`, `generateClusterSummary`, or the cross-group insights digest on the תובנות tab.
- Removing `צריך אותך`, changing digest time, channels, or the once-per-day skip of per-group and cluster bubbles.
- Per-group prompt fields, per-label prompts, or a preview that calls Gemini from the editor.
- Mobile settings UI.
- Changing `whatsapp.digest.run`'s return fields beyond `sectionCount` / `quietCount` as specified above.

## Open Questions

- None. The editable text is the storytelling instruction only. Message blocks and the JSON contract stay on the server. Empty groups are omitted in code, not only in the prompt. Single-group summaries stay as they are.
